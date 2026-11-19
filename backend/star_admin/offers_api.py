"""Offers API (admin only): compose / draft / send WhatsApp offers and browse their history.

Sending an offer = one WhatsApp template message per customer. That takes ~1 second per
customer, which is longer than a web request may last (gunicorn kills it after 30s), so the
sending runs in a background thread and the page polls /offers/<id>/progress/.
"""
import threading
import time
from datetime import date

from django.db import connection
from django.db.models import Q
from django.utils.timezone import localtime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .api_views import IsSuperuser
from .models import Customer, OffersHistory
from .serializers import offer_payload
from .utils import format_phone, send_whatsapp_template

OFFER_GROUPS = ("all", "members", "non_members", "selected")
OFFER_CATEGORIES = {"all": None, "student": "Student", "customer": "Customer", "shop": "Shop"}
DEFAULT_SHOP_NUMBER = "9488634058"

# Approved WhatsApp templates an offer can be sent with. send_whatsapp_template() in utils.py
# sends "special_discount_offer", so that is the only one listed.
OFFER_TEMPLATES = [
    {"name": "special_discount_offer", "label": "Special discount offer",
     "body": "Hello {{1}}, {{2}}. For details call us on {{3}}."},
]

OFFER_JOBS = {}  # offer id -> {"total", "success", "failed", "done"}  (kept in this process only)

HISTORY_STATUSES = ("draft", "sending", "sent", "partial", "failed")


class OfferPagination(PageNumberPagination):
    page_size = 8


# ------------------------------------------------------------------ helpers
def _ids(value):
    """'1,2,3' or [1, 2, 3] -> [1, 2, 3] (bad entries dropped, order kept, no duplicates)."""
    if isinstance(value, str):
        value = value.split(",")
    out = []
    for v in value or []:
        try:
            n = int(v)
        except (TypeError, ValueError):
            continue
        if n not in out:
            out.append(n)
    return out


def _offer_recipients(group, category, ids=()):
    """[(name, phone)] for an audience choice. One entry per phone number, so a number
    saved on two customer records is not messaged twice."""
    customers = Customer.objects.exclude(phone__isnull=True).exclude(phone="")
    if group == "selected":
        customers = customers.filter(id__in=list(ids))
    else:
        if group == "members":
            customers = customers.filter(is_member=True)
        elif group == "non_members":
            customers = customers.filter(is_member=False)
        if OFFER_CATEGORIES[category]:
            customers = customers.filter(category__iexact=OFFER_CATEGORIES[category])

    seen, people = set(), []
    for c in customers.order_by("id"):
        phone = format_phone(c.phone)
        if phone in seen:
            continue
        seen.add(phone)
        people.append((c.name, c.phone))
    return people


def _date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return False  # present but invalid


def _fmt(d):
    return f"{d.day} {d.strftime('%b %Y')}"


def _validity_text(valid_from, valid_until):
    if valid_from and valid_until:
        return f"Valid from {_fmt(valid_from)} to {_fmt(valid_until)}"
    if valid_until:
        return f"Valid until {_fmt(valid_until)}"
    if valid_from:
        return f"Valid from {_fmt(valid_from)}"
    return ""


def _read_offer(data, for_send):
    """Validate the form body. Returns (fields, error). Drafts only need a title."""
    title = (data.get("title") or "").strip()
    message = (data.get("message") or "").strip()
    shop_number = (data.get("shop_number") or "").strip()
    group = data.get("group") or "all"
    category = data.get("category") or "all"
    valid_from, valid_until = _date(data.get("valid_from")), _date(data.get("valid_until"))
    ids = _ids(data.get("customer_ids"))

    if not title:
        return None, "Offer title is required"
    if len(title) > 100:
        return None, "Title can be at most 100 characters"
    if group not in OFFER_GROUPS or category not in OFFER_CATEGORIES:
        return None, "Invalid audience or category"
    if valid_from is False or valid_until is False:
        return None, "Invalid date"
    if valid_from and valid_until and valid_until < valid_from:
        return None, "“Valid until” cannot be before “Valid from”"
    if len(shop_number) > 20:
        return None, "Shop contact number is too long"
    if group == "selected":
        category = "all"
    else:
        ids = []

    if for_send:
        if not message:
            return None, "Message is required"
        if not shop_number:
            return None, "Shop contact number is required"
        if valid_until and valid_until < localtime().date():
            return None, "“Valid until” is already in the past"
        if group == "selected" and not ids:
            return None, "Select at least one customer"

    return {
        "title": title, "message": message, "shop_number": shop_number, "group": group,
        "category": category, "valid_from": valid_from, "valid_until": valid_until,
        "customer_ids": ids,
    }, None


