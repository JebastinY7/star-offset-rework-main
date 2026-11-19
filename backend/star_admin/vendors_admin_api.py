"""Admin side of vendors: manage vendors, and split a shop order between them.

Vendors (superuser only)
    GET   /api/settings/vendors/?q=&status=       list (+ job counts)
    GET   /api/settings/vendor-works/             every work Star Offset does (offset + digital price-list categories): [{key, name, kinds}]
                                                  A name that exists in both lists is ONE work with kinds ["normal", "digital"].
    POST  /api/settings/vendors/                  {name, owner_name, phone, email, password, address?, specialties?, works?:[work names], notes?}
                                                  The vendor's User ID (<year>V0001, <year>V0002 ... - restarts every year) is generated here, never typed.
                                                  It is stored as User.username and returned as "username".
    PATCH /api/settings/vendors/<id>/             edit; also is_active / portal_access / password
Jobs (staff or admin)
    GET   /api/admin/shop-orders/<id>/jobs/       jobs of one order (work AND price requests) + which items are not yet assigned
                                                  + "rates": what each vendor was paid for the same work on earlier jobs (reference when judging a quote;
                                                    per_piece, last_price, last_qty, last_date, last_job_no, avg_per_piece, jobs)
    POST  /api/admin/shop-orders/<id>/jobs/       TWO ways to give work out, chosen by "mode":
                                                  mode "quote" (ask for a price first - the normal way):
                                                      {mode:"quote", vendor_ids:[...], item_ids:[...], due_date?, instructions?, send_email?}
                                                      -> one price request (status "enquiry") per vendor; the vendors answer in the Vendor Portal
                                                         (Price Requests). Items stay free until a quote is accepted.
                                                      -> jobs payload + "quote_mail": {sent, failed:[{vendor, error}]}
                                                  mode "assign" (default; price already agreed):
                                                      {vendor_id, item_ids:[...], vendor_price?, due_date?, instructions?, send_email? (default true)}
                                                      -> jobs payload + "email": {sent, to, attached, not_attached, error}
    GET   /api/admin/manual-orders/?q=&status=&assign=&page=   manual orders (Admin > Orders) for the Assign work page
    GET   /api/admin/manual-orders/<id>/          one manual order
    GET/POST /api/admin/manual-orders/<id>/jobs/  same as the shop-order jobs endpoint, for a manual order
    POST  /api/admin/vendor-jobs/<id>/send/       e-mail the job + its artwork files to the vendor again
    GET   /api/admin/order-files/<item_id>/<idx>/ download one artwork file (staff / admin)
    PATCH /api/admin/vendor-jobs/<id>/            {vendor_price?, due_date?, instructions?, status? (completed|cancelled)}
                                                  status "assigned"      ACCEPT a received quote: the job is given to that vendor at the quoted price,
                                                                         its other open price requests for the same items are closed (not_selected),
                                                                         the job + artwork is e-mailed ({send_email?}) -> {job, email}
                                                  status "countered"     NEGOTIATE: answer a received quote with Star Offset's own price
                                                                         {status:"countered", counter_price, counter_note?, send_email?}. The vendor sees it in the
                                                                         Vendor Portal and accepts it (the job becomes "quoted" at that price), sends a new price,
                                                                         or declines. Can be repeated while the request is open. -> {job, email}
                                                  status "not_selected"  the quote is not suitable (or the request is withdrawn)
    GET   /api/admin/vendor-jobs/?status=&vendor=&page=   all jobs
"""
import logging
import mimetypes
import os
import re
from datetime import date
from decimal import Decimal, InvalidOperation

from django.contrib.auth.models import User
from django.conf import settings as django_settings
from django.core.exceptions import ValidationError
from django.core.mail import EmailMessage
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Count, Prefetch, Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .api_views import MIN_PASSWORD_LEN, IsSuperuser
from .artwork import download, file_of, is_stored, job_files, public_files, read_bytes
from pricing.models import Category, DigitalCategory
from .models import Order, ShopOrder, ShopOrderItem
from .shop_orders_admin_api import IsStaffOrAdmin
from .vendor_models import (QUOTE_OPEN, QUOTE_STATUSES, TAKEN_STATUSES, Vendor, VendorJob, annotate_assign, assign_prefetch, assign_row,
                            filter_assign, jobs_queryset, manual_item_view, manual_items_queryset, manual_order_no, rate_key)
from .shop_pricing_api import pretty
from .vendor_portal_api import STATUS_LABEL

logger = logging.getLogger(__name__)
MAX_MAIL_BYTES = 20 * 1024 * 1024  # most mail servers reject messages above ~25 MB
ACTIVE_JOB = ["assigned", "accepted", "in_progress", "ready"]


