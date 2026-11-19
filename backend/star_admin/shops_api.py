"""Settings > Shop Management API (admin only).

External printing shops that get a login for the "Shop Portal".

    GET    /api/settings/shops/                 ?q=&status=active|inactive&account=enabled|disabled&page=&page_size=
                                                -> {results, count, page, pages, page_size, stats}
    POST   /api/settings/shops/                 create a shop + its portal login
    GET    /api/settings/shops/<id>/            one shop
    PATCH  /api/settings/shops/<id>/            edit the shop (profile, status, portal access; the User ID is fixed)
    DELETE /api/settings/shops/<id>/            delete the shop and its login
    POST   /api/settings/shops/<id>/toggle/    activate / deactivate the account
    POST   /api/settings/shops/<id>/portal/    enable / disable portal access
    POST   /api/settings/shops/<id>/password/  {mode: "invite" | "temp", new_password?, send_email?}

The shop's login "User ID" is generated automatically when the shop is created: <year>S<4-digit number>,
e.g. 2026S0001, 2026S0002 ... (the number restarts at 0001 every year).  It is stored as User.username and the
admin cannot type or change it.

A shop is a normal Django User (is_staff = False, so it can never sign in to this admin app - see
auth_api._find_account) plus a Shop row with the business details.
  * Account status  = User.is_active
  * Portal access   = Shop.portal_access   (the portal must check BOTH before letting a shop in)

Password setup:
  * "invite" - the account gets no usable password; a one-time setup link (Django's token generator,
               valid PASSWORD_RESET_TIMEOUT seconds, dead as soon as a password is set) is returned to the
               admin and, when asked, emailed to the shop.  The link points to
               SHOP_PORTAL_URL (env) + /setup-password/<uid>/<token>/.
  * "temp"   - the admin types a temporary password.  Passwords are never emailed or logged.  The shop is
               marked must_change_password, so the Shop Portal makes it choose its own password on first sign-in.
"""
import logging
import os
import re

from django.conf import settings as django_settings
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.paginator import Paginator
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .api_views import MIN_PASSWORD_LEN, IsSuperuser
from .models import Shop

logger = logging.getLogger(__name__)

SHOP_TYPES = [
    ("retail", "Retail Shop"),
    ("wholesale", "Wholesale"),
    ("press", "Printing Press"),
    ("stationery", "Stationery Shop"),
    ("other", "Other"),
]
SHOP_TYPE_LABEL = dict(SHOP_TYPES)

NAME_MAX = 150
OWNER_MAX = 100
ADDRESS_MAX = 500
NOTES_MAX = 1000
GST_RX = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
DEFAULT_PAGE_SIZE = 10


# ------------------------------------------------------------------ helpers
def _row(shop):
    u = shop.user
    return {
        "id": shop.id,
        "name": shop.name,
        "owner_name": shop.owner_name,
        "phone": shop.phone,
        "email": shop.email,
        "username": u.username,
        "gst_number": shop.gst_number,
        "shop_type": shop.shop_type,
        "shop_type_label": SHOP_TYPE_LABEL.get(shop.shop_type, ""),
        "address": shop.address,
        "notes": shop.notes,
        "portal_access": shop.portal_access,
        "is_active": u.is_active,
        "password_set": u.has_usable_password(),
        "created_at": shop.created_at,
    }


def _stats():
    now = timezone.localtime()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    qs = Shop.objects.all()
    total = qs.count()
    active = qs.filter(user__is_active=True).count()
    return {
        "total": total,
        "active": active,
        "inactive": total - active,
        "new_this_month": qs.filter(created_at__gte=month_start).count(),
    }


def _shop(pk):
    return Shop.objects.select_related("user").filter(pk=pk).first()


def _text(raw, label, max_len, required=False):
    value = " ".join(str(raw or "").split())
    if required and not value:
        raise ValueError(f"{label} is required")
    if len(value) > max_len:
        raise ValueError(f"{label} can be at most {max_len} characters")
    return value


def _multiline(raw, label, max_len):
    value = str(raw or "").strip()
    if len(value) > max_len:
        raise ValueError(f"{label} can be at most {max_len} characters")
    return value


def _clean_phone(raw, exclude_shop_id=None):
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if not digits:
        raise ValueError("Mobile number is required")
    if len(digits) != 10:
        raise ValueError("Mobile number must be 10 digits")
    taken = Shop.objects.filter(phone=digits)
    if exclude_shop_id:
        taken = taken.exclude(pk=exclude_shop_id)
    if taken.exists():
        raise ValueError("A shop with this mobile number already exists")
    return digits


def _clean_email(raw, exclude_user_id=None, exclude_shop_id=None):
    email = (raw or "").strip().lower()
    if not email:
        raise ValueError("Email address is required")
    try:
        validate_email(email)
    except ValidationError:
        raise ValueError("Enter a valid email address")
    users = User.objects.filter(email__iexact=email)
    shops = Shop.objects.filter(email__iexact=email)
    if exclude_user_id:
        users = users.exclude(pk=exclude_user_id)
    if exclude_shop_id:
        shops = shops.exclude(pk=exclude_shop_id)
    if users.exists() or shops.exists():
        raise ValueError("Email already exists")
    return email


