"""Settings > Staff & Roles API (admin only).

    GET    /api/settings/staff/                 -> {"staff": [...]}
    POST   /api/settings/staff/                 {name?, phone?, email?, username?, password, role}
    PATCH  /api/settings/staff/<id>/            {name?, phone?, email?, username?, role?}
    DELETE /api/settings/staff/<id>/
    POST   /api/settings/staff/<id>/toggle/     block / unblock
    POST   /api/settings/staff/<id>/password/   {new_password}

Roles:
    admin    -> User.is_superuser = True  (the admin's username is typed in by the admin who creates the account)
    manager  -> is_staff, StaffProfile.role = "manager"   User ID is generated: M0001, M0002, ...
    staff    -> is_staff, StaffProfile.role = "staff"     User ID is generated: S0001, S0002, ...
Every account needs an email: the User ID and the password-reset link are sent there (Login > Forgot ...).
The User ID is the login (User.username). It is never typed in for a manager / staff account and a
username sent for them is ignored. When a manager is made staff (or the other way round, or an admin is
made manager / staff) a new ID of the new series is issued; every other edit keeps the ID as it is.
The mobile number and the manager/staff role live in StaffProfile.  Your own account is read-only here
(change your password under Security) so the last admin can never lock themselves out.

Membership (/settings/membership/) and Security (/settings/admin-password/) are unchanged.
"""
import re
from datetime import timedelta

from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .api_views import MIN_PASSWORD_LEN, IsSuperuser
from .models import ActivityLog, StaffActivity, StaffProfile, user_role

NAME_MAX = 100
ROLES = ("admin", "manager", "staff")
SELF_MSG = "This is your own account - change your password under Security."
EMAIL_NEEDED = "Email is required - the User ID and password reset link are sent to it"

ID_PREFIX = {"manager": "M", "staff": "S"}          # role -> first letter of the User ID
MEMBER_ID_RX = re.compile(r"^([MS])(\d{4,})$", re.I)  # S0001, M0001 ... (shop / vendor IDs start with the year)


def _next_member_id(role):
    """Next free User ID for a manager (M0001, M0002 ...) or staff (S0001, S0002 ...) account.

    One running series per role. The highest number ever used counts - also by accounts that were deleted
    (their name stays in the activity log) - so an old ID is never given to a new person.
    """
    prefix = ID_PREFIX[role]
    highest = 0
    names = list(User.objects.filter(username__istartswith=prefix).values_list("username", flat=True))
    names += list(ActivityLog.objects.filter(username__istartswith=prefix).values_list("username", flat=True).distinct())
    for name in names:
        m = MEMBER_ID_RX.match(name)
        if m and m.group(1).upper() == prefix:
            highest = max(highest, int(m.group(2)))
    return f"{prefix}{highest + 1:04d}"


def _display_name(u):
    return f"{u.first_name} {u.last_name}".strip()


def _split_name(name):
    first, _, last = (name or "").strip().partition(" ")
    return first.strip(), last.strip()


def _row(u, seen, profiles, me_id):
    last_seen = seen.get(u.id)
    online = bool(last_seen and (timezone.now() - last_seen) < timedelta(minutes=5))
    profile = profiles.get(u.id)
    if u.is_superuser:
        role = "admin"
    else:
        role = profile.role if profile else "staff"
    return {
        "id": u.id,
        "username": u.username,
        "name": _display_name(u),
        "email": u.email,
        "phone": profile.phone if profile else "",
        "role": role,
        "is_active": u.is_active,
        "is_online": online,
        "last_seen": last_seen,
        "is_self": u.id == me_id,
        "editable": u.id != me_id,  # your own account is managed under Security
    }


def _list(request):
    seen = dict(StaffActivity.objects.values_list("user_id", "last_seen"))
    profiles = {p.user_id: p for p in StaffProfile.objects.all()}
    users = User.objects.filter(Q(is_staff=True) | Q(is_superuser=True)).order_by("-is_superuser", "username")
    return [_row(u, seen, profiles, request.user.id) for u in users]


def _member(pk):
    """Any admin / manager / staff account."""
    return User.objects.filter(Q(is_staff=True) | Q(is_superuser=True), pk=pk).first()


def _clean_name(raw):
    name = " ".join((raw or "").split())
    if len(name) > NAME_MAX:
        raise ValueError(f"Name can be at most {NAME_MAX} characters")
    return name


def _clean_phone(raw, exclude_user_id=None):
    """10 digits ('+91' / '91' / spaces / dashes allowed in the input), or '' when left empty."""
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if not digits:
        return ""
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) != 10:
        raise ValueError("Mobile number must be 10 digits")
    taken = StaffProfile.objects.filter(phone=digits)
    if exclude_user_id:
        taken = taken.exclude(user_id=exclude_user_id)
    if taken.exists():
        raise ValueError("Mobile number already exists")
    return digits


def _clean_email(raw, exclude_user_id=None):
    email = (raw or "").strip().lower()
    if not email:
        return ""
    try:
        validate_email(email)
    except ValidationError:
        raise ValueError("Enter a valid email address")
    taken = User.objects.filter(email__iexact=email)
    if exclude_user_id:
        taken = taken.exclude(pk=exclude_user_id)
    if taken.exists():
        raise ValueError("Email already exists")
    return email