def _final_status(success, failed):
    if failed == 0:
        return "sent"
    return "failed" if success == 0 else "partial"


def _run_offer_job(offer_id, people, message, shop_number):
    job = OFFER_JOBS[offer_id]
    try:
        for name, phone in people:
            try:
                response = send_whatsapp_template(
                    phone=phone, customer_name=name, offer_message=message, shop_number=shop_number
                )
                ok = bool(response.get("messages"))
                if not ok:
                    print("Whatsapp failed", response)
            except Exception as e:  # one bad number must not stop the rest
                print("Error:", e)
                ok = False

            job["success" if ok else "failed"] += 1
            OffersHistory.objects.filter(pk=offer_id).update(
                total_sent=job["success"], failed=job["failed"])
            time.sleep(1)
    finally:
        OffersHistory.objects.filter(pk=offer_id).update(
            total_sent=job["success"], failed=job["failed"],
            status=_final_status(job["success"], job["failed"]))
        job["done"] = True
        connection.close()  # this thread opened its own DB connection


def _settle_stale(offer):
    """A 'sending' offer with no running job in this process (server restarted) is finished."""
    job = OFFER_JOBS.get(offer.id)
    if offer.status == "sending" and (job is None or job["done"]):
        offer.status = _final_status(offer.total_sent, offer.failed)
        offer.save(update_fields=["status"])


# ------------------------------------------------------------------ views
@api_view(["GET"])
@permission_classes([IsSuperuser])
def offers_summary(request):
    """Numbers for the stat cards + what the compose form needs."""
    today = localtime().date()
    members = Customer.objects.filter(is_member=True).filter(
        Q(expiry_date__isnull=True) | Q(expiry_date__gte=today))
    return Response({
        "total_customers": Customer.objects.count(),
        "active_members": members.count(),
        "offers_sent": OffersHistory.objects.exclude(status="draft").count(),
        "templates": OFFER_TEMPLATES,
        "default_shop_number": DEFAULT_SHOP_NUMBER,
    })


@api_view(["GET"])
@permission_classes([IsSuperuser])
def offers_customers(request):
    """Search box of the 'Selected Customers' picker (name or phone, max 30)."""
    q = (request.query_params.get("q") or "").strip()
    rows = Customer.objects.exclude(phone__isnull=True).exclude(phone="")
    if q:
        rows = rows.filter(Q(name__icontains=q) | Q(phone__icontains=q))
    rows = rows.order_by("name")[:30]
    return Response({"customers": [
        {"id": c.id, "name": c.name, "phone": c.phone, "category": c.category, "is_member": c.is_member}
        for c in rows
    ]})


@api_view(["GET"])
@permission_classes([IsSuperuser])
def offers_recipients(request):
    """How many people an offer would reach (shown while composing)."""
    p = request.query_params
    group, category = p.get("group") or "all", p.get("category") or "all"
    if group not in OFFER_GROUPS or category not in OFFER_CATEGORIES:
        return Response({"error": "Invalid audience or category"}, status=400)
    return Response({"count": len(_offer_recipients(group, category, _ids(p.get("ids"))))})


