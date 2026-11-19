"""Shop Portal API - what the shop-portal React app (separate website) talks to.

    GET  /api/shop/me/                                  -> {shop: {...} | null}
    GET  /api/shop/dashboard/                           -> {stats: {total, pending, quotes_received}, recent: [...]}
    POST /api/shop/auth/login/                          {username, password} -> {shop}
    POST /api/shop/auth/logout/
    GET  /api/shop/auth/setup-password/<uid>/<token>/   -> {valid, shop_name?, username?}
    POST /api/shop/auth/setup-password/                 {uid, token, password, confirm_password}

shop.must_change_password is true while the shop still uses a temporary password typed by the admin.  Until
it is changed (POST /api/shop/password/change/) every other shop-only endpoint answers 403, and the portal
shows a "choose your new password" screen instead of the app.

Rules:
  * A shop signs in with the username the admin created under Settings > Shop Management.
  * The account must be Active AND have portal access enabled (the two switches the admin controls).
  * Wrong passwords are throttled with the same LoginAttempt rules as the admin sign-in.
  * Every shop-only endpoint added later must use IsShopUser and filter by request.user.shop_profile -
    a shop must only ever see its own data.  middleware.ShopFenceMiddleware additionally keeps shop
    accounts away from every non-shop /api/ URL.
"""
import logging

from django.contrib.auth import login, logout
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.db.models import Count, Q
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response

from .api_views import MIN_PASSWORD_LEN
from .auth_api import (MAX_ATTEMPTS, MAX_ATTEMPTS_PER_IP, _client_ip, _count_failure, _locked_seconds, _too_many)
from .models import LoginAttempt, Shop, ShopLogo, ShopQuotationRequest

logger = logging.getLogger(__name__)

INVALID = "Incorrect username or password."
INACTIVE = "Your account is inactive. Please contact Star Offset."
NO_PORTAL = "Portal access is disabled for your account. Please contact Star Offset."
_DUMMY_HASH = make_password("not-a-real-password")  # keeps timing similar for unknown users


def _shop_of(user):
    """The Shop of a signed-in shop account, or None (admin / staff / anonymous / not a shop)."""
    if not user or not user.is_authenticated or user.is_staff or user.is_superuser:
        return None
    return Shop.objects.select_related("user").filter(user=user).first()


PASSWORD_CHANGE_PATH = "/api/shop/password/change/"


class IsShopUser(BasePermission):
    """Signed-in shop with an active account and portal access. Use on every shop-only endpoint.

    A shop that still has an admin-typed temporary password may only reach the change-password endpoint."""

    message = "Please choose a new password first."

    def has_permission(self, request, view):
        shop = _shop_of(request.user)
        if not (shop and request.user.is_active and shop.portal_access):
            self.message = "You do not have permission to perform this action."
            return False
        if shop.must_change_password and request.path_info != PASSWORD_CHANGE_PATH:
            self.message = "Please choose a new password first."
            return False
        return True


def logo_url(shop):
    """URL of the shop's uploaded logo ('' when it has none). ?v= changes whenever the logo does."""
    stamp = ShopLogo.objects.filter(shop=shop).values_list("updated_at", flat=True).first()
    return f"/api/shop/logo/?v={int(stamp.timestamp())}" if stamp else ""


def shop_payload(shop):
    return {
        "id": shop.id,
        "name": shop.name,
        "must_change_password": shop.must_change_password,
        "logo_url": logo_url(shop),
        "owner_name": shop.owner_name,
        "phone": shop.phone,
        "email": shop.email,
        "username": shop.user.username,
        "gst_number": shop.gst_number,
        "address": shop.address,
    }


