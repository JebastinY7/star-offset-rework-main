"""Shop Portal sign-in helpers that work BEFORE the shop is signed in.

    GET  /api/shop/auth/logo/?user_id=2026S0001   -> the shop's logo image (204 when there is none / unknown ID)
    POST /api/shop/auth/forgot-user-id/           {email}               -> emails the User ID to the shop's email
    POST /api/shop/auth/forgot-password/          {user_id}             -> emails a 6-digit OTP (also used to resend)
    POST /api/shop/auth/verify-otp/               {otp}                 -> OTP ok, allows ONE password reset
    POST /api/shop/auth/reset-password/           {password, confirm_password}

Forgot password = "confirm the User ID, then choose a new password".  A User ID alone is NOT proof of
ownership (IDs are sequential, so anybody could guess 2026S0002), therefore the User ID is confirmed by a
one-time code sent to the e-mail address registered for that shop.  Same design as the admin reset in
auth_api.py:

  * the steps are tied together by the session (shop_reset_user_id / shop_reset_verified)
  * /forgot-user-id/ and /forgot-password/ answer the same way whether or not the account exists
  * the OTP expires after OTP_VALID_MINUTES, allows MAX_OTP_ATTEMPTS wrong tries and is 6 digits from `secrets`
  * requests are throttled per IP with the existing LoginAttempt table (no migration needed)
  * a successful reset also lifts a "too many wrong passwords" lock and the "must change password" flag

Only active shop accounts (non staff, non superuser) can use these endpoints, and the shop must still have
portal access.
"""
import logging
import secrets
from datetime import timedelta

from django.conf import settings as django_settings
from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .api_views import MIN_PASSWORD_LEN
from .auth_api import _client_ip, _count_failure, _locked_seconds, _too_many
from .models import LoginAttempt, PasswordResetOTP, Shop, ShopLogo
from .shops_api import _email_configured

logger = logging.getLogger(__name__)

MAX_OTP_ATTEMPTS = 5
OTP_VALID_MINUTES = 10
RESEND_SECONDS = 30       # keep in sync with the countdown in ForgotPassword.jsx
MAX_REQUESTS_PER_IP = 10  # forgot-id / forgot-password requests per IP per lock window (10 minutes)
MAX_PASSWORD_LEN = 128

GENERIC_ID_SENT = {"ok": True, "message": "If this email belongs to a shop account, its User ID has been sent to it."}
GENERIC_OTP_SENT = {"ok": True, "message": "If this User ID exists, a verification code has been sent to its registered email."}
EXPIRED = "Session expired. Please start again."


def _eligible_shop(**lookup):
    """An active shop account that may still use the portal, or None."""
    shop = (Shop.objects.select_related("user")
            .filter(user__is_staff=False, user__is_superuser=False, user__is_active=True, portal_access=True, **lookup)
            .first())
    return shop


def _throttled(request, scope):
    key = f"shop:{scope}:ip:{_client_ip(request)}"[:250]
    wait = _locked_seconds(key, MAX_REQUESTS_PER_IP)
    if wait:
        return _too_many(wait)
    _count_failure(key)  # every request counts, not only failures: each one can send an email
    return None


def _from_email():
    return getattr(django_settings, "DEFAULT_FROM_EMAIL", None) or getattr(django_settings, "EMAIL_HOST_USER", None)


def _reset_shop(request):
    uid = request.session.get("shop_reset_user_id")
    if not uid:
        return None
    return _eligible_shop(user_id=uid)


def _clear_reset(request):
    request.session.pop("shop_reset_user_id", None)
    request.session.pop("shop_reset_verified", None)


# ------------------------------------------------------------- logo by User ID
@api_view(["GET"])
@permission_classes([AllowAny])
def shop_public_logo(request):
    """The sign-in page shows the shop's own logo once its User ID is typed.  Logos are not secret (they are
    printed on the shop's own material); nothing else about the shop is ever returned from here."""
    user_id = (request.query_params.get("user_id") or "").strip()[:150]
    logo = None
    if user_id:
        logo = (ShopLogo.objects.filter(shop__user__username__iexact=user_id, shop__user__is_staff=False,
                                        shop__user__is_superuser=False).first())
    if logo is None:
        return HttpResponse(status=204)  # 204, not 404: the page just keeps the blank logo box, no console noise
    resp = HttpResponse(bytes(logo.data), content_type=logo.content_type)
    resp["Cache-Control"] = "private, max-age=60"
    resp["X-Content-Type-Options"] = "nosniff"
    return resp