VENDOR_ID_RX = re.compile(r"^(\d{4})V(\d{4,})$")


def _next_vendor_id():
    """Next free vendor User ID: <year>V0001, <year>V0002 ... (the counter restarts every year)."""
    prefix = f"{timezone.localdate().year}V"
    highest = 0
    for name in User.objects.filter(username__startswith=prefix).values_list("username", flat=True):
        m = VENDOR_ID_RX.match(name)
        if m and m.group(1) + "V" == prefix:
            highest = max(highest, int(m.group(2)))
    return f"{prefix}{highest + 1:04d}"


def _known_works():
    """Every work in the price list -> {rate_key: {key, name, kinds}}.
    Offset (Category) and digital (DigitalCategory) names are merged by rate_key, so a work sold both ways is listed once."""
    out = {}
    for kind, model in (("normal", Category), ("digital", DigitalCategory)):
        for name in model.objects.values_list("name", flat=True):
            key = rate_key(name)
            if not key:
                continue
            w = out.setdefault(key, {"key": key, "name": pretty(name), "kinds": []})
            if kind not in w["kinds"]:
                w["kinds"].append(kind)
    return out


def _clean_works(raw, vendor=None):
    """List of work names from the form -> canonical names (as shown in the price list), no duplicates.
    A work that was removed from the price list can stay on a vendor that already had it, but cannot be newly added."""
    if not isinstance(raw, list):
        raise ValueError("Works must be a list.")
    known = _known_works()
    had = {rate_key(w): w for w in (vendor.works if vendor else [])}
    out, seen = [], set()
    for x in raw:
        k = rate_key(x)
        if not k or k in seen:
            continue
        seen.add(k)
        if k in known:
            out.append(known[k]["name"])
        elif k in had:
            out.append(had[k])
        else:
            raise ValueError(f"\"{str(x)[:60]}\" is not a work in the price list.")
    return sorted(out, key=str.lower)


def _vrow(v):
    return {"id": v.id, "name": v.name, "owner_name": v.owner_name, "phone": v.phone, "email": v.email,
            "username": v.user.username, "address": v.address, "specialties": v.specialties, "works": v.works or [], "notes": v.notes,
            "portal_access": v.portal_access, "is_active": v.user.is_active,
            "open_jobs": getattr(v, "open_jobs", 0), "created_at": v.created_at}


def _jrow(j):
    lines = j.lines()
    return {"id": j.id, "job_no": j.job_no, "source": j.source, "order_id": j.order_ref_id, "order_no": j.order_no,
            "party_name": j.party_name,
            "vendor_id": j.vendor_id, "vendor_name": j.vendor.name,
            "item_ids": [l["id"] for l in lines], "items": [f"{l['service_name']} x {l['qty']}" for l in lines],
            "status": j.status, "status_label": STATUS_LABEL.get(j.status, j.status),
            "qty": sum(int(l["qty"] or 0) for l in lines),
            "vendor_price": str(j.vendor_price) if j.vendor_price is not None else None,
            "quoted_price": str(j.quoted_price) if j.quoted_price is not None else None,
            "quoted_at": j.quoted_at.isoformat() if j.quoted_at else None,
            "counter_price": str(j.counter_price) if j.counter_price is not None else None,
            "counter_note": j.counter_note,
            "countered_at": j.countered_at.isoformat() if j.countered_at else None,
            "negotiation": j.negotiation or [],
            "is_quote": j.status in QUOTE_STATUSES,
            "created_at": j.created_at.isoformat(),
            "due_date": j.due_date.isoformat() if j.due_date else None,
            "instructions": j.instructions, "vendor_note": j.vendor_note, "updated_at": j.updated_at.isoformat(),
            "files": job_files(j)}


def _money(raw):
    if raw in (None, ""):
        return None
    try:
        d = Decimal(str(raw))
        if not d.is_finite() or d < 0:
            raise InvalidOperation
    except (InvalidOperation, ValueError):
        raise ValueError("Enter a valid vendor price.")
    return d


def _date(raw):
    """'2026-10-21' / '' / None -> date or None (so the model never holds a plain string)."""
    if raw in (None, ""):
        return None
    try:
        return date.fromisoformat(str(raw)[:10])
    except ValueError:
        raise ValueError("Enter a valid due date.")