USER_ID_RX = re.compile(r"^(\d{4})S(\d{4,})$")


def _next_user_id():
    """Next free shop User ID: <year>S0001, <year>S0002 ... (the counter restarts every year)."""
    prefix = f"{timezone.localdate().year}S"
    highest = 0
    for name in User.objects.filter(username__startswith=prefix).values_list("username", flat=True):
        m = USER_ID_RX.match(name)
        if m and m.group(1) + "S" == prefix:
            highest = max(highest, int(m.group(2)))
    return f"{prefix}{highest + 1:04d}"


def _clean_gst(raw):
    gst = (raw or "").strip().upper()
    if gst and not GST_RX.match(gst):
        raise ValueError("Enter a valid 15 character GST number")
    return gst


def _clean_shop_type(raw):
    value = (raw or "").strip().lower()
    if value and value not in SHOP_TYPE_LABEL:
        raise ValueError("Choose a valid shop type")
    return value


def _bool(raw, default):
    if raw is None:
        return default
    if isinstance(raw, str):
        return raw.strip().lower() in ("1", "true", "yes", "on")
    return bool(raw)


def _check_password(raw):
    if not raw:
        raise ValueError("Enter a temporary password")
    if len(raw) < MIN_PASSWORD_LEN:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LEN} characters")
    return raw


def _setup_link(request, user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    base = (os.getenv("SHOP_PORTAL_URL") or request.build_absolute_uri("/shop")).rstrip("/")
    return f"{base}/setup-password/{uid}/{token}/"


def _email_configured():
    backend = getattr(django_settings, "EMAIL_BACKEND", "")
    if "smtp" in backend:
        return bool(getattr(django_settings, "EMAIL_HOST_USER", None))
    return True  # console / locmem / file backends


def _send_account_email(shop, link):
    """-> (sent: bool, message: str).  Never raises, never includes a password."""
    if not _email_configured():
        return False, "Email delivery is not configured, so no email was sent."
    lines = [
        f"Hello {shop.owner_name},",
        "",
        f"An account has been created for {shop.name} on the Shop Portal.",
        f"Your User ID: {shop.user.username}",
        "",
    ]
    if link:
        lines += ["Set your password using this secure link:", link, "",
                  "The link works once and expires after a few days."]
    else:
        lines += ["Your temporary password will be shared with you separately by the admin."]
    try:
        send_mail("Your Shop Portal account", "\n".join(lines),
                  getattr(django_settings, "DEFAULT_FROM_EMAIL", None), [shop.email], fail_silently=False)
    except Exception:
        logger.exception("Could not send the shop account email")
        return False, "The email could not be sent."
    return True, f"Account details emailed to {shop.email}."


# ------------------------------------------------------------ list / create
@api_view(["GET", "POST"])
@permission_classes([IsSuperuser])
def settings_shops(request):
    if request.method == "POST":
        return _create(request)

    p = request.query_params
    qs = Shop.objects.select_related("user")
    q = (p.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(owner_name__icontains=q) | Q(phone__icontains=q)
                       | Q(email__icontains=q) | Q(user__username__icontains=q))
    status = p.get("status")
    if status in ("active", "inactive"):
        qs = qs.filter(user__is_active=(status == "active"))
    account = p.get("account")
    if account in ("enabled", "disabled"):
        qs = qs.filter(portal_access=(account == "enabled"))

    try:
        size = min(max(int(p.get("page_size") or DEFAULT_PAGE_SIZE), 1), 100)
        number = int(p.get("page") or 1)
    except ValueError:
        size, number = DEFAULT_PAGE_SIZE, 1
    paginator = Paginator(qs, size)
    page = paginator.get_page(number)  # out-of-range page -> nearest valid page
    return Response({
        "results": [_row(s) for s in page.object_list],
        "count": paginator.count,
        "page": page.number,
        "pages": paginator.num_pages,
        "page_size": size,
        "stats": _stats(),
    })


def _create(request):
    d = request.data
    mode = (d.get("password_mode") or "invite").strip().lower()
    try:
        name = _text(d.get("name"), "Shop name", NAME_MAX, required=True)
        owner = _text(d.get("owner_name"), "Owner / contact person", OWNER_MAX, required=True)
        phone = _clean_phone(d.get("phone"))
        email = _clean_email(d.get("email"))
        gst = _clean_gst(d.get("gst_number"))
        shop_type = _clean_shop_type(d.get("shop_type"))
        address = _multiline(d.get("address"), "Address", ADDRESS_MAX)
        notes = _multiline(d.get("notes"), "Internal notes", NOTES_MAX)
        if mode not in ("invite", "temp"):
            raise ValueError("Choose how the shop will set its password")
        password = _check_password(d.get("password") or "") if mode == "temp" else None
    except ValueError as e:
        return Response({"error": str(e)}, status=400)

    is_active = _bool(d.get("is_active"), True)
    portal_access = _bool(d.get("portal_access"), True)
    send_email = _bool(d.get("send_email"), False)

    # The User ID is generated here, never typed.  Two shops saved at the same moment could pick the same
    # number; the unique username makes the loser fail, so it simply tries again with the next number.
    for _attempt in range(5):
        try:
            with transaction.atomic():
                user = User.objects.create_user(username=_next_user_id(), email=email, password=password)
                if mode == "invite":
                    user.set_unusable_password()
                user.is_staff = False
                user.is_superuser = False
                user.is_active = is_active
                user.save()
                shop = Shop.objects.create(user=user, name=name, owner_name=owner, phone=phone, email=email,
                                           gst_number=gst, shop_type=shop_type, address=address, notes=notes,
                                           portal_access=portal_access,
                                           must_change_password=(mode == "temp"))
            break
        except IntegrityError:
            continue
    else:
        return Response({"error": "Could not generate a User ID right now. Please try again."}, status=409)

    link = _setup_link(request, user) if mode == "invite" else None
    data = _row(shop)
    data["setup_link"] = link
    data["email_sent"] = None
    data["email_message"] = ""
    if send_email:
        data["email_sent"], data["email_message"] = _send_account_email(shop, link)
    return Response(data, status=201)


# ------------------------------------------------------------------ detail
@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsSuperuser])
def settings_shop_detail(request, pk):
    shop = _shop(pk)
    if shop is None:
        return Response({"error": "Shop not found"}, status=404)

    if request.method == "GET":
        return Response(_row(shop))

    if request.method == "DELETE":
        shop.user.delete()  # cascades to the Shop row
        return Response({"ok": True})

    d = request.data
    user = shop.user
    try:
        if "name" in d:
            shop.name = _text(d.get("name"), "Shop name", NAME_MAX, required=True)
        if "owner_name" in d:
            shop.owner_name = _text(d.get("owner_name"), "Owner / contact person", OWNER_MAX, required=True)
        if "phone" in d:
            shop.phone = _clean_phone(d.get("phone"), shop.pk)
        if "email" in d:
            shop.email = _clean_email(d.get("email"), user.pk, shop.pk)
            user.email = shop.email
        if "gst_number" in d:
            shop.gst_number = _clean_gst(d.get("gst_number"))
        if "shop_type" in d:
            shop.shop_type = _clean_shop_type(d.get("shop_type"))
        if "address" in d:
            shop.address = _multiline(d.get("address"), "Address", ADDRESS_MAX)
        if "notes" in d:
            shop.notes = _multiline(d.get("notes"), "Internal notes", NOTES_MAX)
        # the User ID ("username") is generated once and never edited
    except ValueError as e:
        return Response({"error": str(e)}, status=400)

    if "portal_access" in d:
        shop.portal_access = _bool(d.get("portal_access"), shop.portal_access)
    if "is_active" in d:
        user.is_active = _bool(d.get("is_active"), user.is_active)

    with transaction.atomic():
        user.save()
        shop.save()
    return Response(_row(shop))


