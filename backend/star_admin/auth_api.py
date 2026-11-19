"""Sign-in and forgot-password API.

ONE sign-in endpoint for everybody (replaces the old admin_login / staff_login pair):

    POST /api/auth/login/           {identifier, password}  -> {user: {..., role}}

`identifier` is the admin's email / username, or the User ID (S0001 / M0001) of a staff / manager account.
The role comes from the account itself
(superuser = admin, is_staff = staff), so the React app just routes on `user.role` after sign-in.
Wrong passwords are throttled: MAX_ATTEMPTS failures lock that identifier (and, more loosely,
that IP address) for BLOCK_MINUTES, using the existing LoginAttempt table - no migration needed.

Forgot User ID / forgot password work for admin, manager and staff alike, through the e-mail address saved on
the account (Settings > Staff & Roles makes the e-mail a required field). When the email / User ID is not
registered the page says so (404), so a mistyped address is noticed at once; the requests are throttled per IP.

    POST /api/auth/forgot-user-id/              {email}       -> e-mails the User ID to that address
    POST /api/auth/forgot-password/             {identifier}  -> e-mails a reset link (identifier = email, username or User ID)
    GET  /api/auth/reset-password/<uid>/<token>/              -> {valid, username}  (is the link still good?)
    POST /api/auth/reset-password/              {uid, token, password, confirm_password}

The reset link opens the sign-in page (<ADMIN_APP_URL>/login?uid=..&token=..). It is Django's password-reset
token: it works once (it stops working as soon as the password changes) and expires on its own.
Which site the link points at: ADMIN_APP_URL (env) -> the browser Origin when it is one of the allowed
CORS origins -> this server's own address.
"""
import logging
import math
import os
from datetime import timedelta

from django.conf import settings as django_settings
from django.contrib.auth import login
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db.models import Q
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .api_views import MIN_PASSWORD_LEN, user_payload
from .models import LoginAttempt
from .shops_api import _email_configured

logger = logging.getLogger(__name__)

MAX_REQUESTS_PER_IP = 10  # forgot-id / forgot-password requests per IP per lock window (every one can send an email)
MAX_PASSWORD_LEN = 128

NO_ID_ACCOUNT = "No account found with this email address."
NO_PW_ACCOUNT = "No account found for this email or User ID."
NO_EMAIL_SAVED = "This account has no email saved. Please ask the admin to add one."
LINK_BAD = "This link has expired or was already used. Please request a new one."


# ---------------------------------------------------------------- sign in
MAX_ATTEMPTS = 5          # wrong passwords per account before it is locked
MAX_ATTEMPTS_PER_IP = 20  # looser, because a whole shop can share one IP address
BLOCK_MINUTES = 10

INVALID = "Incorrect email/username or password."
BLOCKED = "Your account has been blocked by the admin."
_DUMMY_HASH = make_password("not-a-real-password")  # keeps timing similar for unknown users


def _client_ip(request):
    # Behind a proxy (Procfile / Heroku style) the router appends the real client IP last.
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    ip = forwarded.split(",")[-1].strip() if forwarded else request.META.get("REMOTE_ADDR", "")
    return ip or "unknown"


def _locked_seconds(key, limit):
    """Seconds left on the lock for `key`, or 0 when it is not locked."""
    rec = LoginAttempt.objects.filter(email=key).first()
    if rec is None or rec.attempts < limit:
        return 0
    left = timedelta(minutes=BLOCK_MINUTES) - (timezone.now() - rec.last_attempt)
    if left.total_seconds() > 0:
        return math.ceil(left.total_seconds())
    rec.delete()  # lock has run out
    return 0


def _count_failure(key):
    rec, _ = LoginAttempt.objects.get_or_create(email=key)
    if timezone.now() - rec.last_attempt > timedelta(minutes=BLOCK_MINUTES):
        rec.attempts = 0  # old failures no longer count
    rec.attempts += 1
    rec.save()


def _find_account(identifier):
    """Admin signs in with email or username, staff / manager with their User ID (S0001 / M0001, any case).
    -> User or None (admin/staff only)."""
    query = User.objects.filter(is_superuser=True, username__iexact=identifier)
    user = query.first()
    if user is None and "@" in identifier:
        user = User.objects.filter(is_superuser=True, email__iexact=identifier).first()
    if user is None:
        user = User.objects.filter(is_staff=True, is_superuser=False, username__iexact=identifier).first()
    return user