def _clean_vendor(d, vendor=None):
    out = {}
    name = " ".join(str(d.get("name", vendor.name if vendor else "")).split())
    owner = " ".join(str(d.get("owner_name", vendor.owner_name if vendor else "")).split())
    if not name or not owner:
        raise ValueError("Vendor name and contact person are required.")
    out["name"], out["owner_name"] = name[:150], owner[:100]
    digits = "".join(c for c in str(d.get("phone", vendor.phone if vendor else "")) if c.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) != 10:
        raise ValueError("Mobile number must be 10 digits.")
    taken = Vendor.objects.filter(phone=digits)
    if vendor:
        taken = taken.exclude(pk=vendor.pk)
    if taken.exists():
        raise ValueError("A vendor with this mobile number already exists.")
    out["phone"] = digits
    email = str(d.get("email", vendor.email if vendor else "")).strip().lower()
    try:
        validate_email(email)
    except ValidationError:
        raise ValueError("Enter a valid email address.")
    # a vendor may share an email with a shop account; only admin / staff logins and other vendors must be unique
    users = User.objects.filter(email__iexact=email).filter(Q(is_staff=True) | Q(is_superuser=True))
    vs = Vendor.objects.filter(email__iexact=email)
    if vendor:
        users, vs = users.exclude(pk=vendor.user_id), vs.exclude(pk=vendor.pk)
    if users.exists() or vs.exists():
        raise ValueError("Email already used by an admin, staff or another vendor.")
    out["email"] = email
    out["address"] = str(d.get("address", vendor.address if vendor else "")).strip()[:500]
    out["specialties"] = " ".join(str(d.get("specialties", vendor.specialties if vendor else "")).split())[:250]
    out["notes"] = str(d.get("notes", vendor.notes if vendor else "")).strip()[:1000]
    out["works"] = _clean_works(d["works"], vendor) if "works" in d else (list(vendor.works or []) if vendor else [])
    return out


def _email_job(job):
    """E-mail one job (details + the artwork files of its items) to the vendor.
    Never raises: the job already exists, so a mail problem is only reported back.
    -> {"sent": bool, "to": str, "attached": int, "not_attached": [file names], "error": str|None}"""
    vendor = job.vendor
    result = {"sent": False, "to": vendor.email, "attached": 0, "not_attached": [], "error": None}
    try:
        whole = job.manual_order if job.is_manual else job.order
        number = {i.id: n for n, i in enumerate(whole.items.order_by("id"), start=1)}
        blocks, attach, total, skipped_big, skipped_missing = [], [], 0, [], []
        for it in sorted(job.lines(), key=lambda l: l["id"]):
            names = [f.get("name") for f in it["files"] if isinstance(f, dict)]
            spec = ", ".join(f"{s['label']}: {s['value']}" for s in it["spec"] if isinstance(s, dict))
            blocks.append("\n".join([
                f"Item {number.get(it['id'], '?')}: {it['service_name']}",
                f"Quantity: {int(it['qty'] or 0):,}",
                f"Specifications: {spec or 'Not specified'}",
                "Artwork files: " + (", ".join(names) if names else "None"),
            ]))
            for idx, f in enumerate(it["files"]):
                if not isinstance(f, dict):
                    continue
                data = read_bytes(f) if is_stored(f) else None
                if data is None:
                    skipped_missing.append(f.get("name"))
                elif total + len(data) > MAX_MAIL_BYTES:
                    skipped_big.append(f.get("name"))
                else:
                    total += len(data)
                    attach.append((f"Item{number.get(it['id'], 0)}_{f.get('name')}", data, mimetypes.guess_type(f.get("name") or "")[0] or "application/octet-stream"))

        lines = [f"NEW WORK {job.job_no}  (order {job.order_no})", "",
                 f"Hello {vendor.owner_name},", "Star Offset Printing has given you the work below.", ""]
        lines += [part for b in blocks for part in (b, "")]
        lines.append(f"Due date: {job.due_date.strftime('%d %b %Y') if job.due_date else 'Not specified'}")
        if job.vendor_price is not None:
            lines.append(f"Agreed price: Rs. {job.vendor_price:,.2f}")
        lines.append(f"Instructions: {job.instructions or 'None'}")
        lines.append(f"Artwork files attached: {len(attach)}")
        if skipped_big:
            lines.append("Too large to attach (download them in the Vendor Portal): " + ", ".join(skipped_big))
        if skipped_missing:
            lines.append("Will be sent to you separately: " + ", ".join(skipped_missing))
        portal = os.getenv("VENDOR_PORTAL_URL", "").strip()
        lines += ["", "Please sign in to the Vendor Portal to accept this job and post progress updates." + (f"\n{portal}" if portal else "")]

        msg = EmailMessage(f"New work {job.job_no} - {job.order_no}", "\n".join(lines),
                           getattr(django_settings, "DEFAULT_FROM_EMAIL", None), [vendor.email],
                           reply_to=[os.getenv("ORDER_EMAIL")] if os.getenv("ORDER_EMAIL") else None)
        for name, data, ctype in attach:
            msg.attach(name, data, ctype)
        msg.send(fail_silently=False)
        result.update(sent=True, attached=len(attach), not_attached=skipped_big + skipped_missing)
    except Exception:  # noqa: BLE001
        logger.exception("Could not e-mail job %s to the vendor", job.job_no)
        result["error"] = "The e-mail could not be sent. Check the server's e-mail settings and try Resend."
    return result


