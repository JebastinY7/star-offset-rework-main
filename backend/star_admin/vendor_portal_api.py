"""Vendor Portal API - what the vendor-portal React app (separate website) talks to.

    GET   /api/vendor/me/                  -> {vendor: {...} | null}
    POST  /api/vendor/auth/login/          {username (= the vendor's User ID, e.g. 2026V0001), password} -> {vendor}
    POST  /api/vendor/auth/forgot-user-id/ | forgot-password/ | verify-otp/ | reset-password/   see vendor_recovery_api.py
    POST  /api/vendor/auth/logout/
    GET   /api/vendor/dashboard/           -> {stats, donut, recent, upcoming, performance}
    GET   /api/vendor/jobs/?status=&q=&work_type=&date_from=&date_to=&month=YYYY-MM&sort=&per_page=&page=
    GET   /api/vendor/jobs/<id>/           one job with its items
    PATCH /api/vendor/jobs/<id>/           {status?, vendor_note?, qty_done? (pieces finished this time), progress_date?, remarks?}
    GET   /api/vendor/quotes/?status=open|closed|all   PRICE REQUESTS: work Star Offset asked this vendor to price (open = waiting for the
                                           vendor's price / answer to a counter offer, or priced and waiting for Star Offset) -> {results: [...], counts: {...}}
    POST  /api/vendor/quotes/<id>/         {action: "quote", price, note?}   send (or change) the price for the WHOLE job
                                           {action: "accept_counter", note?}  accept Star Offset's counter offer (the price becomes the quote, Star Offset then assigns)
                                           {action: "decline", note?}        "we cannot do this work"
    POST  /api/vendor/password/change/     {current_password, new_password, confirm_password}

Rules:
  * A vendor only ever sees jobs assigned to it, and never the shop's name, contact details or prices.
  * Price requests are not jobs yet: they are kept out of Assigned Work / Dashboard / History, and their artwork files are only released once
    Star Offset accepts the quote (the request becomes a normal "assigned" job).
  * Price negotiation: Star Offset may answer a quote with a counter offer (status "countered"). The vendor accepts it, sends a new price, or
    declines. Every step is returned as "negotiation" so both sides see how the price moved.
  * Vendors may only move a job forward: assigned -> accepted | rejected, accepted -> in_progress -> ready.
    Completed / cancelled are set by Star Offset.
"""
import datetime
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.contrib.auth import login, logout, update_session_auth_hash
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response

from .api_views import MIN_PASSWORD_LEN
from .artwork import download, file_of, is_stored
from .auth_api import (MAX_ATTEMPTS, MAX_ATTEMPTS_PER_IP, _client_ip, _count_failure, _locked_seconds, _too_many)
from .models import LoginAttempt
from .notification_models import notify
from .vendor_models import QUOTE_OPEN, QUOTE_STATUSES, Vendor, VendorJob, VendorJobEvent, jobs_queryset

INVALID = "Incorrect User ID or password."
INACTIVE = "Your account is inactive. Please contact Star Offset."
NO_PORTAL = "Portal access is disabled for your account. Please contact Star Offset."
_DUMMY_HASH = make_password("not-a-real-password")
PAGE_SIZE = 10
PAGE_SIZES = (10, 20, 50)
REMARK_MAX = 500
PROGRESS_STATUSES = ("accepted", "in_progress")  # a vendor may post a progress update without changing status
NEXT_LABEL = {"accepted": "Accept job", "rejected": "Reject job", "in_progress": "Start / continue production", "ready": "Mark ready for pickup"}
NOTE_MAX = 1000

# what a vendor may do next
VENDOR_TRANSITIONS = {
    "assigned": {"accepted", "rejected"},
    "accepted": {"in_progress"},
    "in_progress": {"ready"},
}
STATUS_LABEL = dict(VendorJob.STATUS_CHOICES)
OPEN_STATUSES = ["assigned", "accepted", "in_progress"]  # still with the vendor; past due_date = overdue
CLOSED_STATUSES = ["completed", "rejected", "cancelled"]  # finished: shown on the History page


