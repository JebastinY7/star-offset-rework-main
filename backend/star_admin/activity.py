"""Activity log - who did what, and when (Settings > Activity Log, admin only).

Nothing in the existing views had to change. Two small pieces fill the ActivityLog table:

  * ActivityLogMiddleware watches every write request to /api/ (POST / PUT / PATCH / DELETE) and, when it
    succeeded, stores one readable line, e.g. "Created bill B105 (Ravi Kumar)". The table below
    (RULES) says which URL means what - to log a new screen, add one line there.
  * Django's sign-in / sign-out signals store "Signed in" / "Signed out". Wrong passwords
    (POST /api/auth/login/ -> 400 / 403) are stored as "Failed sign-in attempt".

Passwords and message texts are never stored - only names / numbers of the records touched.
A logging problem can never break the real request: every step is wrapped and only logged.
Entries older than RETENTION_DAYS are removed on the next sign-in.
"""
import json
import logging
import re
from collections import namedtuple
from datetime import timedelta
from types import SimpleNamespace

from django.contrib.auth.models import User
from django.contrib.auth.signals import user_logged_in, user_logged_out
from django.dispatch import receiver
from django.utils import timezone

from .models import (ActivityLog, Bill, Customer, Expense, MembershipTransaction, OffersHistory, Order,
                     Quotation, Shop, user_role)

logger = logging.getLogger(__name__)

RETENTION_DAYS = 365
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

# value stored in ActivityLog.module -> label shown on the page
MODULE_LABELS = {
    "auth": "Sign in",
    "customer": "Customers",
    "bill": "Billing",
    "order": "Orders",
    "quotation": "Quotations",
    "message": "Messages",
    "offer": "Offers",
    "membership": "Membership",
    "expense": "Expenses",
    "staff": "Staff",
    "shop": "Shops",
    "settings": "Settings",
    "security": "Security",
}

ACTION_LABELS = {
    "create": "Created", "update": "Edited", "delete": "Deleted", "status": "Status changed",
    "cancel": "Cancelled", "whatsapp": "WhatsApp sent", "draft": "Draft saved", "send": "Sent",
    "block": "Blocked", "unblock": "Unblocked", "password": "Password changed",
    "login": "Signed in", "logout": "Signed out", "login_failed": "Failed sign-in",
}

ORDER_STATUS_LABELS = {"pending": "Pending", "progress": "In Progress", "completed": "Completed",
                       "delivered": "Delivered", "cancelled": "Cancelled"}


# ------------------------------------------------------------------ writing
def client_ip(request):
    # Behind a proxy (Procfile / Railway) the router appends the real client IP last -
    # same rule as auth_api._client_ip.
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    ip = forwarded.split(",")[-1].strip() if forwarded else request.META.get("REMOTE_ADDR", "")
    return ip or None


def log_activity(*, module, action, description, user=None, username="", target="", ip=None):
    """Store one line. Safe to call from anywhere (e.g. a view that wants a custom message)."""
    try:
        user = user if (user is not None and getattr(user, "pk", None)) else None
        ActivityLog.objects.create(
            user=user,
            username=(user.username if user else username or "")[:150],
            role=user_role(user) if user else "",
            module=module,
            action=action,
            target=(target or "")[:200],
            description=(description or "")[:300],
            ip_address=ip or None,
        )
    except Exception:  # never let the log break the app
        logger.exception("Could not write the activity log")


def _prune():
    ActivityLog.objects.filter(created_at__lt=timezone.now() - timedelta(days=RETENTION_DAYS)).delete()


@receiver(user_logged_in)
def _on_login(sender, request, user, **kwargs):
    if not (user.is_staff or user.is_superuser):
        return
    log_activity(module="auth", action="login", description="Signed in", user=user, ip=client_ip(request))
    try:
        _prune()
    except Exception:
        logger.exception("Could not prune the activity log")