def _email_quote_request(job):
    """E-mail a PRICE REQUEST to the vendor: what the work is, and a link to answer in the Vendor Portal.
    No artwork is attached - files go out only when the quote is accepted. Never raises.
    -> {"sent": bool, "to": str, "error": str|None}"""
    vendor = job.vendor
    result = {"sent": False, "to": vendor.email, "error": None}
    try:
        blocks = []
        for n, it in enumerate(sorted(job.lines(), key=lambda l: l["id"]), start=1):
            spec = ", ".join(f"{s['label']}: {s['value']}" for s in it["spec"] if isinstance(s, dict))
            blocks.append("\n".join([f"Item {n}: {it['service_name']}", f"Quantity: {int(it['qty'] or 0):,}",
                                     f"Specifications: {spec or 'Not specified'}"]))
        lines = [f"PRICE REQUEST {job.job_no}  (order {job.order_no})", "",
                 f"Hello {vendor.owner_name},", "Star Offset Printing would like your price for the work below.", ""]
        lines += [part for b in blocks for part in (b, "")]
        lines.append(f"Needed by: {job.due_date.strftime('%d %b %Y') if job.due_date else 'Not specified'}")
        lines.append(f"Message: {job.instructions or 'None'}")
        portal = os.getenv("VENDOR_PORTAL_URL", "").strip()
        lines += ["", "Please sign in to the Vendor Portal > Price Requests and send your total price for this work."
                  + (f"\n{portal}" if portal else ""),
                  "If we choose your price, the work and artwork files will be sent to you."]
        msg = EmailMessage(f"Price request {job.job_no} - {job.order_no}", "\n".join(lines),
                           getattr(django_settings, "DEFAULT_FROM_EMAIL", None), [vendor.email],
                           reply_to=[os.getenv("ORDER_EMAIL")] if os.getenv("ORDER_EMAIL") else None)
        msg.send(fail_silently=False)
        result["sent"] = True
    except Exception:  # noqa: BLE001
        logger.exception("Could not e-mail price request %s to the vendor", job.job_no)
        result["error"] = "The e-mail could not be sent. Check the server's e-mail settings and try Resend."
    return result


def _email_counter_offer(job):
    """E-mail the vendor that Star Offset answered its quote with a counter offer. Never raises.
    -> {"sent": bool, "to": str, "error": str|None}"""
    vendor = job.vendor
    result = {"sent": False, "to": vendor.email, "error": None}
    try:
        lines = [f"COUNTER OFFER {job.job_no}  (order {job.order_no})", "",
                 f"Hello {vendor.owner_name},",
                 f"Thank you for your price of Rs. {job.quoted_price:,.2f}." if job.quoted_price is not None else "Thank you for your reply.",
                 f"Star Offset Printing would like to offer Rs. {job.counter_price:,.2f} for the whole job.", "",
                 f"Message: {job.counter_note or 'None'}"]
        portal = os.getenv("VENDOR_PORTAL_URL", "").strip()
        lines += ["", "Please sign in to the Vendor Portal > Price Requests to accept this price, send a new price, or say you cannot do the work."
                  + (f"\n{portal}" if portal else "")]
        msg = EmailMessage(f"Counter offer {job.job_no} - {job.order_no}", "\n".join(lines),
                           getattr(django_settings, "DEFAULT_FROM_EMAIL", None), [vendor.email],
                           reply_to=[os.getenv("ORDER_EMAIL")] if os.getenv("ORDER_EMAIL") else None)
        msg.send(fail_silently=False)
        result["sent"] = True
    except Exception:  # noqa: BLE001
        logger.exception("Could not e-mail counter offer %s to the vendor", job.job_no)
        result["error"] = "The e-mail could not be sent. The vendor can still see the offer in the Vendor Portal."
    return result


# ------------------------------------------------------------------ vendors
@api_view(["GET"])
@permission_classes([IsSuperuser])
def settings_vendor_works(request):
    return Response({"results": sorted(_known_works().values(), key=lambda w: w["name"].lower())})


