"""Change password for a signed-in shop.

    POST /api/shop/password/change/   {current_password, new_password, confirm_password}

* The current password must be right.  Wrong guesses are counted with the same lock as the sign-in
  (5 wrong tries -> locked for 10 minutes), so a borrowed, still signed-in browser cannot be used to
  guess the password.
* Exception: a shop that was just given a temporary password (shop.must_change_password) has only
  signed in with it a moment ago, so it is not asked for it again - it just picks a new one, which must
  differ from the temporary one.  This also lifts the "change your password first" lock on the portal.
* The new password follows the portal's existing rule (MIN_PASSWORD_LEN) and must differ from the old one.
* This browser stays signed in; every other signed-in session of the shop is signed out.
"""
from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.hashers import check_password
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .api_views import MIN_PASSWORD_LEN
from .auth_api import MAX_ATTEMPTS, _count_failure, _locked_seconds, _too_many
from .models import LoginAttempt
from .shop_portal_api import IsShopUser

MAX_LEN = 128


@api_view(["POST"])
@permission_classes([IsShopUser])
def shop_change_password(request):
    user = request.user
    shop = user.shop_profile
    forced = shop.must_change_password
    d = request.data
    current = d.get("current_password") or ""
    new = d.get("new_password") or ""
    confirm = d.get("confirm_password") or ""

    key = f"shop:pw:{user.pk}"
    wait = _locked_seconds(key, MAX_ATTEMPTS)
    if wait:
        return _too_many(wait)

    if not forced:
        if not current:
            return Response({"error": "Enter your current password."}, status=400)
        if not check_password(current, user.password):
            _count_failure(key)
            wait = _locked_seconds(key, MAX_ATTEMPTS)
            return _too_many(wait) if wait else Response({"error": "Your current password is incorrect."}, status=400)

    if len(new) < MIN_PASSWORD_LEN:
        return Response({"error": f"New password must be at least {MIN_PASSWORD_LEN} characters."}, status=400)
    if len(new) > MAX_LEN:
        return Response({"error": f"New password can be at most {MAX_LEN} characters."}, status=400)
    if (new == current) if not forced else check_password(new, user.password):
        return Response({"error": "Your new password must be different from your %s password." % ("temporary" if forced else "current")}, status=400)
    if new != confirm:
        return Response({"error": "The new passwords do not match."}, status=400)

    user.set_password(new)
    user.save(update_fields=["password"])
    if forced:
        shop.must_change_password = False
        shop.save(update_fields=["must_change_password"])
    update_session_auth_hash(request, user)  # keeps this browser signed in, signs the others out
    LoginAttempt.objects.filter(email=key).delete()
    return Response({"ok": True})