# ------------------------------------------------------------- forgot User ID
@api_view(["POST"])
@permission_classes([AllowAny])
def shop_forgot_user_id(request):
    email = (request.data.get("email") or "").strip().lower()
    if not email:
        return Response({"error": "Please enter your registered email address."}, status=400)
    limited = _throttled(request, "fid")
    if limited:
        return limited

    shop = _eligible_shop(email__iexact=email)
    if shop is None:
        return Response(GENERIC_ID_SENT)  # do not reveal which emails exist

    if not _email_configured():
        return Response({"error": "Email delivery is not available right now. Please contact Star Offset."}, status=503)
    try:
        send_mail(
            "Your Shop Portal User ID",
            f"Hello {shop.owner_name},\n\n"
            f"Your User ID for the {shop.name} Shop Portal account is: {shop.user.username}\n\n"
            "Use it on the sign-in page together with your password.\n"
            "If you did not ask for this, you can ignore this email.",
            _from_email(), [shop.email], fail_silently=False,
        )
    except Exception:
        logger.exception("Could not send the shop User ID email")
        return Response({"error": "Could not send the email right now. Please try again later."}, status=503)
    return Response(GENERIC_ID_SENT)


# ------------------------------------------------------------ forgot password
@api_view(["POST"])
@permission_classes([AllowAny])
def shop_forgot_password(request):
    user_id = (request.data.get("user_id") or "").strip()
    if not user_id:
        return Response({"error": "Please enter your User ID."}, status=400)
    limited = _throttled(request, "fpw")
    if limited:
        return limited

    shop = _eligible_shop(user__username__iexact=user_id)
    if shop is None:
        _clear_reset(request)
        return Response(GENERIC_OTP_SENT)  # do not reveal which User IDs exist

    user = shop.user
    request.session["shop_reset_user_id"] = user.id
    request.session.pop("shop_reset_verified", None)

    last = PasswordResetOTP.objects.filter(user=user).order_by("created_at").last()
    if last and timezone.now() - last.created_at < timedelta(seconds=RESEND_SECONDS):
        return Response(GENERIC_OTP_SENT)  # too soon: keep the code already sent

    if not _email_configured():
        return Response({"error": "Email delivery is not available right now. Please contact Star Offset."}, status=503)

    PasswordResetOTP.objects.filter(user=user).delete()
    otp = f"{secrets.randbelow(900000) + 100000}"
    PasswordResetOTP.objects.create(user=user, otp=otp)
    try:
        send_mail(
            "Your Shop Portal verification code",
            f"Your verification code is {otp}. It is valid for {OTP_VALID_MINUTES} minutes.\n"
            "Use it to choose a new password. If you did not ask for it, you can ignore this email.",
            _from_email(), [shop.email], fail_silently=False,
        )
    except Exception:
        logger.exception("Could not send the shop password reset OTP")
        PasswordResetOTP.objects.filter(user=user).delete()
        return Response({"error": "Could not send the email right now. Please try again later."}, status=503)
    return Response(GENERIC_OTP_SENT)


@api_view(["POST"])
@permission_classes([AllowAny])
def shop_verify_otp(request):
    shop = _reset_shop(request)
    if shop is None:
        return Response({"error": EXPIRED}, status=400)
    user = shop.user

    otp = (request.data.get("otp") or "").strip()
    record = PasswordResetOTP.objects.filter(user=user).order_by("created_at").last()
    if record is None or timezone.now() - record.created_at > timedelta(minutes=OTP_VALID_MINUTES):
        if record:
            record.delete()
        return Response({"error": "The code has expired. Request a new one."}, status=400)

    if not secrets.compare_digest(record.otp, otp):
        record.attempts += 1
        record.save(update_fields=["attempts"])
        if record.attempts >= MAX_OTP_ATTEMPTS:
            record.delete()
            return Response({"error": "Too many wrong attempts. Request a new code."}, status=400)
        left = MAX_OTP_ATTEMPTS - record.attempts
        return Response({"error": f"Incorrect code. {left} attempt{'s' if left != 1 else ''} left."}, status=400)

    record.delete()
    request.session["shop_reset_verified"] = True
    return Response({"ok": True, "shop_name": shop.name, "user_id": user.username})


@api_view(["POST"])
@permission_classes([AllowAny])
def shop_reset_password(request):
    shop = _reset_shop(request)
    if shop is None or not request.session.get("shop_reset_verified"):
        return Response({"error": EXPIRED}, status=400)

    password = request.data.get("password") or ""
    confirm = request.data.get("confirm_password") or ""
    if not password or not confirm:
        return Response({"error": "All fields are required."}, status=400)
    if password != confirm:
        return Response({"error": "Passwords do not match."}, status=400)
    if len(password) < MIN_PASSWORD_LEN:
        return Response({"error": f"Password must be at least {MIN_PASSWORD_LEN} characters."}, status=400)
    if len(password) > MAX_PASSWORD_LEN:
        return Response({"error": f"Password can be at most {MAX_PASSWORD_LEN} characters."}, status=400)

    user = shop.user
    user.set_password(password)  # also kills any old setup link and signs the shop out of other sessions
    user.save()
    if shop.must_change_password:
        shop.must_change_password = False
        shop.save(update_fields=["must_change_password"])
    PasswordResetOTP.objects.filter(user=user).delete()
    LoginAttempt.objects.filter(email=f"shop:u:{user.username.lower()}"[:250]).delete()  # lift a wrong-password lock
    _clear_reset(request)
    return Response({"ok": True})