@api_view(["GET", "POST"])
@permission_classes([IsSuperuser])
def settings_vendors(request):
    if request.method == "POST":
        d = request.data
        password = d.get("password") or ""
        try:
            data = _clean_vendor(d)
            if len(password) < MIN_PASSWORD_LEN:
                raise ValueError(f"Password must be at least {MIN_PASSWORD_LEN} characters.")
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        # The User ID is generated here.  Two vendors saved at the same moment could pick the same number; the
        # unique username makes the loser fail, so it simply tries again with the next number.
        for _attempt in range(5):
            try:
                with transaction.atomic():
                    user = User.objects.create_user(username=_next_vendor_id(), email=data["email"], password=password)
                    v = Vendor.objects.create(user=user, portal_access=True, **data)
                break
            except IntegrityError:
                continue
        else:
            return Response({"error": "Could not generate a User ID right now. Please try again."}, status=409)
        return Response({"vendor": _vrow(v)}, status=201)

    qs = Vendor.objects.select_related("user").annotate(open_jobs=Count("jobs", filter=Q(jobs__status__in=ACTIVE_JOB)))
    q = (request.query_params.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(owner_name__icontains=q) | Q(phone__icontains=q) | Q(user__username__icontains=q))
    st = request.query_params.get("status")
    if st in ("active", "inactive"):
        qs = qs.filter(user__is_active=(st == "active"))
    return Response({"results": [_vrow(v) for v in qs]})


@api_view(["PATCH", "DELETE"])
@permission_classes([IsSuperuser])
def settings_vendor_detail(request, pk):
    v = Vendor.objects.select_related("user").filter(pk=pk).first()
    if v is None:
        return Response({"error": "Vendor not found."}, status=404)
    if request.method == "DELETE":
        if v.jobs.exists():
            return Response({"error": "This vendor has jobs. Deactivate the account instead of deleting it."}, status=400)
        v.user.delete()
        return Response({"ok": True})
    d = request.data
    try:
        data = _clean_vendor(d, v)
        pw = d.get("password")
        if pw and len(pw) < MIN_PASSWORD_LEN:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LEN} characters.")
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    for k, val in data.items():
        setattr(v, k, val)
    if "portal_access" in d:
        v.portal_access = bool(d["portal_access"])
    v.save()
    u = v.user
    u.email = data["email"]
    if "is_active" in d:
        u.is_active = bool(d["is_active"])
    if pw:
        u.set_password(pw)
    u.save()
    return Response({"vendor": _vrow(v)})


# ------------------------------------------------------------------ jobs
RATE_HISTORY_JOBS = 1000  # how many of the newest priced jobs are read for the "last paid" reference


def _vendor_rates(lines):
    """What each vendor was paid for the same work on earlier jobs - a reference for judging a quote
    (the vendor's NEW price comes from the price request itself).
    A job's price is one amount for the whole job, so only jobs holding ONE kind of item are used (price / total qty = per piece);
    rejected / cancelled jobs and price requests are ignored; the newest job is the "last" rate.
    Items are matched by rate_key (capitals / spacing ignored). One entry per vendor + item (item_id)."""
    wanted = {}
    for l in lines:
        k = rate_key(l["service_name"])
        if k:
            wanted.setdefault(k, []).append(l)
    if not wanted:
        return []
    out = []
    qs = jobs_queryset(VendorJob.objects.filter(vendor_price__gt=0, status__in=TAKEN_STATUSES,
                                                vendor__user__is_active=True))[:RATE_HISTORY_JOBS]
    acc = {}
    for j in qs:  # newest first, so the first job met for a vendor + item is its last one
        job_lines = j.lines()
        names = {l["service_name"] for l in job_lines}
        qty = sum(int(l["qty"] or 0) for l in job_lines)
        if len(names) != 1 or qty <= 0:
            continue
        key = rate_key(next(iter(names)))
        if key not in wanted:
            continue
        r = acc.get((j.vendor_id, key))
        if r is None:
            r = acc[(j.vendor_id, key)] = {
                "vendor_id": j.vendor_id, "source": "history",
                "per_piece": round(float(j.vendor_price) / qty, 4), "last_price": float(j.vendor_price), "last_qty": qty,
                "last_date": j.created_at.date().isoformat(), "last_job_no": j.job_no, "jobs": 0, "_p": Decimal(0), "_q": 0}
        r["jobs"] += 1
        r["_p"] += j.vendor_price
        r["_q"] += qty
    for (vendor_id, key), r in acc.items():
        r["avg_per_piece"] = round(float(r.pop("_p") / r.pop("_q")), 4)
        for l in wanted[key]:
            out.append({**r, "item_id": l["id"], "service_name": l["service_name"]})
    return out