def _too_many(seconds):
    minutes = max(1, math.ceil(seconds / 60))
    return Response(
        {"error": f"Too many failed attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}.",
         "retry_after": seconds},
        status=429,
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def sign_in(request):
    identifier = (request.data.get("identifier") or "").strip()
    password = request.data.get("password") or ""
    if not identifier or not password:
        return Response({"error": "Please enter both fields"}, status=400)

    user_key = f"u:{identifier.lower()}"[:250]
    ip_key = f"ip:{_client_ip(request)}"[:250]

    wait = max(_locked_seconds(user_key, MAX_ATTEMPTS), _locked_seconds(ip_key, MAX_ATTEMPTS_PER_IP))
    if wait:
        return _too_many(wait)

    user = _find_account(identifier)
    password_ok = check_password(password, user.password if user else _DUMMY_HASH) and user is not None

    if not password_ok:
        _count_failure(user_key)
        _count_failure(ip_key)
        wait = _locked_seconds(user_key, MAX_ATTEMPTS)
        return _too_many(wait) if wait else Response({"error": INVALID}, status=400)

    if not user.is_active:  # only said after the password is right, so it reveals nothing
        return Response({"error": BLOCKED}, status=403)

    LoginAttempt.objects.filter(email=user_key).delete()
    login(request, user)
    return Response({"user": user_payload(user)})


# ------------------------------------------------------- forgot User ID / password
def _from_email():
    return getattr(django_settings, "DEFAULT_FROM_EMAIL", None) or getattr(django_settings, "EMAIL_HOST_USER", None)


def _throttled(request, scope):
    key = f"adm:{scope}:ip:{_client_ip(request)}"[:250]
    wait = _locked_seconds(key, MAX_REQUESTS_PER_IP)
    if wait:
        return _too_many(wait)
    _count_failure(key)  # every request counts, not only failures: each one can send an email
    return None


def _members():
    """Active admin / manager / staff accounts (never shop or vendor accounts)."""
    return User.objects.filter(is_active=True).filter(Q(is_staff=True) | Q(is_superuser=True))


def _app_url(request):
    configured = (os.getenv("ADMIN_APP_URL") or "").strip()
    if configured:
        return configured.rstrip("/")
    origin = (request.META.get("HTTP_ORIGIN") or "").rstrip("/")
    allowed = list(getattr(django_settings, "CORS_ALLOWED_ORIGINS", []))
    if origin and origin in allowed:  # only an origin we already trust: a forged Origin must not steer the link
        return origin
    return request.build_absolute_uri("/").rstrip("/")


def _reset_link(request, user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{_app_url(request)}/login?uid={uid}&token={token}"


def _user_from_link(uid, token):
    """-> the account a valid, unused reset link belongs to, else None."""
    try:
        pk = int(force_str(urlsafe_base64_decode(uid)))
    except (TypeError, ValueError, OverflowError):
        return None
    user = _members().filter(pk=pk).first()
    if user is None or not default_token_generator.check_token(user, token):
        return None
    return user


def _mask_email(email):
    """ravi@gmail.com -> r***@gmail.com (shown on screen so the person can see where the mail went)."""
    name, _, domain = email.partition("@")
    return f"{name[:1]}***@{domain}"


def _who(user):
    return f"{user.first_name} {user.last_name}".strip() or user.username


@api_view(["POST"])
@permission_classes([AllowAny])
def forgot_user_id(request):
    email = (request.data.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return Response({"error": "Please enter your registered email address."}, status=400)
    limited = _throttled(request, "fid")
    if limited:
        return limited

    user = _members().filter(email__iexact=email).first()
    if user is None:
        return Response({"error": NO_ID_ACCOUNT}, status=404)

    if not _email_configured():
        return Response({"error": "Email delivery is not available right now. Please ask the admin."}, status=503)
    try:
        send_mail(
            "Your Star Offset User ID",
            f"Hello {_who(user)},\n\n"
            f"Your User ID is: {user.username}\n\n"
            "Use it on the sign-in page together with your password.\n"
            "If you did not ask for this, you can ignore this email.",
            _from_email(), [user.email], fail_silently=False,
        )
    except Exception:
        logger.exception("Could not send the User ID email")
        return Response({"error": "Could not send the email right now. Please try again later."}, status=503)
    return Response({"ok": True, "message": f"Your User ID has been sent to {_mask_email(user.email)}."})


@api_view(["POST"])
@permission_classes([AllowAny])
def forgot_password(request):
    identifier = (request.data.get("identifier") or "").strip()[:254]
    if not identifier:
        return Response({"error": "Please enter your email or User ID."}, status=400)
    limited = _throttled(request, "fpw")
    if limited:
        return limited

    user = _members().filter(username__iexact=identifier).first()
    if user is None and "@" in identifier:
        user = _members().filter(email__iexact=identifier).first()
    if user is None:
        return Response({"error": NO_PW_ACCOUNT}, status=404)
    if not user.email:
        return Response({"error": NO_EMAIL_SAVED}, status=400)

    if not _email_configured():
        return Response({"error": "Email delivery is not available right now. Please ask the admin."}, status=503)
    try:
        send_mail(
            "Reset your Star Offset password",
            f"Hello {_who(user)},\n\n"
            f"Open this link to choose a new password for User ID {user.username}:\n\n"
            f"{_reset_link(request, user)}\n\n"
            "The link works only once. If you did not ask for it, you can ignore this email - your password stays as it is.",
            _from_email(), [user.email], fail_silently=False,
        )
    except Exception:
        logger.exception("Could not send the password reset email")
        return Response({"error": "Could not send the email right now. Please try again later."}, status=503)
    return Response({"ok": True, "message": f"A password reset link has been sent to {_mask_email(user.email)}."})


@api_view(["GET"])
@permission_classes([AllowAny])
def reset_check(request, uid, token):
    user = _user_from_link(uid, token)
    if user is None:
        return Response({"valid": False})
    return Response({"valid": True, "username": user.username})


@api_view(["POST"])
@permission_classes([AllowAny])
def reset_password(request):
    d = request.data
    user = _user_from_link(d.get("uid") or "", d.get("token") or "")
    if user is None:
        return Response({"error": LINK_BAD}, status=400)

    password = d.get("password") or ""
    if not password or not d.get("confirm_password"):
        return Response({"error": "All fields are required"}, status=400)
    if password != d.get("confirm_password"):
        return Response({"error": "Passwords do not match"}, status=400)
    if len(password) < MIN_PASSWORD_LEN:
        return Response({"error": f"Password must be at least {MIN_PASSWORD_LEN} characters"}, status=400)
    if len(password) > MAX_PASSWORD_LEN:
        return Response({"error": f"Password can be at most {MAX_PASSWORD_LEN} characters"}, status=400)

    user.set_password(password)  # also kills the link: the token depends on the old password hash
    user.save()
    # a successful reset lifts a "too many wrong passwords" lock on this account
    LoginAttempt.objects.filter(email__in=[f"u:{user.username.lower()}", f"u:{user.email.lower()}"]).delete()
    return Response({"ok": True})