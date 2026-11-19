"""My Orders + Order History: the orders a shop has placed.  A shop only ever sees its own orders.

    GET  /api/shop/orders/?q=&status=&date_from=&date_to=&page=&per_page=   all orders (per_page 10 / 20 / 50)
    GET  /api/shop/orders/history/?...same filters...                        completed + cancelled orders only
    GET  /api/shop/orders/history/export/?...same filters...                 the filtered history as a CSV file
    GET  /api/shop/orders/<id>/                                              one order with its items
    GET  /api/shop/orders/<id>/invoice/ (+ /pdf/)                            the invoice of a paid order - see shop_invoice_api.py
    POST /api/shop/orders/<id>/reorder/                                      a completed order's items, priced again, ready for the cart
"""
import csv
import re
from datetime import date

from django.db.models import Count, Q
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import ShopOrder
from .shop_invoice_api import invoice_ready
from .shop_portal_api import IsShopUser
from .shop_pricing_api import _qty, describe, estimate_for

PAGE_SIZE = 10
PAGE_SIZES = (10, 20, 50)
STATUSES = [value for value, _ in ShopOrder.STATUS_CHOICES]
HISTORY_STATUSES = ["completed", "cancelled"]


def _day(text):
    try:
        return date.fromisoformat((text or "").strip()[:10])
    except ValueError:
        return None


def _items_text(order):
    """'Bill Book, Flyers +1 more' (uses the prefetched items)."""
    names = []
    for i in order.items.all():
        if i.service_name not in names:
            names.append(i.service_name)
    text = ", ".join(names[:2])
    return text + (f" +{len(names) - 2} more" if len(names) > 2 else "")


def _row(o):
    return {
        "id": o.id,
        "order_no": o.order_no,
        "date": o.created_at.date().isoformat(),
        "items": o.items_count,
        "items_text": _items_text(o),
        "qty": sum(i.qty for i in o.items.all()),
        "amount": str(o.final_amount if o.final_amount is not None else o.total_amount),
        "estimated_amount": str(o.total_amount),
        "final_amount": str(o.final_amount) if o.final_amount is not None else None,
        "payment_method": o.payment_method,
        "payment_reference": o.payment_reference,
        "payment_confirmed_at": o.payment_confirmed_at.isoformat() if o.payment_confirmed_at else None,
        "status": o.status,
        "status_label": o.get_status_display(),
        "invoice_available": invoice_ready(o),  # the shop can view / download the invoice
    }


def _filtered(request, base):
    """Apply the search / status / date filters from the query string to `base`."""
    orders = base
    status = request.query_params.get("status", "")
    if status in STATUSES:
        orders = orders.filter(status=status)
    start, end = _day(request.query_params.get("date_from")), _day(request.query_params.get("date_to"))
    if start:
        orders = orders.filter(created_at__date__gte=start)
    if end:
        orders = orders.filter(created_at__date__lte=end)

    q = (request.query_params.get("q") or "").strip()[:60]
    if q:
        match = Q(items__service_name__icontains=q) | Q(instructions__icontains=q)
        digits = re.sub(r"\D", "", q) if re.fullmatch(r"(?i)(ord-?)?\d+", q) else ""
        if digits:
            match |= Q(id=int(digits))
        orders = orders.filter(match).distinct()
    return orders