@receiver(user_logged_out)
def _on_logout(sender, request, user, **kwargs):
    if user is None or not (user.is_staff or user.is_superuser):
        return
    log_activity(module="auth", action="logout", description="Signed out", user=user, ip=client_ip(request))


# ------------------------------------------------- names of the records touched
def _label(kind, pk):
    """Short readable name of a record ('B105 (Ravi Kumar)'), or '' when it is gone."""
    try:
        pk = int(pk)
    except (TypeError, ValueError):
        return ""
    if kind == "bill":
        b = Bill.objects.select_related("customer").filter(pk=pk).first()
        return f"{b.bill_no} ({b.customer.name})" if b else ""
    if kind == "order":
        o = Order.objects.select_related("customer").filter(pk=pk).first()
        return f"{o.work_name} ({o.customer.name})" if o else ""
    if kind == "quotation":
        q = Quotation.objects.filter(pk=pk).first()
        return f"{q.quotation_no} ({q.customer_name})" if q else ""
    if kind == "customer":
        c = Customer.objects.filter(pk=pk).first()
        return f"{c.name} ({c.phone})" if c else ""
    if kind == "offer":
        o = OffersHistory.objects.filter(pk=pk).first()
        return o.title if o else ""
    if kind == "membership":
        m = MembershipTransaction.objects.select_related("customer").filter(pk=pk).first()
        return m.customer.name if m else ""
    if kind == "staff":
        u = User.objects.filter(pk=pk).first()
        return u.username if u else ""
    if kind == "shop":
        s = Shop.objects.filter(pk=pk).first()
        return s.name if s else ""
    if kind == "expense":
        e = Expense.objects.filter(pk=pk).first()
        return f"{e.get_category_display()} ₹{e.amount}" if e else ""
    return ""


# ---------------------------------------- extra words for some descriptions
# Each returns a dict that fills the {placeholders} of the rule text (and may set "target"),
# or None to skip logging this request.  c = SimpleNamespace(pk, data, body, status)
def _order_status(c):
    status = (c.data or {}).get("status") if isinstance(c.data, dict) else ""
    return {"status": ORDER_STATUS_LABELS.get(status, status or "next status")}


def _whatsapp_chat(c):
    phone = str(c.pk or "").strip()
    customer = Customer.objects.filter(phone__endswith=phone[-10:]).first() if phone else None
    who = f"{customer.name} ({phone})" if customer else phone
    return {"who": who, "target": who}


def _membership_settings(c):
    d = c.data if isinstance(c.data, dict) else {}
    return {"summary": f"validity {d.get('membership_validity_days')} days, renewal ₹{d.get('renewal_fee')}, "
                       f"shop renewal ₹{d.get('shop_renewal_fee')}"}


def _new_staff(c):
    body = c.body or {}
    username = str(body.get("username") or "").strip()
    role = str(body.get("role") or "staff").strip().lower()
    return {"target": username, "username": username, "role": role if role in ("admin", "manager") else "staff"}


def _staff_toggle(c):
    rows = (c.data or {}).get("staff") if isinstance(c.data, dict) else None
    row = next((r for r in rows or [] if str(r.get("id")) == str(c.pk)), None)
    return {"verb": "Unblocked" if (row and row["is_active"]) else "Blocked"}


def _shop_toggle(c):
    d = c.data if isinstance(c.data, dict) else {}
    return {"verb": "Activated" if d.get("is_active") else "Deactivated"}


def _shop_portal(c):
    d = c.data if isinstance(c.data, dict) else {}
    return {"verb": "Enabled" if d.get("portal_access") else "Disabled"}


def _login_failed(c):
    identifier = str((c.body or {}).get("identifier") or "").strip()
    if not identifier or c.status not in (400, 403):  # 429 (locked) is not logged: no log flooding
        return None
    what = "Sign-in refused (account blocked)" if c.status == 403 else "Failed sign-in attempt"
    return {"what": what, "identifier": identifier[:100], "target": identifier[:100]}


