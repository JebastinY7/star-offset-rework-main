"""Web Push + email fallback for notifications.

The WebSocket (realtime.py) only reaches a portal that is open. For everyone else, every notification
(staff bell, shop bell, vendor events) also goes through dispatch() below:

    1. Web Push  -> every browser / phone of that account that turned notifications on.
                    Works with the browser closed. (The service worker public/sw.js shows it.)
    2. Email     -> only when Web Push reached nobody (no subscription, push not set up, or every send failed)
                    AND the account is not looking at the portal right now.

Sending happens in a small background thread pool, after the database transaction commits, so a slow push
service or SMTP server never slows down an order, a payment or a vendor update.  Nothing here ever raises.

Settings (starprinting/settings.py): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CLAIM_SUB, NOTIFY_EMAIL_FALLBACK,
NOTIFY_ASYNC, ADMIN_PORTAL_URL / SHOP_PORTAL_URL / VENDOR_PORTAL_URL (links inside emails).
"""
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlparse

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import IntegrityError, close_old_connections, transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.html import escape

logger = logging.getLogger(__name__)

PRESENCE_SECONDS = 70   # the portal pings every 25 s while a tab is on screen
PUSH_TTL = 24 * 3600    # a push the phone could not receive (switched off) is kept this long by the push service
FAILS_BEFORE_DROP = 5   # a subscription that keeps failing for other reasons than "expired" is forgotten
SUBJECT_PREFIX = "[Star Offset] "

# Only real browser push services may be called: the address comes from the browser, so without this check a
# signed-in user could make the server send requests to any URL (SSRF).
PUSH_HOSTS = ("fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com")

_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="notify")


def _note(msg, *args):
    """Progress line in the backend terminal while DEBUG=True (so you can see what happened to each notification)."""
    (logger.warning if getattr(settings, "DEBUG", False) else logger.info)("[push] " + msg, *args)


@dataclass
class Target:
    user_id: int
    email: str
    portal: str  # "admin" | "shop" | "vendor"


# ---------------------------------------------------------------- settings helpers
def push_enabled():
    return bool(getattr(settings, "VAPID_PUBLIC_KEY", "") and getattr(settings, "VAPID_PRIVATE_KEY", ""))


def endpoint_allowed(endpoint):
    try:
        u = urlparse(endpoint)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    if u.scheme != "https" or not host:
        return False
    hosts = PUSH_HOSTS + tuple(getattr(settings, "PUSH_EXTRA_HOSTS", ()))
    return any(host == h or host.endswith("." + h) for h in hosts)


# ---------------------------------------------------------------- who gets it
def _targets(audience):
    from django.contrib.auth.models import User

    from .models import Shop
    from .vendor_models import Vendor

    kind = audience[0]
    if kind == "staff":
        users = User.objects.filter(is_active=True).filter(Q(is_staff=True) | Q(is_superuser=True))
        return [Target(u.pk, (u.email or "").strip(), "admin") for u in users]
    if kind == "shop":
        s = Shop.objects.select_related("user").filter(pk=audience[1], portal_access=True, user__is_active=True).first()
        return [Target(s.user_id, (s.email or "").strip(), "shop")] if s else []
    if kind == "vendor":
        v = Vendor.objects.select_related("user").filter(pk=audience[1], portal_access=True, user__is_active=True).first()
        return [Target(v.user_id, (v.email or "").strip(), "vendor")] if v else []
    return []


# ---------------------------------------------------------------- presence
def mark_visible(user_id):
    """Called by the WebSocket when a visible portal tab pings. Never raises."""
    from .push_models import LivePresence
    try:
        now = timezone.now()
        if not LivePresence.objects.filter(user_id=user_id).update(last_visible=now):
            try:
                LivePresence.objects.create(user_id=user_id, last_visible=now)
            except IntegrityError:  # two tabs created it at the same moment
                LivePresence.objects.filter(user_id=user_id).update(last_visible=now)
    except Exception:  # noqa: BLE001
        logger.exception("Could not store presence")


def is_live(user_id):
    from .push_models import LivePresence
    since = timezone.now() - timedelta(seconds=PRESENCE_SECONDS)
    return LivePresence.objects.filter(user_id=user_id, last_visible__gte=since).exists()