@api_view(["POST"])
@permission_classes([IsSuperuser])
def offers_draft(request):
    """Save the form as a draft (nothing is sent). Body may carry `id` to update a draft."""
    fields, error = _read_offer(request.data, for_send=False)
    if error:
        return Response({"error": error}, status=400)

    offer = None
    if request.data.get("id"):
        offer = OffersHistory.objects.filter(pk=request.data.get("id"), status="draft").first()
    if offer is None:
        offer = OffersHistory(total_sent=0, status="draft")
    for k, v in fields.items():
        setattr(offer, k, v)
    offer.save()
    return Response(offer_payload(offer), status=201)


@api_view(["POST"])
@permission_classes([IsSuperuser])
def offers_send(request):
    fields, error = _read_offer(request.data, for_send=True)
    if error:
        return Response({"error": error}, status=400)

    if any(not j["done"] for j in OFFER_JOBS.values()):
        return Response({"error": "Another offer is still being sent. Please wait for it to finish."},
                        status=409)

    people = _offer_recipients(fields["group"], fields["category"], fields["customer_ids"])
    if not people:
        return Response({"error": "No customers with a phone number match this selection"}, status=400)

    # sending a saved draft turns that draft into the sent offer
    offer = None
    if request.data.get("draft_id"):
        offer = OffersHistory.objects.filter(pk=request.data.get("draft_id"), status="draft").first()
    if offer is None:
        offer = OffersHistory()
    for k, v in fields.items():
        setattr(offer, k, v)
    offer.total_sent, offer.failed, offer.total_recipients, offer.status = 0, 0, len(people), "sending"
    offer.save()

    # WhatsApp template parameters may not contain line breaks, tabs or long runs of spaces
    text = f"{fields['title']} - {fields['message']}"
    validity = _validity_text(fields["valid_from"], fields["valid_until"])
    if validity:
        text += f" ({validity})"
    clean_message = " ".join(text.split())

    for old_id in sorted(OFFER_JOBS)[:-20]:  # keep the job list small
        OFFER_JOBS.pop(old_id, None)
    OFFER_JOBS[offer.id] = {"total": len(people), "success": 0, "failed": 0, "done": False}

    threading.Thread(
        target=_run_offer_job, args=(offer.id, people, clean_message, fields["shop_number"]),
        daemon=True,
    ).start()

    return Response({"id": offer.id, **OFFER_JOBS[offer.id]}, status=202)


@api_view(["GET"])
@permission_classes([IsSuperuser])
def offers_progress(request, pk):
    job = OFFER_JOBS.get(pk)
    if job:
        return Response({"id": pk, **job})

    # not in memory (server restarted since): fall back to what was saved
    offer = OffersHistory.objects.filter(pk=pk).first()
    if offer is None:
        return Response({"detail": "Not found"}, status=404)
    return Response({"id": pk, "total": offer.total_recipients or offer.total_sent + offer.failed,
                     "success": offer.total_sent, "failed": offer.failed, "done": True})


@api_view(["GET"])
@permission_classes([IsSuperuser])
def offers_history(request):
    p = request.query_params
    qs = OffersHistory.objects.all().order_by("-created_at", "-id")

    q = (p.get("q") or "").strip()
    if q:
        qs = qs.filter(title__icontains=q)
    if p.get("status") in HISTORY_STATUSES:
        qs = qs.filter(status=p["status"])
    start, end = _date(p.get("date_from")), _date(p.get("date_to"))
    if start:
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)

    pager = OfferPagination()
    page = pager.paginate_queryset(qs, request)
    for o in page:
        _settle_stale(o)
    return pager.get_paginated_response([offer_payload(o) for o in page])


@api_view(["GET", "DELETE"])
@permission_classes([IsSuperuser])
def offers_history_item(request, pk):
    offer = OffersHistory.objects.filter(pk=pk).first()
    if offer is None:
        return Response({"detail": "Not found"}, status=404)

    if request.method == "DELETE":
        offer.delete()
        return Response(status=204)

    # GET: used to reopen a draft in the compose form
    data = offer_payload(offer)
    data["customer_ids"] = offer.customer_ids
    data["customers"] = [
        {"id": c.id, "name": c.name, "phone": c.phone}
        for c in Customer.objects.filter(id__in=offer.customer_ids)
    ]
    return Response(data)