# ----------------------------------------------------------------- actions
@api_view(["POST"])
@permission_classes([IsSuperuser])
def settings_shop_toggle(request, pk):
    shop = _shop(pk)
    if shop is None:
        return Response({"error": "Shop not found"}, status=404)
    shop.user.is_active = not shop.user.is_active
    shop.user.save(update_fields=["is_active"])
    return Response(_row(shop))


@api_view(["POST"])
@permission_classes([IsSuperuser])
def settings_shop_portal(request, pk):
    shop = _shop(pk)
    if shop is None:
        return Response({"error": "Shop not found"}, status=404)
    shop.portal_access = not shop.portal_access
    shop.save(update_fields=["portal_access"])
    return Response(_row(shop))


@api_view(["POST"])
@permission_classes([IsSuperuser])
def settings_shop_password(request, pk):
    shop = _shop(pk)
    if shop is None:
        return Response({"error": "Shop not found"}, status=404)
    d = request.data
    mode = (d.get("mode") or "").strip().lower()
    if mode == "temp":
        try:
            password = _check_password(d.get("new_password") or "")
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        shop.user.set_password(password)
        shop.user.save()
        shop.must_change_password = True  # the shop must replace the temporary password at next sign-in
        shop.save(update_fields=["must_change_password"])
        data = _row(shop)
        data["setup_link"] = None
        data["email_sent"] = None
        data["email_message"] = ""
        return Response(data)
    if mode == "invite":
        link = _setup_link(request, shop.user)  # the current password is left untouched
        data = _row(shop)
        data["setup_link"] = link
        data["email_sent"], data["email_message"] = (None, "")
        if _bool(d.get("send_email"), False):
            data["email_sent"], data["email_message"] = _send_account_email(shop, link)
        return Response(data)
    return Response({"error": "Choose how the shop will set its password"}, status=400)