def _vendor_of(user):
    if not user or not user.is_authenticated or user.is_staff or user.is_superuser:
        return None
    return Vendor.objects.select_related("user").filter(user=user).first()


class IsVendorUser(BasePermission):
    def has_permission(self, request, view):
        v = _vendor_of(request.user)
        return bool(v and request.user.is_active and v.portal_access)


def vendor_payload(v):
    return {"id": v.id, "name": v.name, "owner_name": v.owner_name, "phone": v.phone, "email": v.email,
            "username": v.user.username, "address": v.address, "specialties": v.specialties}


def _spec_text(spec, limit=3):
    """[{"label": "Size", "value": "A4"}, ...] -> "Size: A4, Paper: 300gsm"."""
    parts = [f"{x.get('label')}: {x.get('value')}" for x in (spec or []) if isinstance(x, dict) and x.get("value")]
    return ", ".join(parts[:limit])


def _history(job):
    rows = [{"date": job.created_at.isoformat(), "status": "assigned", "status_label": "Assigned",
             "qty": sum(l["qty"] for l in job.lines()), "remarks": "Work assigned to vendor", "by": "Star Offset"}]
    for e in job.events.all():
        rows.append({"date": e.progress_date.isoformat() if e.progress_date else e.created_at.isoformat(), "status": e.status, "status_label": STATUS_LABEL.get(e.status, e.status),
                     "qty": e.qty, "remarks": e.remarks, "by": e.by_name})
    return rows


def _next_options(job):
    opts = []
    if job.status in PROGRESS_STATUSES:
        opts.append({"value": job.status, "label": "Progress update (keep " + STATUS_LABEL.get(job.status, job.status) + ")"})
    opts += [{"value": k, "label": NEXT_LABEL.get(k, k)} for k in sorted(VENDOR_TRANSITIONS.get(job.status, set()))]
    return opts


def _job_row(job):
    items = job.lines()
    names = []
    for i in items:
        if i["service_name"] not in names:
            names.append(i["service_name"])
    overdue = bool(job.due_date and job.due_date < timezone.localdate() and job.status in OPEN_STATUSES)
    ready = [e for e in job.events.all() if e.status == "ready"]
    ready_at = None
    if ready:  # the day the vendor marked it ready (their progress date, else the save time)
        ready_at = (ready[-1].progress_date or ready[-1].created_at).isoformat()
    product = _spec_text(items[0]["spec"]) if items else ""
    if product and len(items) > 1:
        product += f" +{len(items) - 1} more"
    return {
        "id": job.id, "job_no": job.job_no, "order_no": job.order_no,
        "items": len(items),
        "qty": sum(i["qty"] for i in items),
        "qty_done": sum(e.qty or 0 for e in job.events.all()),
        "ready_at": ready_at,
        "updated_at": job.updated_at.isoformat(),
        "product": product,
        "items_text": ", ".join(names[:2]) + (f" +{len(names) - 2} more" if len(names) > 2 else ""),
        "status": job.status, "status_label": STATUS_LABEL.get(job.status, job.status),
        "is_overdue": overdue,
        "due_date": job.due_date.isoformat() if job.due_date else None,
        "price": str(job.vendor_price) if job.vendor_price is not None else None,
        "assigned_at": job.created_at.isoformat(),
    }


def _job_detail(job):
    return {
        **_job_row(job),
        "instructions": job.instructions,
        "vendor_note": job.vendor_note,
        "updated_at": job.updated_at.isoformat(),
        "allowed_next": sorted(VENDOR_TRANSITIONS.get(job.status, set())),
        "lines": [{"service_name": i["service_name"], "spec": i["spec"], "qty": i["qty"],
                   "files": [f.get("name") for f in i["files"] if isinstance(f, dict)],
                   "file_links": [{"name": f.get("name"), "size": f.get("size"),
                                   "url": f"/api/vendor/jobs/{job.id}/files/{i['id']}/{n}/" if is_stored(f) else None}
                                  for n, f in enumerate(i["files"]) if isinstance(f, dict)]}
                  for i in job.lines()],
        "order_instructions": job.order_note,
        "history": _history(job),
        "next_options": _next_options(job),
    }