# ---------------------------------------------------------------- Web Push
def _send_push(user_id, payload):
    """-> how many of this account's browsers accepted the push."""
    from pywebpush import WebPushException, webpush

    from .push_models import PushSubscription

    body = json.dumps(payload)
    accepted = 0
    subs = list(PushSubscription.objects.filter(user_id=user_id))
    _note("user %s has %s push subscription(s)", user_id, len(subs))
    for sub in subs:
        try:
            webpush(
                subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=body,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_CLAIM_SUB},  # a fresh dict every time: the library edits it
                ttl=PUSH_TTL,
                timeout=10,
            )
            accepted += 1
            _note("sent to %s", urlparse(sub.endpoint).hostname)
            PushSubscription.objects.filter(pk=sub.pk).update(failures=0, last_success_at=timezone.now())
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):  # the browser / user removed the subscription: forget it
                sub.delete()
            else:
                _count_failure(sub, e)
        except Exception as e:  # noqa: BLE001
            _count_failure(sub, e)
    return accepted


def _count_failure(sub, err):
    from .push_models import PushSubscription
    logger.warning("Web Push to subscription %s failed: %s", sub.pk, err)
    if sub.failures + 1 >= FAILS_BEFORE_DROP:
        sub.delete()
    else:
        PushSubscription.objects.filter(pk=sub.pk).update(failures=sub.failures + 1)


# ---------------------------------------------------------------- email
def _portal_url(portal, link):
    base = (getattr(settings, f"{portal.upper()}_PORTAL_URL", "") or "").rstrip("/")
    if not base:
        return ""
    return base + (link if (link or "").startswith("/") else "/" + (link or ""))


def _send_email(target, payload):
    url = _portal_url(target.portal, payload.get("link", ""))
    title, message = payload.get("title", ""), payload.get("body", "")
    text = message + (f"\n\nOpen: {url}" if url else "")
    text += "\n\nYou get this email because you were not signed in to the portal when it happened.\nTurn on browser notifications in the portal to get these instantly."
    html = (f"<p style='font:15px/1.5 Arial,sans-serif'><b>{escape(title)}</b><br>{escape(message)}</p>"
            + (f"<p><a href='{escape(url)}'>Open in the portal</a></p>" if url else "")
            + "<p style='color:#6b7280;font:13px Arial,sans-serif'>You get this email because you were not signed in to the portal "
              "when it happened. Turn on browser notifications in the portal to get these instantly.</p>")
    try:
        mail = EmailMultiAlternatives(SUBJECT_PREFIX + title, text,
                                      getattr(settings, "DEFAULT_FROM_EMAIL", None) or getattr(settings, "EMAIL_HOST_USER", None), [target.email])
        mail.attach_alternative(html, "text/html")
        mail.send()
        return True
    except Exception:  # noqa: BLE001
        logger.exception("Fallback email to %s failed", target.email)
        return False


# ---------------------------------------------------------------- entry point
def _deliver(audience, payload):
    use_push = push_enabled()
    targets = _targets(audience)
    _note("%s '%s' -> %s account(s), push_enabled=%s", audience, payload.get("title"), len(targets), use_push)
    for t in targets:
        pushed = _send_push(t.user_id, payload) if use_push else 0
        if pushed:
            continue
        _note("user %s: nothing pushed, falling back to email (%s)", t.user_id, t.email or "no email on file")
        if not getattr(settings, "NOTIFY_EMAIL_FALLBACK", True) or not t.email:
            continue
        if is_live(t.user_id):  # looking at the portal right now: the toast already told them
            continue
        _send_email(t, payload)


def dispatch(audience, kind, title, message="", link="", ref=""):
    """audience: ("staff",) | ("shop", shop_id) | ("vendor", vendor_id).  Call it right after realtime.push_*().

    Runs after the transaction commits, in a background thread. Never raises."""
    payload = {"kind": kind, "title": title, "body": message, "link": link or "/", "tag": f"{kind}-{ref}" if ref else kind}
    in_thread = getattr(settings, "NOTIFY_ASYNC", True)

    def run():
        try:
            _deliver(audience, payload)
        except Exception:  # noqa: BLE001
            logger.exception("Push / email delivery failed")
        finally:
            if in_thread:
                close_old_connections()  # a worker thread owns its own DB connection

    try:
        transaction.on_commit(lambda: _pool.submit(run) if in_thread else run())
    except Exception:  # noqa: BLE001
        logger.exception("Could not queue push / email delivery")