def _order_jobs_payload(order, manual=False):
    jobs = list(jobs_queryset(order.vendor_jobs.all()))
    taken = {l["id"] for j in jobs if j.status in TAKEN_STATUSES for l in j.lines()}
    if manual:
        free = [manual_item_view(i) for i in manual_items_queryset().filter(order=order) if i.id not in taken]
    else:
        free = [{"id": i.id, "service_name": i.service_name, "qty": i.qty, "spec": i.spec, "files": public_files(i.files)}
                for i in order.items.all() if i.id not in taken]
    return {"jobs": [_jrow(j) for j in jobs], "unassigned": free,
            "rates": _vendor_rates(free)}


def _order_jobs(request, order, manual):
    """GET = the jobs + price requests of one order; POST = ask vendors for a price (mode "quote") or give items to a vendor (mode "assign")."""
    if request.method == "GET":
        return Response(_order_jobs_payload(order, manual))

    d = request.data
    closed = ("delivered", "cancelled") if manual else ("completed", "cancelled")
    if order.status in closed:
        return Response({"error": "This order is already closed."}, status=400)
    ids = d.get("item_ids") or []
    items = list(order.items.filter(pk__in=ids)) if isinstance(ids, list) else []
    if not items or len(items) != len(set(ids)):
        return Response({"error": "Choose at least one item from this order."}, status=400)
    owner, rel = ("manual_order", "manual_items") if manual else ("order", "items")
    already = VendorJob.objects.filter(**{owner: order, "status__in": TAKEN_STATUSES, f"{rel}__in": items}).exists()
    if already:
        return Response({"error": "One of these items is already assigned to a vendor."}, status=400)
    try:
        due = _date(d.get("due_date")) or order.delivery_date or None
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    note = str(d.get("instructions") or "").strip()[:2000]
    send = d.get("send_email", True) not in (False, "false", "False", "0", 0)

    # ---- ask for a price: one request per vendor, nothing is assigned yet
    if d.get("mode") == "quote":
        raw = d.get("vendor_ids")
        raw = raw if isinstance(raw, list) else ([d.get("vendor_id")] if d.get("vendor_id") else [])
        try:
            vendor_ids = list(dict.fromkeys(int(x) for x in raw))
        except (TypeError, ValueError):
            vendor_ids = []
        vendors = list(Vendor.objects.select_related("user").filter(pk__in=vendor_ids, user__is_active=True, portal_access=True))
        if not vendors or len(vendors) != len(vendor_ids):
            return Response({"error": "Choose at least one active vendor to ask for a price."}, status=400)
        for v in vendors:
            if VendorJob.objects.filter(**{owner: order, "vendor": v, "status__in": QUOTE_OPEN, f"{rel}__in": items}).exists():
                return Response({"error": f"{v.name} has already been asked for a price on one of these items. Wait for the answer, or mark that request as not suitable first."}, status=400)
        with transaction.atomic():
            created = []
            for v in vendors:
                job = VendorJob.objects.create(**{owner: order}, vendor=v, status="enquiry", due_date=due, instructions=note)
                getattr(job, rel).set(items)
                created.append(job.pk)
        payload = _order_jobs_payload(order, manual)
        failed, sent = [], 0
        if send:
            for job in jobs_queryset(VendorJob.objects.filter(pk__in=created)):
                r = _email_quote_request(job)
                if r["sent"]:
                    sent += 1
                else:
                    failed.append({"vendor": job.vendor.name, "error": r["error"]})
        payload["quote_mail"] = {"sent": sent, "failed": failed} if send else None
        return Response(payload, status=201)

    # ---- assign straight away (the price is already agreed)
    vendor = Vendor.objects.select_related("user").filter(pk=d.get("vendor_id")).first()
    if vendor is None or not vendor.user.is_active or not vendor.portal_access:
        return Response({"error": "Choose an active vendor."}, status=400)
    try:
        price = _money(d.get("vendor_price"))
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    with transaction.atomic():
        job = VendorJob.objects.create(**{owner: order}, vendor=vendor, vendor_price=price, due_date=due, instructions=note)
        getattr(job, rel).set(items)
        _close_other_quotes(job, items)
    payload = _order_jobs_payload(order, manual)
    payload["email"] = _email_job(jobs_queryset(VendorJob.objects.filter(pk=job.pk)).get()) if send else None
    return Response(payload, status=201)


def _close_other_quotes(job, items):
    """Once items are given to a vendor, every other open price request that includes any of them is no longer valid."""
    rel = "manual_items" if job.is_manual else "items"
    ids = list(VendorJob.objects.filter(status__in=QUOTE_OPEN, **{f"{rel}__in": items}).exclude(pk=job.pk).values_list("pk", flat=True))
    if ids:
        VendorJob.objects.filter(pk__in=list(set(ids))).update(status="not_selected", updated_at=timezone.now())