# ------------------------------------------------------------------- the rules
# methods, URL after /api/ (whole path), module, action, record kind, text, extra words, needs body, only failures
#   {t} in the text = readable name of the record.  pk = first (...) group of the URL.
Rule = namedtuple("Rule", "methods pattern module action kind text extra needs_body only_fail",
                  defaults=(None, False, False))

RULES = [
    # customers
    Rule(("POST",), r"customers/", "customer", "create", "customer", "Added customer {t}"),
    Rule(("PUT", "PATCH"), r"customers/(\d+)/", "customer", "update", "customer", "Updated customer {t}"),
    Rule(("DELETE",), r"customers/(\d+)/", "customer", "delete", "customer", "Deleted customer {t}"),
    # bills
    Rule(("POST",), r"bills/", "bill", "create", "bill", "Created bill {t}"),
    Rule(("PUT",), r"bills/(\d+)/", "bill", "update", "bill", "Edited bill {t}"),
    Rule(("DELETE",), r"bills/(\d+)/", "bill", "delete", "bill", "Deleted bill {t}"),
    # orders
    Rule(("POST",), r"orders/", "order", "create", "order", "Created order {t}"),
    Rule(("PUT",), r"orders/(\d+)/", "order", "update", "order", "Edited order {t}"),
    Rule(("DELETE",), r"orders/(\d+)/", "order", "delete", "order", "Deleted order {t}"),
    Rule(("POST",), r"orders/(\d+)/status/", "order", "status", "order", "Moved order {t} to {status}", _order_status),
    Rule(("POST",), r"orders/(\d+)/cancel/", "order", "cancel", "order", "Cancelled order {t}"),
    Rule(("POST",), r"orders/(\d+)/whatsapp/", "order", "whatsapp", "order", "Sent 'order completed' WhatsApp for order {t}"),
    # quotations
    Rule(("POST",), r"quotations/", "quotation", "create", "quotation", "Created quotation {t}"),
    Rule(("PUT",), r"quotations/(\d+)/", "quotation", "update", "quotation", "Edited quotation {t}"),
    Rule(("DELETE",), r"quotations/(\d+)/", "quotation", "delete", "quotation", "Deleted quotation {t}"),
    # WhatsApp messages (the text itself is not stored)
    Rule(("POST",), r"messages/chat/([^/]+)/", "message", "whatsapp", None, "Sent a WhatsApp message to {who}", _whatsapp_chat),
    Rule(("POST",), r"messages/chat/([^/]+)/template/", "message", "whatsapp", None, "Sent a WhatsApp template to {who}", _whatsapp_chat),
    # offers
    Rule(("POST",), r"offers/draft/", "offer", "draft", "offer", "Saved offer draft {t}"),
    Rule(("POST",), r"offers/send/", "offer", "send", "offer", "Sent offer {t} on WhatsApp"),
    Rule(("DELETE",), r"offers/history/(\d+)/", "offer", "delete", "offer", "Deleted offer {t}"),
    # membership
    Rule(("DELETE",), r"membership-history/(\d+)/", "membership", "delete", "membership", "Deleted membership record of {t}"),
    # expenses (Profit & Loss)
    Rule(("POST",), r"expenses/", "expense", "create", "expense", "Added expense {t}"),
    Rule(("PUT", "PATCH"), r"expenses/(\d+)/", "expense", "update", "expense", "Edited expense {t}"),
    Rule(("DELETE",), r"expenses/(\d+)/", "expense", "delete", "expense", "Deleted expense {t}"),
    # settings
    Rule(("PATCH", "PUT"), r"settings/membership/", "settings", "update", None, "Updated membership settings ({summary})", _membership_settings),
    Rule(("POST",), r"settings/admin-password/", "security", "password", None, "Changed the admin password"),
    Rule(("POST",), r"settings/staff/", "staff", "create", None, "Added {role} {username}", _new_staff, True),
    Rule(("PATCH",), r"settings/staff/(\d+)/", "staff", "update", "staff", "Edited staff {t}"),
    Rule(("DELETE",), r"settings/staff/(\d+)/", "staff", "delete", "staff", "Deleted staff {t}"),
    Rule(("POST",), r"settings/staff/(\d+)/toggle/", "staff", "block", "staff", "{verb} staff {t}", _staff_toggle),
    Rule(("POST",), r"settings/staff/(\d+)/password/", "staff", "password", "staff", "Changed the password of staff {t}"),
    # shops (Settings > Shop Management) - passwords are never read
    Rule(("POST",), r"settings/shops/", "shop", "create", "shop", "Added shop {t}"),
    Rule(("PATCH",), r"settings/shops/(\d+)/", "shop", "update", "shop", "Edited shop {t}"),
    Rule(("DELETE",), r"settings/shops/(\d+)/", "shop", "delete", "shop", "Deleted shop {t}"),
    Rule(("POST",), r"settings/shops/(\d+)/toggle/", "shop", "status", "shop", "{verb} shop account {t}", _shop_toggle),
    Rule(("POST",), r"settings/shops/(\d+)/portal/", "shop", "status", "shop", "{verb} portal access for shop {t}", _shop_portal),
    Rule(("POST",), r"settings/shops/(\d+)/password/", "shop", "password", "shop", "Reset the password access of shop {t}"),
    # wrong sign-in (successful ones come from the signal above)
    Rule(("POST",), r"auth/login/", "auth", "login_failed", None, "{what} for '{identifier}'", _login_failed, True, True),
]
COMPILED = [(r, re.compile(r.pattern)) for r in RULES]


