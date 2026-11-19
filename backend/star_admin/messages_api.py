"""WhatsApp Messages API (inbox filters + stats, approved-template sending).

Kept in its own file so api_views.py does not have to change. Still handled by api_views.py:
    GET  /api/messages/unread/            sidebar badge
    GET  /api/messages/chat/<phone>/      thread (+ ?after=<id> polling), marks read
    POST /api/messages/chat/<phone>/      free-text reply (24-hour window)
Handled here:
    GET  /api/messages/                   inbox: search, filter, date range, stats
    GET  /api/messages/templates/         approved templates (+ prefilled values for ?phone=)
    POST /api/messages/chat/<phone>/template/   send an approved template (works after 24 hours)
"""
from datetime import datetime, time as dtime, timedelta

import requests
from django.db.models import Count, Max, Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.decorators import api_view
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .api_views import _unread_conversations
from .models import Customer, Order, WhatsappMessage
from .serializers import whatsapp_message_payload
from .utils import PHONE_NUMBER_ID, TOKEN, format_phone


# ------------------------------------------------------------------ inbox
class InboxPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"  # the chat screen's left list asks for 100
    max_page_size = 100


def _date(value):
    try:
        return parse_date(value or "")
    except ValueError:
        return None


@api_view(["GET"])
def whatsapp_inbox(request):
    """One row per phone number.
    ?q=         name / phone / any message text
    ?filter=    all | unread | needs_reply (customer wrote last) | replied (we wrote last)
    ?from= ?to= YYYY-MM-DD, applied to the time of each conversation's last message
    """
    params = request.query_params
    q = (params.get("q") or "").strip()
    flt = params.get("filter") or "all"
    d_from, d_to = _date(params.get("from")), _date(params.get("to"))

    # id of the newest message of every phone -> who wrote last
    last_ids = (WhatsappMessage.objects.order_by().values("phone")
                .annotate(last_id=Max("id")).values("last_id"))
    last_in = WhatsappMessage.objects.filter(id__in=last_ids, direction="in")
    last_out = WhatsappMessage.objects.filter(id__in=last_ids, direction="out")

    stats = {  # always for the whole inbox, not for the current filter
        "conversations": WhatsappMessage.objects.order_by().values("phone").distinct().count(),
        "unread": _unread_conversations(),
        "needs_reply": last_in.count(),
    }

    base = WhatsappMessage.objects.all()
    if flt == "unread":
        base = base.filter(phone__in=WhatsappMessage.objects.filter(direction="in", is_read=False)
                           .order_by().values("phone"))
    elif flt == "needs_reply":
        base = base.filter(phone__in=last_in.order_by().values("phone"))
    elif flt == "replied":
        base = base.filter(phone__in=last_out.order_by().values("phone"))

    if q:
        phones = base.filter(
            Q(phone__icontains=q) | Q(body__icontains=q) | Q(customer__name__icontains=q)
        ).values("phone")
        base = base.filter(phone__in=phones)

    groups = (
        base.order_by().values("phone")
        .annotate(
            last_time=Max("created_at"),
            last_id=Max("id"),
            unread=Count("id", filter=Q(direction="in", is_read=False)),
        )
    )
    if d_from:
        groups = groups.filter(last_time__gte=timezone.make_aware(datetime.combine(d_from, dtime.min)))
    if d_to:
        groups = groups.filter(
            last_time__lt=timezone.make_aware(datetime.combine(d_to + timedelta(days=1), dtime.min)))
    groups = groups.order_by("-last_time", "-last_id")

    pager = InboxPagination()
    page = pager.paginate_queryset(groups, request)

    last = WhatsappMessage.objects.select_related("customer").in_bulk([g["last_id"] for g in page])
    rows = []
    for g in page:
        m = last[g["last_id"]]
        rows.append({
            "phone": g["phone"],
            "customer_name": m.customer.name if m.customer else None,
            "unread": g["unread"],
            "needs_reply": m.direction == "in",
            "last_message": whatsapp_message_payload(m),
        })

    response = pager.get_paginated_response(rows)
    response.data["unread_conversations"] = stats["unread"]
    response.data["stats"] = stats
    return response


