"""Shop Payments (admin only): the money shops pay through the Shop Portal wallet.

    GET /api/admin/shop-payments/?date_from=&date_to=&view=&q=&shop=&page=
        -> every wallet transaction of the period + summary cards
           view = received | spent | pending | failed | refunds   (empty = everything)
    GET /api/admin/shop-payments/wallets/?q=&page=
        -> one row per shop: wallet balance and lifetime top-ups / spending

How the numbers are defined (the Reports > Collections report uses the same rules):
    Received          = completed credits on a shop wallet (Razorpay payments - top-ups and "pay online" orders)
    Spent on orders   = completed debits (a shop paid an order from its wallet; the cash was received earlier)
    Pending / Failed  = payments that were started but never completed / were rejected
A payment is dated by the day it was completed (pending / failed ones by the day they were started).
"""
import re
from decimal import Decimal

from django.db.models import Count, DecimalField, Max, Q, Sum, Value
from django.db.models.functions import Coalesce
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .api_views import IsSuperuser
from .models import Shop, ShopWallet
from .reports_api import _dec, _period, _period_json, _shop_txns

PAGE_SIZE = 15
ZERO = Decimal("0")
DONE = Q(status="completed")
VIEWS = {
    "received": Q(kind="credit") & DONE,
    "spent": Q(kind="debit") & DONE,
    "pending": Q(status="pending"),
    "failed": Q(status="failed"),
    "refunds": Q(kind="refund"),
}


def _type_of(t):
    """topup | online_order (paid online for one order) | order_payment (paid from the wallet) | refund | adjustment"""
    if t.kind == "credit":
        return "online_order" if (t.description or "").startswith("Online payment") else "topup"
    return "order_payment" if t.kind == "debit" else t.kind


def _order_id(t):
    ref = t.reference or ""
    if t.kind == "debit" and ref.startswith("ORD-") and ref[4:].isdigit():
        return int(ref[4:])
    return None


def _row(t):
    order_id = _order_id(t)
    return {
        "id": t.id, "at": t.when.isoformat(), "type": _type_of(t), "kind": t.kind, "status": t.status,
        "amount": t.amount, "reference": t.reference, "razorpay_order_id": t.razorpay_order_id,
        "description": t.description, "order_id": order_id, "order_no": f"ORD-{order_id:04d}" if order_id else None,
        "shop": {"id": t.wallet.shop_id, "name": t.wallet.shop.name, "phone": t.wallet.shop.phone},
    }


def _page(request, total):
    pages = max(1, -(-total // PAGE_SIZE))
    try:
        page = min(max(int(request.query_params.get("page", 1)), 1), pages)
    except ValueError:
        page = 1
    return page, pages, (page - 1) * PAGE_SIZE, page * PAGE_SIZE


@api_view(["GET"])
@permission_classes([IsSuperuser])
def shop_payments(request):
    p = request.query_params
    start, end = _period(p)
    base = _shop_txns(start, end)
    shop_id = (p.get("shop") or "").strip()
    if shop_id.isdigit():
        base = base.filter(wallet__shop_id=int(shop_id))

    # the cards always describe the whole period (and shop); view / search only narrow the table
    agg = base.aggregate(
        received=Sum("amount", filter=VIEWS["received"]), received_n=Count("id", filter=VIEWS["received"]),
        spent=Sum("amount", filter=VIEWS["spent"]), spent_n=Count("id", filter=VIEWS["spent"]),
        pending=Sum("amount", filter=VIEWS["pending"]), pending_n=Count("id", filter=VIEWS["pending"]),
        failed_n=Count("id", filter=VIEWS["failed"]),
        refunds=Sum("amount", filter=VIEWS["refunds"] & DONE), refunds_n=Count("id", filter=VIEWS["refunds"]),
        everything=Count("id"))
    held = ShopWallet.objects.aggregate(total=Sum("balance"), shops=Count("id", filter=Q(balance__gt=0)))
    summary = {
        "received": _dec(agg["received"]), "received_count": agg["received_n"] or 0,
        "spent": _dec(agg["spent"]), "spent_count": agg["spent_n"] or 0,
        "pending": _dec(agg["pending"]), "pending_count": agg["pending_n"] or 0,
        "failed_count": agg["failed_n"] or 0,
        "refunds": _dec(agg["refunds"]), "refunds_count": agg["refunds_n"] or 0,
        "all_count": agg["everything"] or 0,
        "balance": _dec(held["total"]), "shops_with_balance": held["shops"] or 0,
    }

    qs = base
    view = p.get("view")
    if view in VIEWS:
        qs = qs.filter(VIEWS[view])
    q = (p.get("q") or "").strip()[:100]
    if q:
        cond = (Q(wallet__shop__name__icontains=q) | Q(wallet__shop__phone__icontains=q)
                | Q(reference__icontains=q) | Q(description__icontains=q) | Q(razorpay_order_id__icontains=q))
        m = re.fullmatch(r"(?i)ord-?(\d+)", q)
        if m:
            cond |= Q(reference__iexact=f"ORD-{int(m.group(1)):04d}")
        qs = qs.filter(cond)
    qs = qs.order_by("-when", "-id")

    total = qs.count()
    page, pages, lo, hi = _page(request, total)
    return Response({"period": _period_json(start, end), "summary": summary,
                     "results": [_row(t) for t in qs[lo:hi]],
                     "count": total, "page": page, "pages": pages, "page_size": PAGE_SIZE})


@api_view(["GET"])
@permission_classes([IsSuperuser])
def shop_wallets(request):
    """Every shop with its wallet balance and lifetime totals (the date range does not apply)."""
    zero = Value(ZERO, output_field=DecimalField(max_digits=12, decimal_places=2))
    tx = "wallet__transactions__"
    done = Q(**{tx + "status": "completed"})
    qs = (Shop.objects.select_related("wallet")
          .annotate(balance=Coalesce("wallet__balance", zero),
                    topped_up=Sum(tx + "amount", filter=Q(**{tx + "kind": "credit"}) & done),
                    spent=Sum(tx + "amount", filter=Q(**{tx + "kind": "debit"}) & done),
                    paid_orders=Count(tx + "id", filter=Q(**{tx + "kind": "debit"}) & done),
                    last_payment=Max(tx + "completed_at", filter=Q(**{tx + "kind": "credit"}) & done)))
    q = (request.query_params.get("q") or "").strip()[:100]
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(phone__icontains=q) | Q(owner_name__icontains=q) | Q(email__icontains=q))

    held = ShopWallet.objects.aggregate(total=Sum("balance"), shops=Count("id", filter=Q(balance__gt=0)))
    summary = {"balance": _dec(held["total"]), "shops_with_balance": held["shops"] or 0, "shops": Shop.objects.count()}

    qs = qs.order_by("-balance", "name")
    total = qs.count()
    page, pages, lo, hi = _page(request, total)
    rows = [{"id": s.id, "shop": {"id": s.id, "name": s.name, "phone": s.phone}, "balance": s.balance,
             "topped_up": _dec(s.topped_up), "spent": _dec(s.spent), "orders": s.paid_orders or 0,
             "last_payment": s.last_payment.isoformat() if s.last_payment else None,
             "portal_access": s.portal_access} for s in qs[lo:hi]]
    return Response({"summary": summary, "results": rows, "count": total, "page": page, "pages": pages,
                     "page_size": PAGE_SIZE})