def _mine(request):
    """This vendor's real jobs (a price request is not a job until Star Offset accepts the quote)."""
    return (jobs_queryset(VendorJob.objects.filter(vendor=request.user.vendor_profile).exclude(status__in=QUOTE_STATUSES))
            .prefetch_related("events"))


def _quotes(request):
    """This vendor's price requests (any state)."""
    return jobs_queryset(VendorJob.objects.filter(vendor=request.user.vendor_profile, status__in=QUOTE_STATUSES))


def _manual_job_ids(base, match):
    """Ids of manual-order jobs having a line whose service name passes match() (those names are not a DB column)."""
    return [j.id for j in base.filter(manual_order__isnull=False) if any(match(l["service_name"]) for l in j.lines())]


# ------------------------------------------------------------------ auth
@api_view(["GET"])
@permission_classes([AllowAny])
def vendor_me(request):
    v = _vendor_of(request.user)
    if v and request.user.is_active and v.portal_access:
        return Response({"vendor": vendor_payload(v)})
    return Response({"vendor": None})


@api_view(["POST"])
@permission_classes([AllowAny])
def vendor_login(request):
    username = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""
    if not username or not password:
        return Response({"error": "Please enter both fields"}, status=400)

    user_key = f"vendor:u:{username.lower()}"[:250]
    ip_key = f"vendor:ip:{_client_ip(request)}"[:250]
    wait = max(_locked_seconds(user_key, MAX_ATTEMPTS), _locked_seconds(ip_key, MAX_ATTEMPTS_PER_IP))
    if wait:
        return _too_many(wait)

    vendor = (Vendor.objects.select_related("user")
              .filter(user__username__iexact=username, user__is_staff=False, user__is_superuser=False).first())
    user = vendor.user if vendor else None
    ok = check_password(password, user.password if user else _DUMMY_HASH) and user is not None
    if not ok:
        _count_failure(user_key)
        _count_failure(ip_key)
        wait = _locked_seconds(user_key, MAX_ATTEMPTS)
        return _too_many(wait) if wait else Response({"error": INVALID}, status=400)
    if not user.is_active:
        return Response({"error": INACTIVE}, status=403)
    if not vendor.portal_access:
        return Response({"error": NO_PORTAL}, status=403)

    LoginAttempt.objects.filter(email=user_key).delete()
    login(request, user)
    return Response({"vendor": vendor_payload(vendor)})


@api_view(["POST"])
@permission_classes([AllowAny])
def vendor_logout(request):
    if _vendor_of(request.user):
        logout(request)
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsVendorUser])
def vendor_change_password(request):
    user, d = request.user, request.data
    current, new, confirm = d.get("current_password") or "", d.get("new_password") or "", d.get("confirm_password") or ""
    key = f"vendor:pw:{user.pk}"
    wait = _locked_seconds(key, MAX_ATTEMPTS)
    if wait:
        return _too_many(wait)
    if not current:
        return Response({"error": "Enter your current password."}, status=400)
    if not check_password(current, user.password):
        _count_failure(key)
        wait = _locked_seconds(key, MAX_ATTEMPTS)
        return _too_many(wait) if wait else Response({"error": "Your current password is incorrect."}, status=400)
    if len(new) < MIN_PASSWORD_LEN:
        return Response({"error": f"New password must be at least {MIN_PASSWORD_LEN} characters."}, status=400)
    if len(new) > 128:
        return Response({"error": "New password can be at most 128 characters."}, status=400)
    if new == current:
        return Response({"error": "Your new password must be different from your current password."}, status=400)
    if new != confirm:
        return Response({"error": "The new passwords do not match."}, status=400)
    user.set_password(new)
    user.save(update_fields=["password"])
    update_session_auth_hash(request, user)
    LoginAttempt.objects.filter(email=key).delete()
    return Response({"ok": True})