# -------------------------------------------------------------- templates
# Only templates APPROVED in your Meta WhatsApp Manager can be sent.
# "name" must match the approved template name exactly. "body" is only used for the on-screen
# preview and the chat log - paste the real approved text here (the {{1}} {{2}} numbers follow
# the order of "params").
WA_TEMPLATES = {
    "order_completed": {
        "label": "Order completed",
        "language": "en",
        "body": "Hello {{1}}, your order \"{{2}}\" is completed and ready for pickup.",
        "params": [
            {"key": "customer_name", "label": "Customer name"},
            {"key": "work_name", "label": "Work / order name"},
        ],
    },
    "special_discount_offer": {
        "label": "Special discount offer",
        "language": "en",
        "body": "Hello {{1}}, {{2}}. For details call us on {{3}}.",
        "params": [
            {"key": "customer_name", "label": "Customer name"},
            {"key": "offer_message", "label": "Offer message"},
            {"key": "shop_number", "label": "Shop number"},
        ],
    },
}


def _customer_for(phone):
    return Customer.objects.filter(phone__endswith=str(phone).strip()[-10:]).first()


def _render(body, values):
    for i, v in enumerate(values, start=1):
        body = body.replace("{{%d}}" % i, v)
    return body


@api_view(["GET"])
def whatsapp_templates(request):
    """List of templates. With ?phone=... the customer's name and latest order are prefilled."""
    customer = _customer_for(request.query_params.get("phone") or "")
    defaults = {}
    if customer:
        defaults["customer_name"] = customer.name
        order = Order.objects.filter(customer=customer).order_by("-id").first()
        if order:
            defaults["work_name"] = order.work_name

    return Response({"templates": [
        {
            "name": name,
            "label": t["label"],
            "body": t["body"],
            "params": [{**p, "value": defaults.get(p["key"], "")} for p in t["params"]],
        }
        for name, t in WA_TEMPLATES.items()
    ]})


@api_view(["POST"])
def whatsapp_send_template(request, phone):
    """POST {template: "order_completed", params: {customer_name: "...", work_name: "..."}}"""
    phone = str(phone).strip()
    name = request.data.get("template")
    tpl = WA_TEMPLATES.get(name)
    if tpl is None:
        return Response({"error": "Choose a template first"}, status=400)

    given = request.data.get("params") or {}
    values = []
    for p in tpl["params"]:
        # template parameters may not contain line breaks, tabs or long runs of spaces
        v = " ".join(str(given.get(p["key"]) or "").split())
        if not v:
            return Response({"error": f"{p['label']} is required"}, status=400)
        if len(v) > 1000:
            return Response({"error": f"{p['label']} is too long"}, status=400)
        values.append(v)

    data = {
        "messaging_product": "whatsapp",
        "to": format_phone(phone),
        "type": "template",
        "template": {
            "name": name,
            "language": {"code": tpl["language"]},
            "components": [{
                "type": "body",
                "parameters": [{"type": "text", "text": v} for v in values],
            }],
        },
    }
    try:
        resp = requests.post(
            f"https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages",
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
            json=data, timeout=20,
        )
        result = resp.json()
    except (requests.RequestException, ValueError) as e:
        return Response({"error": f"Could not reach WhatsApp: {e}"}, status=502)

    if not result.get("messages"):
        error_msg = result.get("error", {}).get("message", "Unknown error")
        return Response({"error": f"Failed to send: {error_msg}"}, status=400)

    msg = WhatsappMessage.objects.create(
        direction="out",
        phone=phone,
        customer=_customer_for(phone),
        message_type="template",
        body=_render(tpl["body"], values),
        wa_message_id=result["messages"][0].get("id"),
        is_read=True,
        raw_payload=result,
    )
    return Response(whatsapp_message_payload(msg), status=201)