@api_view(["GET"])
@permission_classes([AllowAny])
def shop_me(request):
    shop = _shop_of(request.user)
    if shop and request.user.is_active and shop.portal_access:
        return Response({"shop": shop_payload(shop)})
    return Response({"shop": None})


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_dashboard(request):
    """Numbers + latest requests for the signed-in shop only."""
    shop = request.user.shop_profile
    mine = ShopQuotationRequest.objects.filter(shop=shop)
    counts = mine.aggregate(
        total=Count("id"),
        pending=Count("id", filter=Q(status="pending")),
        received=Count("id", filter=Q(status__in=["quoted", "responded"])),
    )
    recent = [
        {
            "id": r.id,
            "request_no": r.request_no,
            "date": r.created_at.date().isoformat(),
            "items": r.items_count,
            "amount": str(r.total_amount),
            "status": r.status,
            "status_label": r.get_status_display(),
        }
        for r in mine.order_by("-created_at", "-id")[:5]
    ]
    return Response({
        "stats": {"total": counts["total"], "pending": counts["pending"], "quotes_received": counts["received"]},
        "recent": recent,
    })


@api_view(["POST"])
@permission_classes([AllowAny])
def shop_login(request):
    username = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""
    if not username or not password:
        return Response({"error": "Please enter both fields"}, status=400)

    user_key = f"shop:u:{username.lower()}"[:250]
    ip_key = f"shop:ip:{_client_ip(request)}"[:250]
    wait = max(_locked_seconds(user_key, MAX_ATTEMPTS), _locked_seconds(ip_key, MAX_ATTEMPTS_PER_IP))
    if wait:
        return _too_many(wait)

    shop = (Shop.objects.select_related("user")
            .filter(user__username__iexact=username, user__is_staff=False, user__is_superuser=False).first())
    user = shop.user if shop else None
    password_ok = check_password(password, user.password if user else _DUMMY_HASH) and user is not None

    if not password_ok:
        _count_failure(user_key)
        _count_failure(ip_key)
        wait = _locked_seconds(user_key, MAX_ATTEMPTS)
        return _too_many(wait) if wait else Response({"error": INVALID}, status=400)

    # only said after the password is right, so it reveals nothing to a guesser
    if not user.is_active:
        return Response({"error": INACTIVE}, status=403)
    if not shop.portal_access:
        return Response({"error": NO_PORTAL}, status=403)

    LoginAttempt.objects.filter(email=user_key).delete()
    login(request, user)
    return Response({"shop": shop_payload(shop)})


@api_view(["POST"])
@permission_classes([AllowAny])
def shop_logout(request):
    if _shop_of(request.user):  # never sign an admin out from here
        logout(request)
    return Response({"ok": True})


# ------------------------------------------------------- password setup link
def _user_from_link(uid, token):
    """-> Shop for a valid, unused setup link, else None."""
    try:
        pk = int(force_str(urlsafe_base64_decode(uid)))
    except (TypeError, ValueError, OverflowError):
        return None
    user = User.objects.filter(pk=pk, is_staff=False, is_superuser=False).first()
    if user is None or not default_token_generator.check_token(user, token):
        return None
    return Shop.objects.select_related("user").filter(user=user).first()


@api_view(["GET"])
@permission_classes([AllowAny])
def shop_setup_check(request, uid, token):
    shop = _user_from_link(uid, token)
    if shop is None:
        return Response({"valid": False})
    return Response({"valid": True, "shop_name": shop.name, "username": shop.user.username})


@api_view(["POST"])
@permission_classes([AllowAny])
def shop_setup_password(request):
    d = request.data
    shop = _user_from_link(d.get("uid") or "", d.get("token") or "")
    if shop is None:
        return Response({"error": "This link has expired or was already used. Ask the admin for a new one."}, status=400)
    password = d.get("password") or ""
    if len(password) < MIN_PASSWORD_LEN:
        return Response({"error": f"Password must be at least {MIN_PASSWORD_LEN} characters"}, status=400)
    if password != (d.get("confirm_password") or ""):
        return Response({"error": "Passwords do not match"}, status=400)
    shop.user.set_password(password)  # also kills the link: the token depends on the old password hash
    shop.user.save()
    if shop.must_change_password:
        shop.must_change_password = False
        shop.save(update_fields=["must_change_password"])
    return Response({"ok": True})