@api_view(["GET", "POST"])
@permission_classes([IsStaffOrAdmin])
def admin_order_jobs(request, pk):
    order = ShopOrder.objects.filter(pk=pk).first()
    if order is None:
        return Response({"error": "Shop order not found."}, status=404)
    return _order_jobs(request, order, manual=False)


# ------------------------------------------------------------------ manual orders (Admin > Orders)
MANUAL_PAGE_SIZE = 10
MANUAL_CLOSED = ["delivered", "cancelled"]
MANUAL_LABEL = dict(Order._meta.get_field("status").choices)


def _manual_row(o):
    items = list(o.items.all())
    names = []
    for i in items:
        n = manual_item_view(i)["service_name"]
        if n not in names:
            names.append(n)
    return {
        "id": o.id, "source": "manual", "order_no": manual_order_no(o.id),
        "party_name": o.customer.name, "phone": o.customer.phone or "", "work_name": o.work_name,
        "date": o.order_date.isoformat(), "delivery_date": o.delivery_date.isoformat(),
        "items": len(items), "items_text": ", ".join(names[:2]) + (f" +{len(names) - 2} more" if len(names) > 2 else ""),
        "status": o.status, "status_label": MANUAL_LABEL.get(o.status, o.status),
        "instructions": o.notes or "", "assign": assign_row(o, manual=True),
    }


def _manual_queryset():
    return (Order.objects.select_related("customer")
            .prefetch_related(Prefetch("items", queryset=manual_items_queryset()), assign_prefetch(manual=True)))