def _list_response(request, base, with_counts):
    orders = _filtered(request, base)
    total_count = orders.count()
    try:
        size = int(request.query_params.get("per_page", PAGE_SIZE))
    except ValueError:
        size = PAGE_SIZE
    if size not in PAGE_SIZES:
        size = PAGE_SIZE
    pages = max(1, -(-total_count // size))
    try:
        page = min(max(int(request.query_params.get("page", 1)), 1), pages)
    except ValueError:
        page = 1
    chunk = orders.prefetch_related("items").order_by("-created_at", "-id")[(page - 1) * size: page * size]
    return Response({
        "counts": with_counts,
        "results": [_row(o) for o in chunk],
        "page": page,
        "pages": pages,
        "page_size": size,
        "total_count": total_count,
    })


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_orders_list(request):
    mine = ShopOrder.objects.filter(shop=request.user.shop_profile)
    # the cards at the top always count every order of the shop, whatever the filters say
    counts = mine.aggregate(
        total=Count("id"),
        submitted=Count("id", filter=Q(status="submitted")),
        awaiting_payment=Count("id", filter=Q(status="awaiting_payment")),
        payment_confirmed=Count("id", filter=Q(status="payment_confirmed")),
        in_production=Count("id", filter=Q(status="in_production")),
        completed=Count("id", filter=Q(status="completed")),
    )
    return _list_response(request, mine, counts)


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_order_history(request):
    past = ShopOrder.objects.filter(shop=request.user.shop_profile, status__in=HISTORY_STATUSES)
    counts = past.aggregate(
        total=Count("id"),
        completed=Count("id", filter=Q(status="completed")),
        cancelled=Count("id", filter=Q(status="cancelled")),
    )
    return _list_response(request, past, counts)


def _safe(value):
    """Stops a spreadsheet from treating text as a formula."""
    text = str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_order_history_export(request):
    past = ShopOrder.objects.filter(shop=request.user.shop_profile, status__in=HISTORY_STATUSES)
    orders = _filtered(request, past).prefetch_related("items").order_by("-created_at", "-id")

    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="order-history.csv"'
    response.write("\ufeff")  # so Excel opens it as UTF-8 (the rupee sign)
    out = csv.writer(response)
    out.writerow(["Order No", "Order Date", "Printing Items", "Number of Items", "Estimated Amount (Rs.)", "Status"])
    for o in orders:
        names = "; ".join(f"{i.service_name} x {i.qty}" for i in o.items.all())
        out.writerow([o.order_no, o.created_at.date().isoformat(), _safe(names), o.items_count,
                      o.total_amount if o.total_amount > 0 else "", o.get_status_display()])
    return response


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_order_detail(request, pk):
    order = ShopOrder.objects.filter(shop=request.user.shop_profile, pk=pk).first()
    if order is None:
        return Response({"error": "Order not found."}, status=404)
    items = [
        {
            "service_name": i.service_name,
            "spec": i.spec,
            "qty": i.qty,
            "estimate": str(i.estimate) if i.estimate is not None else None,
            "files": [{"name": f.get("name"), "size": f.get("size")} for f in (i.files or []) if isinstance(f, dict)],
        }
        for i in order.items.all()
    ]
    return Response({
        "order": {
            **_row(order),
            "delivery_date": order.delivery_date.isoformat() if order.delivery_date else None,
            "instructions": order.instructions,
            "updated_at": order.updated_at.isoformat(),
            "final_amount": str(order.final_amount) if order.final_amount is not None else None,
            "payment_method": order.payment_method,
            "payment_reference": order.payment_reference,
            "payment_confirmed_at": order.payment_confirmed_at.isoformat() if order.payment_confirmed_at else None,
        },
        "items": items,
    })


@api_view(["POST"])
@permission_classes([IsShopUser])
def shop_order_reorder(request, pk):
    """Rebuild a completed order's items with today's names and prices so the browser can put them in the cart.
    Artwork files are not kept on the server, so the shop attaches them again in the cart."""
    order = ShopOrder.objects.filter(shop=request.user.shop_profile, pk=pk, status="completed").first()
    if order is None:
        return Response({"error": "Only completed orders can be ordered again."}, status=404)

    items, skipped = [], 0
    for i in order.items.all():
        params = i.params if isinstance(i.params, dict) else {}
        found = describe(params) if params and _qty(params) is not None else None
        if not found:
            skipped += 1  # the service or option no longer exists
            continue
        name, spec = found
        price = estimate_for(params)
        items.append({
            "service_name": name,
            "kind": params.get("kind"),
            "qty": int(params["qty"]),
            "spec": spec,
            "estimate": float(price["estimate"]) if price["available"] else None,
            "params": params,
        })
    return Response({"order_no": order.order_no, "items": items, "skipped": skipped})