def _match(method, path):
    for rule, rx in COMPILED:
        if method in rule.methods:
            m = rx.fullmatch(path)
            if m:
                return rule, (m.group(1) if m.groups() else None)
    return None, None


def _read_json(request):
    try:
        data = json.loads(request.body or b"{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


class SafeDict(dict):
    def __missing__(self, key):
        return ""


class ActivityLogMiddleware:
    """Put it AFTER AuthenticationMiddleware in settings.MIDDLEWARE."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        rule = pk = None
        if request.method in WRITE_METHODS and request.path_info.startswith("/api/"):
            rule, pk = _match(request.method, request.path_info[len("/api/"):])
        if rule is None:
            return self.get_response(request)

        # everything that must be read BEFORE the view runs (the view may delete the record,
        # and DRF consumes the request body)
        user = request.user if request.user.is_authenticated else None
        ip = client_ip(request)
        body, before = {}, ""
        try:
            if rule.needs_body:
                body = _read_json(request)
            if rule.kind and pk:
                before = _label(rule.kind, pk)
        except Exception:
            logger.exception("Activity log: could not prepare")

        response = self.get_response(request)

        try:
            self._record(rule, pk, before, body, user, ip, response)
        except Exception:
            logger.exception("Activity log: could not record")
        return response

    @staticmethod
    def _record(rule, pk, before, body, user, ip, response):
        status = response.status_code
        failed = status >= 400
        if rule.only_fail != failed or (not rule.only_fail and not 200 <= status < 300):
            return
        if user is None and not rule.only_fail:
            return

        data = getattr(response, "data", None)
        words = {}
        if rule.extra:
            words = rule.extra(SimpleNamespace(pk=pk, data=data, body=body, status=status))
            if words is None:
                return
        target = words.pop("target", "")
        if rule.kind:
            # created -> the id is in the response; edited -> read again (name may have changed)
            record_id = pk or (data.get("id") if isinstance(data, dict) else None)
            target = _label(rule.kind, record_id) or before
        description = rule.text.format_map(SafeDict(t=target, **words))
        log_activity(module=rule.module, action=rule.action, description=description, user=user,
                     username=(body.get("identifier") or "") if user is None else "", target=target, ip=ip)