# ------------------------------------------------------------------ jobs
@api_view(["GET"])
@permission_classes([IsVendorUser])
def vendor_dashboard(request):
    mine = _mine(request)
    today = timezone.localdate()
    late = Q(due_date__lt=today)
    c = mine.aggregate(
        new=Count("id", filter=Q(status="assigned")),
        active=Count("id", filter=Q(status__in=["accepted", "in_progress"])),
        ready=Count("id", filter=Q(status="ready")),
        completed=Count("id", filter=Q(status="completed")),
        closed=Count("id", filter=Q(status__in=["rejected", "cancelled"])),
        total=Count("id"),
        overdue=Count("id", filter=Q(status__in=OPEN_STATUSES) & late),
        overdue_new=Count("id", filter=Q(status="assigned") & late),
        overdue_active=Count("id", filter=Q(status__in=["accepted", "in_progress"]) & late),
    )
    # donut: every job sits in exactly one slice, so overdue jobs are taken out of new / in progress
    donut = {
        "new": c["new"] - c["overdue_new"],
        "active": c["active"] - c["overdue_active"],
        "ready": c["ready"],
        "completed": c["completed"],
        "overdue": c["overdue"],
    }
    stats = {k: c[k] for k in ("new", "active", "ready", "completed", "total", "overdue")}
    stats["work_total"] = sum(donut.values())
    stats["quotes"] = _quotes(request).filter(status__in=["enquiry", "countered"]).count()  # price requests waiting for this vendor's price / answer

    # this month vs last month (Star Offset closes a job as completed, so updated_at is the closing time)
    this_start = today.replace(day=1)
    last_start = (this_start - timedelta(days=1)).replace(day=1)
    done = mine.filter(status="completed")
    this_month = list(done.filter(updated_at__date__gte=this_start).values_list("updated_at", "due_date"))
    last_count = done.filter(updated_at__date__gte=last_start, updated_at__date__lt=this_start).count()
    on_time = sum(1 for done_at, due in this_month
                  if due is None or timezone.localtime(done_at).date() <= due)
    finished = c["total"] - c["closed"]
    performance = {
        "completed_month": len(this_month),
        "change_pct": round((len(this_month) - last_count) * 100 / last_count) if last_count else None,
        "on_time": on_time,
        "on_time_pct": round(on_time * 100 / len(this_month)) if this_month else None,
        "pending_pickup": c["ready"],
        "completion_rate": round(c["completed"] * 100 / finished) if finished else None,
    }

    upcoming = mine.filter(status__in=OPEN_STATUSES, due_date__gte=today).order_by("due_date", "id")[:4]
    return Response({
        "stats": stats, "donut": donut, "performance": performance,
        "recent": [_job_row(j) for j in mine[:5]],
        "upcoming": [_job_row(j) for j in upcoming],
    })