def _clean_username(raw, exclude_user_id=None):
    username = (raw or "").strip()
    if not username:
        raise ValueError("Username cannot be empty")
    taken = User.objects.filter(username__iexact=username)
    if exclude_user_id:
        taken = taken.exclude(pk=exclude_user_id)
    if taken.exists():
        raise ValueError("Username already exists")
    return username


def _clean_role(raw):
    role = (raw or "").strip().lower()
    if role not in ROLES:
        raise ValueError("Choose a role: Admin, Manager or Staff")
    return role


def _apply_role(user, role):
    """Set the account flags for `role` and keep manager/staff in StaffProfile (caller saves the user)."""
    user.is_staff = True
    user.is_superuser = role == "admin"
    if role != "admin":
        profile, _ = StaffProfile.objects.get_or_create(user=user)
        profile.role = role
        profile.save(update_fields=["role"])


@api_view(["GET", "POST"])
@permission_classes([IsSuperuser])
def settings_staff(request):
    if request.method != "POST":
        return Response({"staff": _list(request)})

    d = request.data
    password = d.get("password") or ""
    try:
        role = _clean_role(d.get("role") or "staff")
        # manager / staff: the User ID is generated below; only an admin gets a typed username
        username = _clean_username(d.get("username")) if role == "admin" else ""
        name = _clean_name(d.get("name"))
        phone = _clean_phone(d.get("phone"))
        email = _clean_email(d.get("email"))
        if not email:
            raise ValueError(EMAIL_NEEDED)
        if not password:
            raise ValueError("Password required")
        if len(password) < MIN_PASSWORD_LEN:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LEN} characters")
    except ValueError as e:
        return Response({"error": str(e)}, status=400)

    first, last = _split_name(name)
    for _ in range(5):  # a second admin saving at the same moment can take the same next ID: try again
        try:
            with transaction.atomic():
                if role != "admin":
                    username = _next_member_id(role)
                user = User.objects.create_user(username=username, email=email, password=password,
                                                first_name=first, last_name=last)
                _apply_role(user, role)
                user.save()
                StaffProfile.objects.update_or_create(user=user, defaults={"phone": phone})
            break
        except IntegrityError:
            if role == "admin":
                return Response({"error": "Username already exists"}, status=400)
    else:
        return Response({"error": "Could not generate a User ID right now. Please try again."}, status=409)
    return Response({"staff": _list(request), "username": user.username}, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsSuperuser])
def settings_staff_detail(request, pk):
    staff = _member(pk)
    if staff is None:
        return Response({"error": "Staff not found"}, status=404)
    if staff.pk == request.user.pk:
        return Response({"error": SELF_MSG}, status=400)

    if request.method == "DELETE":
        staff.delete()
        return Response({"staff": _list(request)})

    d = request.data
    try:
        old_role = user_role(staff)
        role = _clean_role(d.get("role")) if "role" in d else old_role
        # the User ID of a manager / staff account is generated and cannot be edited; only an admin's username can
        if role == "admin" and "username" in d:
            staff.username = _clean_username(d.get("username"), staff.pk)
        if "name" in d:
            staff.first_name, staff.last_name = _split_name(_clean_name(d.get("name")))
        if "email" in d:
            staff.email = _clean_email(d.get("email"), staff.pk)
        phone = _clean_phone(d.get("phone"), staff.pk) if "phone" in d else None
        if not staff.email:
            raise ValueError(EMAIL_NEEDED)
    except ValueError as e:
        return Response({"error": str(e)}, status=400)

    new_id = role != "admin" and role != old_role  # moved to the other series -> issue a new ID
    for _ in range(5):
        try:
            with transaction.atomic():
                if new_id:
                    staff.username = _next_member_id(role)
                _apply_role(staff, role)
                staff.save()
                profile, _created = StaffProfile.objects.get_or_create(user=staff)
                if phone is not None:
                    profile.phone = phone
                    profile.save(update_fields=["phone"])
            break
        except IntegrityError:
            if not new_id:
                return Response({"error": "Username already exists"}, status=400)
    else:
        return Response({"error": "Could not generate a User ID right now. Please try again."}, status=409)
    return Response({"staff": _list(request), "username": staff.username, "id_changed": new_id})


@api_view(["POST"])
@permission_classes([IsSuperuser])
def settings_staff_toggle(request, pk):
    staff = _member(pk)
    if staff is None:
        return Response({"error": "Staff not found"}, status=404)
    if staff.pk == request.user.pk:
        return Response({"error": "You cannot block your own account."}, status=400)
    staff.is_active = not staff.is_active
    staff.save(update_fields=["is_active"])
    return Response({"staff": _list(request)})


@api_view(["POST"])
@permission_classes([IsSuperuser])
def settings_staff_password(request, pk):
    staff = _member(pk)
    if staff is None:
        return Response({"error": "Staff not found"}, status=404)
    if staff.pk == request.user.pk:
        return Response({"error": SELF_MSG}, status=400)
    new = request.data.get("new_password") or ""
    if len(new) < MIN_PASSWORD_LEN:
        return Response({"error": f"Password must be at least {MIN_PASSWORD_LEN} characters"}, status=400)
    staff.set_password(new)
    staff.save()
    return Response({"ok": True})