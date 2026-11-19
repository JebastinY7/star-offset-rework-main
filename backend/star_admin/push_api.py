"""Web Push endpoints (the browser calls these; routed under all three prefixes like the ws-ticket).

    GET  /api/{admin|shop|vendor}/push/key/           {enabled, public_key}   VAPID public key (enabled=false until the keys are set)
    POST /api/{admin|shop|vendor}/push/subscribe/     the browser's PushSubscription JSON {endpoint, keys:{p256dh, auth}}
    POST /api/{admin|shop|vendor}/push/unsubscribe/   {endpoint}   (called on sign-out: this browser stops getting the account's alerts)

Subscribing an endpoint that already belongs to somebody else (shared computer, new login) moves it to the current account.
"""
from rest_framework.decorators import api_view
from rest_framework.response import Response

from django.conf import settings

from .push import endpoint_allowed, push_enabled
from .push_models import PushSubscription


def _may_use(user):
    """Active staff, or a shop / vendor with portal access - same rule as the WebSocket."""
    if not user.is_active:
        return False
    if user.is_staff or user.is_superuser:
        return True
    vendor = getattr(user, "vendor_profile", None)
    if vendor is not None:
        return bool(vendor.portal_access)
    shop = getattr(user, "shop_profile", None)
    return bool(shop and shop.portal_access)


@api_view(["GET"])
def push_key(request):
    on = push_enabled() and _may_use(request.user)
    resp = Response({"enabled": on, "public_key": settings.VAPID_PUBLIC_KEY if on else ""})
    resp["Cache-Control"] = "no-store"
    return resp


@api_view(["POST"])
def push_subscribe(request):
    if not (push_enabled() and _may_use(request.user)):
        return Response({"error": "Notifications are not available."}, status=403)
    d = request.data if isinstance(request.data, dict) else {}
    keys = d.get("keys") if isinstance(d.get("keys"), dict) else {}
    endpoint, p256dh, auth = (str(d.get("endpoint") or ""), str(keys.get("p256dh") or ""), str(keys.get("auth") or ""))
    if not (endpoint and p256dh and auth) or len(endpoint) > 800 or len(p256dh) > 200 or len(auth) > 100:
        return Response({"error": "Invalid subscription."}, status=400)
    if not endpoint_allowed(endpoint):
        return Response({"error": "Unsupported push service."}, status=400)
    PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={"user": request.user, "p256dh": p256dh, "auth": auth, "failures": 0,
                  "user_agent": (request.META.get("HTTP_USER_AGENT") or "")[:300]},
    )
    return Response({"ok": True})


@api_view(["POST"])
def push_unsubscribe(request):
    endpoint = str((request.data or {}).get("endpoint") or "")
    PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
    return Response({"ok": True})