@api_view(["GET"])
@permission_classes([IsVendorUser])
def vendor_jobs(request):
    base = _mine(request)
    qs = base
    p = request.query_params
    status = p.get("status", "")
    if status == "open":
        qs = qs.filter(status__in=OPEN_STATUSES)
    elif status == "active":
        qs = qs.filter(status__in=["accepted", "in_progress"])
    elif status == "overdue":
        qs = qs.filter(status__in=OPEN_STATUSES, due_date__lt=timezone.localdate())
    elif status == "closed":  # History page: finished work (completed, rejected, cancelled)
        qs = qs.filter(status__in=CLOSED_STATUSES)
    elif status in STATUS_LABEL:
        qs = qs.filter(status=status)
    work_type = (p.get("work_type") or "").strip()[:200]
    if work_type:
        qs = qs.filter(Q(items__service_name__iexact=work_type)
                       | Q(id__in=_manual_job_ids(base, lambda n: n.lower() == work_type.lower())))
    for key, lookup in (("date_from", "created_at__date__gte"), ("date_to", "created_at__date__lte")):
        raw = (p.get(key) or "").strip()
        if raw:
            try:
                qs = qs.filter(**{lookup: datetime.date.fromisoformat(raw)})
            except ValueError:
                pass
    month = (p.get("month") or "").strip()  # YYYY-MM, on the day the job was last updated (= completed / ready day)
    if month:
        try:
            y, m = month.split("-")
            qs = qs.filter(updated_at__year=int(y), updated_at__month=int(m))
        except ValueError:
            pass
    q = (p.get("q") or "").strip()[:100]
    if q:
        cond = Q(items__service_name__icontains=q) | Q(id__in=_manual_job_ids(base, lambda n: q.lower() in n.lower()))
        digits = q.upper().replace("ORD-", "").replace("JOB-", "").lstrip("W")
        if digits.isdigit():
            cond |= Q(id=int(digits)) | Q(order_id=int(digits)) | Q(manual_order_id=int(digits))
        qs = qs.filter(cond)
    sort = p.get("sort", "newest")
    qs = qs.distinct().order_by(*{"oldest": ("created_at", "id"), "due": ("due_date", "id"),
                                  "due_desc": ("-due_date", "-id"), "recent": ("-updated_at", "-id")}.get(sort, ("-created_at", "-id")))
    total = qs.count()
    try:
        size = int(p.get("per_page", PAGE_SIZE))
    except (TypeError, ValueError):
        size = PAGE_SIZE
    size = size if size in PAGE_SIZES else PAGE_SIZE
    try:
        page = max(1, int(p.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    pages = max(1, (total + size - 1) // size)
    page = min(page, pages)
    rows = qs[(page - 1) * size: page * size]
    work_types = set(base.values_list("items__service_name", flat=True)) - {None}
    for j in base.filter(manual_order__isnull=False):
        work_types.update(l["service_name"] for l in j.lines())
    work_types = sorted(work_types)
    out = {"results": [_job_row(j) for j in rows], "total_count": total, "page": page, "pages": pages,
           "per_page": size, "work_types": work_types}
    if p.get("summary"):  # History cards: totals over ALL of this vendor's finished work (not just the filtered list)
        done = list(base.filter(status="completed"))
        out["summary"] = {
            "completed": len(done),
            "pieces": sum(l["qty"] for j in done for l in j.lines()),
            "earned": float(sum((j.vendor_price or 0) for j in done)),
            "rejected": base.filter(status="rejected").count(),
            "cancelled": base.filter(status="cancelled").count(),
        }
    return Response(out)


@api_view(["GET", "PATCH"])
@permission_classes([IsVendorUser])
def vendor_job_detail(request, pk):
    job = _mine(request).filter(pk=pk).first()
    if job is None:
        return Response({"error": "Job not found."}, status=404)

    if request.method == "PATCH":
        d = request.data
        fields = []
        remarks = str(d.get("remarks") or "").strip()
        if len(remarks) > REMARK_MAX:
            return Response({"error": f"Remarks can be at most {REMARK_MAX} characters."}, status=400)
        qty_done = d.get("qty_done")
        total_qty = sum(l["qty"] for l in job.lines())
        done_before = sum(e.qty or 0 for e in job.events.all())
        if qty_done in ("", None):
            qty_done = None
        else:
            try:
                qty_done = int(qty_done)
            except (TypeError, ValueError):
                return Response({"error": "Enter the quantity completed as a whole number."}, status=400)
            if qty_done < 0:
                return Response({"error": "Quantity completed cannot be negative."}, status=400)
            if done_before + qty_done > total_qty:
                return Response({"error": f"Only {total_qty - done_before} pcs are left to complete ({done_before} of {total_qty} pcs already done)."}, status=400)
        progress_date = None
        raw_date = str(d.get("progress_date") or "").strip()
        if raw_date:
            try:
                progress_date = datetime.date.fromisoformat(raw_date)
            except ValueError:
                return Response({"error": "Enter a valid progress date."}, status=400)
            if progress_date > timezone.localdate():
                return Response({"error": "Progress date cannot be in the future."}, status=400)
            if progress_date < timezone.localtime(job.created_at).date():
                return Response({"error": "Progress date cannot be before the job was assigned."}, status=400)

        if "vendor_note" in d:
            note = str(d.get("vendor_note") or "").strip()
            if len(note) > NOTE_MAX:
                return Response({"error": f"Note can be at most {NOTE_MAX} characters."}, status=400)
            job.vendor_note = note
            fields.append("vendor_note")

        nxt = d.get("status")
        log = False
        if nxt in ("accepted", "rejected") and nxt != job.status:
            qty_done = None  # accepting / rejecting a job has no quantity
        if nxt:
            if nxt == job.status and job.status in PROGRESS_STATUSES:
                if not qty_done and not remarks:
                    return Response({"error": "Enter the quantity completed this time, or add a remark."}, status=400)
                log = True  # progress update, status stays
            elif nxt not in VENDOR_TRANSITIONS.get(job.status, set()):
                return Response({"error": f"A job that is {STATUS_LABEL.get(job.status, job.status)} cannot be moved to {STATUS_LABEL.get(nxt, nxt)}."}, status=400)
            else:
                if nxt == "rejected":
                    if remarks:
                        job.vendor_note = remarks
                        if "vendor_note" not in fields:
                            fields.append("vendor_note")
                    if not (job.vendor_note or "").strip():
                        return Response({"error": "Please add a note saying why you are rejecting this job."}, status=400)
                job.status = nxt
                fields.append("status")
                log = True
        if fields:
            job.save(update_fields=fields + ["updated_at"])
        elif log:
            job.save(update_fields=["updated_at"])
        if "status" in fields and job.status == "ready":  # tell the staff bell: ready for pickup
            notify("vendor_ready", "Ready for pickup", f"{job.vendor.name} marked {job.job_no} ({job.order_no}) ready for pickup", "/vendor-work?tab=jobs")
        if log:
            v = request.user.vendor_profile
            VendorJobEvent.objects.create(job=job, status=job.status, qty=qty_done, remarks=remarks, progress_date=progress_date,
                                          by_name=(v.owner_name or v.name)[:100])
        job = _mine(request).get(pk=pk)  # fresh copy with the new history line
    return Response({"job": _job_detail(job)})


@api_view(["GET"])
@permission_classes([IsVendorUser])
def vendor_job_file(request, pk, item_id, idx):
    """Download one artwork file - only for a job that belongs to this vendor and is not cancelled."""
    job = _mine(request).filter(pk=pk).exclude(status="cancelled").first()
    item = job.items.filter(pk=item_id).first() if job else None
    f = file_of(item, idx) if item else None
    if f is None:
        return Response({"error": "File not found."}, status=404)
    return download(f)


# ------------------------------------------------------------------ price requests (quotes)
MAX_PRICE = Decimal("99999999.99")
QUOTE_CLOSED = ["declined", "not_selected"]


def _quote_row(job):
    lines = job.lines()
    qty = sum(int(l["qty"] or 0) for l in lines)
    price = job.quoted_price
    return {
        "id": job.id, "job_no": job.job_no, "order_no": job.order_no,
        "status": job.status, "status_label": STATUS_LABEL.get(job.status, job.status),
        "requested_at": job.created_at.isoformat(),
        "needed_by": job.due_date.isoformat() if job.due_date else None,
        "message": job.instructions,          # Star Offset -> vendor
        "order_note": job.order_note,
        "qty": qty,
        "lines": [{"service_name": l["service_name"], "spec": l["spec"], "qty": l["qty"]} for l in lines],
        "quoted_price": str(price) if price is not None else None,
        "per_piece": round(float(price) / qty, 4) if price is not None and qty else None,
        "quoted_at": job.quoted_at.isoformat() if job.quoted_at else None,
        "vendor_note": job.vendor_note,       # vendor -> Star Offset (sent with the price / the reason for declining)
        "counter_price": str(job.counter_price) if job.counter_price is not None else None,   # Star Offset's counter offer
        "counter_per_piece": round(float(job.counter_price) / qty, 4) if job.counter_price is not None and qty else None,
        "counter_note": job.counter_note,
        "countered_at": job.countered_at.isoformat() if job.countered_at else None,
        "negotiation": job.negotiation or [],
        "open": job.status in QUOTE_OPEN,
    }


@api_view(["GET"])
@permission_classes([IsVendorUser])
def vendor_quotes(request):
    base = _quotes(request)
    counts = {"waiting": base.filter(status__in=["enquiry", "countered"]).count(), "quoted": base.filter(status="quoted").count(),
              "closed": base.filter(status__in=QUOTE_CLOSED).count()}
    counts["open"] = counts["waiting"] + counts["quoted"]
    st = request.query_params.get("status", "open")
    if st == "closed":
        qs = base.filter(status__in=QUOTE_CLOSED)
    elif st == "all":
        qs = base
    else:
        qs = base.filter(status__in=QUOTE_OPEN)
    return Response({"results": [_quote_row(j) for j in qs.order_by("-created_at", "-id")[:200]], "counts": counts})


@api_view(["POST"])
@permission_classes([IsVendorUser])
def vendor_quote_reply(request, pk):
    """The vendor answers a price request: send / change the price, or say it cannot do the work."""
    job = _quotes(request).filter(pk=pk).first()
    if job is None:
        return Response({"error": "Price request not found."}, status=404)
    if job.status not in QUOTE_OPEN:
        return Response({"error": "This price request is closed. Refresh the page."}, status=400)
    d = request.data
    action = d.get("action")
    note = str(d.get("note") or "").strip()
    if len(note) > NOTE_MAX:
        return Response({"error": f"Note can be at most {NOTE_MAX} characters."}, status=400)
    vendor = request.user.vendor_profile
    link = f"/vendor-work?{'src=manual&' if job.is_manual else ''}order={job.order_ref_id}"

    def _price(raw):
        price = Decimal(str(raw)).quantize(Decimal("0.01"))
        if not price.is_finite() or price <= 0 or price > MAX_PRICE:
            raise InvalidOperation
        return price

    if action == "quote":
        try:
            price = _price(d.get("price"))
        except (InvalidOperation, ValueError, TypeError):
            return Response({"error": "Enter your price for this work (more than 0)."}, status=400)
        revised = job.status in ("quoted", "countered")
        job.quoted_price, job.quoted_at, job.status, job.vendor_note = price, timezone.now(), "quoted", note
        job.log_price("vendor", "quote", price, note)
        job.save(update_fields=["quoted_price", "quoted_at", "status", "vendor_note", "negotiation", "updated_at"])
        notify("vendor_quote", "Price revised" if revised else "Price quote received",
               f"{vendor.name} quoted Rs. {price:,.2f} for {job.job_no} ({job.order_no})", link)
    elif action == "accept_counter":
        if job.status != "countered" or job.counter_price is None:
            return Response({"error": "There is no counter offer to accept. Refresh the page."}, status=400)
        price = job.counter_price
        job.quoted_price, job.quoted_at, job.status, job.vendor_note = price, timezone.now(), "quoted", note
        job.log_price("vendor", "accept", price, note)
        job.save(update_fields=["quoted_price", "quoted_at", "status", "vendor_note", "negotiation", "updated_at"])
        notify("vendor_quote", "Counter offer accepted",
               f"{vendor.name} accepted your price of Rs. {price:,.2f} for {job.job_no} ({job.order_no}) - you can assign the work now", link)
    elif action == "decline":
        job.status, job.vendor_note = "declined", note
        job.save(update_fields=["status", "vendor_note", "updated_at"])
        notify("vendor_quote", "Vendor cannot do the work", f"{vendor.name} declined to quote for {job.job_no} ({job.order_no})", link)
    else:
        return Response({"error": "Nothing to do."}, status=400)
    return Response({"quote": _quote_row(_quotes(request).get(pk=pk))})