@api_view(["GET"])
@permission_classes([IsStaffOrAdmin])
def admin_manual_orders(request):
    p = request.query_params
    base = Order.objects.all()
    counts = {"total": base.count(), "open": base.exclude(status__in=MANUAL_CLOSED).count()}
    counts.update({k: base.filter(status=k).count() for k in MANUAL_LABEL})

    qs = _manual_queryset()
    q = (p.get("q") or "").strip()[:100]
    if q:
        cond = Q(customer__name__icontains=q) | Q(customer__phone__icontains=q) | Q(work_name__icontains=q)
        code = q.lower().lstrip("w")  # "W098" or "98" finds order 98
        if code.isdigit():
            cond |= Q(id=int(code))
        qs = qs.filter(cond)
    status = p.get("status", "")
    if status == "open":
        qs = qs.exclude(status__in=MANUAL_CLOSED)
    elif status in MANUAL_LABEL:
        qs = qs.filter(status=status)
    qs = filter_assign(annotate_assign(qs, manual=True), p.get("assign", ""))

    total = qs.count()
    try:
        page = max(1, int(p.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    pages = max(1, (total + MANUAL_PAGE_SIZE - 1) // MANUAL_PAGE_SIZE)
    page = min(page, pages)
    rows = qs.order_by("-id")[(page - 1) * MANUAL_PAGE_SIZE: page * MANUAL_PAGE_SIZE]
    return Response({"counts": counts, "results": [_manual_row(o) for o in rows], "total_count": total,
                     "page": page, "pages": pages, "page_size": MANUAL_PAGE_SIZE})


@api_view(["GET"])
@permission_classes([IsStaffOrAdmin])
def admin_manual_order_detail(request, pk):
    order = _manual_queryset().filter(pk=pk).first()
    if order is None:
        return Response({"error": "Order not found."}, status=404)
    return Response({"order": _manual_row(order)})


@api_view(["GET", "POST"])
@permission_classes([IsStaffOrAdmin])
def admin_manual_order_jobs(request, pk):
    order = Order.objects.filter(pk=pk).first()
    if order is None:
        return Response({"error": "Order not found."}, status=404)
    return _order_jobs(request, order, manual=True)


# ------------------------------------------------------------------ all jobs
@api_view(["GET"])
@permission_classes([IsStaffOrAdmin])
def admin_vendor_jobs(request):
    qs = jobs_queryset()
    p = request.query_params
    if p.get("status") in STATUS_LABEL:
        qs = qs.filter(status=p["status"])
    if str(p.get("vendor", "")).isdigit():
        qs = qs.filter(vendor_id=int(p["vendor"]))
    return Response({"results": [_jrow(j) for j in qs[:200]]})


@api_view(["PATCH"])
@permission_classes([IsStaffOrAdmin])
def admin_vendor_job_detail(request, pk):
    job = jobs_queryset().filter(pk=pk).first()
    if job is None:
        return Response({"error": "Job not found."}, status=404)
    d, fields = request.data, []
    try:
        if "vendor_price" in d:
            job.vendor_price = _money(d["vendor_price"]); fields.append("vendor_price")
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    if "due_date" in d:
        try:
            job.due_date = _date(d["due_date"])
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        fields.append("due_date")
    if "instructions" in d:
        job.instructions = str(d["instructions"] or "").strip()[:2000]; fields.append("instructions")
    nxt = d.get("status")
    accepted = countered = False
    if nxt == "countered":  # NEGOTIATE: answer the vendor's quote with Star Offset's own price
        if job.status not in ("quoted", "countered"):
            return Response({"error": "You can only make a counter offer on a quote the vendor has sent."}, status=400)
        try:
            cp = _money(d.get("counter_price"))
        except ValueError:
            cp = None
        if cp is None or cp <= 0 or cp > Decimal("99999999.99"):
            return Response({"error": "Enter the price you want to offer (more than 0)."}, status=400)
        cp = cp.quantize(Decimal("0.01"))
        cnote = str(d.get("counter_note") or "").strip()[:1000]
        job.status, job.counter_price, job.counter_note, job.countered_at = "countered", cp, cnote, timezone.now()
        job.log_price("admin", "counter", cp, cnote)
        fields += ["status", "counter_price", "counter_note", "countered_at", "negotiation"]
        countered = True
    elif nxt == "assigned":  # ACCEPT the vendor's quote: the work goes to this vendor at the quoted price
        if job.status == "countered":
            return Response({"error": "Your counter offer is still waiting for the vendor. Assign once the vendor accepts it or sends a new price."}, status=400)
        if job.status != "quoted" or job.quoted_price is None:
            return Response({"error": "Only a quote that the vendor has sent can be accepted."}, status=400)
        order = job.manual_order if job.is_manual else job.order
        if order.status in (("delivered", "cancelled") if job.is_manual else ("completed", "cancelled")):
            return Response({"error": "This order is already closed."}, status=400)
        items = list(job.manual_items.all() if job.is_manual else job.items.all())
        rel = "manual_items" if job.is_manual else "items"
        if VendorJob.objects.filter(status__in=TAKEN_STATUSES, **{f"{rel}__in": items}).exclude(pk=job.pk).exists():
            return Response({"error": "One of these items has already been given to another vendor."}, status=400)
        job.status, job.vendor_price = "assigned", job.quoted_price
        job.created_at = timezone.now()  # the work is assigned today (the request date stays in quoted_at / history)
        fields += ["status", "vendor_price", "created_at"]
        accepted = True
    elif nxt == "not_selected":
        if job.status not in QUOTE_OPEN:
            return Response({"error": f"A {STATUS_LABEL[job.status]} request cannot be marked not selected."}, status=400)
        job.status = nxt; fields.append("status")
    elif nxt:
        allowed = {"completed": {"ready"}, "cancelled": {"assigned", "accepted", "in_progress", "ready", "rejected"}}
        if job.status not in allowed.get(nxt, set()):
            return Response({"error": f"A {STATUS_LABEL[job.status]} job cannot be marked {STATUS_LABEL.get(nxt, nxt)}."}, status=400)
        job.status = nxt; fields.append("status")
    if accepted:
        with transaction.atomic():
            job.save(update_fields=fields + ["updated_at"])
            _close_other_quotes(job, items)
        send = d.get("send_email", True) not in (False, "false", "False", "0", 0)
        return Response({"job": _jrow(job), "email": _email_job(job) if send else None})
    if countered:
        job.save(update_fields=fields + ["updated_at"])
        send = d.get("send_email", True) not in (False, "false", "False", "0", 0)
        return Response({"job": _jrow(job), "email": _email_counter_offer(job) if send else None})
    if fields:
        job.save(update_fields=fields + ["updated_at"])
    return Response({"job": _jrow(job)})


@api_view(["POST"])
@permission_classes([IsStaffOrAdmin])
def admin_vendor_job_send(request, pk):
    job = jobs_queryset().filter(pk=pk).first()
    if job is None:
        return Response({"error": "Job not found."}, status=404)
    if job.status == "enquiry":  # still a price request: send the request again (no artwork yet)
        return Response({"email": _email_quote_request(job)})
    if job.status not in ACTIVE_JOB:
        return Response({"error": f"A {STATUS_LABEL[job.status]} job cannot be e-mailed."}, status=400)
    return Response({"email": _email_job(job)})


@api_view(["GET"])
@permission_classes([IsStaffOrAdmin])
def admin_order_file(request, item_id, idx):
    item = ShopOrderItem.objects.filter(pk=item_id).first()
    f = file_of(item, idx) if item else None
    if f is None:
        return Response({"error": "File not found. Orders placed before file storage was added only have their files in the e-mail."}, status=404)
    return download(f)