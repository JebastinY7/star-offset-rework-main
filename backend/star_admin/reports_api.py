"""Reports API (admin only) - replaces the old /reports/ Django page and its Excel / PDF downloads.

    GET /api/reports/overview/?date_from=&date_to=
        -> period, KPI summary, sales / collections chart, sales by category, recent transactions
    GET /api/reports/<kind>/?date_from=&date_to=&q=&page=&...        kind = sales | collections |
        -> {count, next, previous, results, summary, period}                 outstanding | orders | customers | shop
    GET /api/reports/<kind>/export/?file=xlsx|pdf&<same filters>
        -> every row matching the filters (all pages) as an Excel or PDF file

How the numbers are defined (kept identical on every screen so the totals always agree):
    Sales        = sum of Bill.final_amount for bills dated inside the period
    Collected    = money received in the period = Bill.paid_amount + Bill.old_due_paid (old dues
                   cleared while billing) + advances of orders that are not billed yet (cancelled
                   orders are left out)
    Outstanding  = sum of Bill.current_due for bills dated inside the period (same as Bill History)

Shop Portal money (wallet top-ups paid online through Razorpay) is part of "Collected": every completed
credit on a shop wallet counts once, on the day the payment was completed. Money a shop spends from its
wallet on an order is NOT counted again (the cash was already received when the wallet was topped up).

Kept in its own file so api_views.py does not have to change (same pattern as membership_api.py).
"""
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
from io import BytesIO

from django.db.models import CharField, Count, DecimalField, Max, Min, Q, Sum, Value
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.utils import timezone
from django.utils.timezone import localtime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .api_views import IsSuperuser
from .models import Bill, BillItem, Customer, MembershipTransaction, Order, Shop, ShopWallet, ShopWalletTransaction

ZERO = Decimal("0")
KINDS = ("sales", "collections", "outstanding", "orders", "customers", "shop")
CUSTOMER_CATEGORIES = ("Student", "Customer", "Shop")
DAILY_CHART_MAX_DAYS = 62          # longer periods are drawn month by month
AGEING_BUCKETS = (("0-7", 0, 7), ("8-30", 8, 30), ("31-60", 31, 60), ("60+", 61, None))


class ReportPagination(PageNumberPagination):
    page_size = 15
    page_size_query_param = "page_size"
    max_page_size = 100


# ---------------------------------------------------------------- helpers
def _day(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _period(p):
    """(start, end) from ?date_from / ?date_to. Default = 1st of this month .. today."""
    today = timezone.localdate()
    start = _day(p.get("date_from")) or today.replace(day=1)
    end = _day(p.get("date_to")) or today
    if start > end:
        start, end = end, start
    return start, end


def _dec(value):
    return value if value is not None else ZERO


def _order_no(pk):
    return "W" + str(pk).zfill(3)


def _bills_in(start, end, p=None):
    """Bills of the period, optionally narrowed by ?category= and ?member_type= (old report filters)."""
    qs = Bill.objects.filter(bill_date__range=(start, end))
    if p is not None:
        category = p.get("category")
        if category in CUSTOMER_CATEGORIES:
            qs = qs.filter(customer__category=category)
        member_type = p.get("member_type")
        if member_type == "member":
            qs = qs.filter(customer__is_member=True)
        elif member_type == "non_member":
            qs = qs.filter(customer__is_member=False)
    return qs


def _unbilled_advances(start, end):
    """Advances taken on orders that are not billed yet (once billed, the bill carries the payment)."""
    return (Order.objects.filter(is_billed=False, advance_paid__gt=0, order_date__range=(start, end))
            .exclude(status="cancelled"))


def _period_json(start, end):
    return {"date_from": start.isoformat(), "date_to": end.isoformat()}


def _customer_json(c):
    return {"id": c.id, "name": c.name, "phone": c.phone, "category": c.category, "is_member": c.is_member}


def _paginate(request, rows):
    """Paginate a list or queryset and add count / next / previous like every other list API."""
    pager = ReportPagination()
    page = pager.paginate_queryset(rows, request)
    return pager, page


# ------------------------------------------------- shop portal payments
def _shop_txns(start, end):
    """Shop wallet transactions inside the period.

    A payment is dated by the day it was completed (a payment that is still pending / failed is dated by
    the day it was started), so a top-up never moves between days after the fact.
    """
    return (ShopWalletTransaction.objects
            .annotate(when=Coalesce("completed_at", "created_at"))
            .filter(when__date__range=(start, end))
            .select_related("wallet__shop"))


def _shop_receipts(start, end):
    """Money really received from shops: completed credits (Razorpay payments) on their wallets."""
    return _shop_txns(start, end).filter(kind="credit", status="completed")


def _shop_json(shop):
    # same shape as _customer_json so the report tables can show a shop like any other payer
    return {"id": None, "shop_id": shop.id, "name": shop.name, "phone": shop.phone,
            "category": "Shop Portal", "is_member": False}


def _shop_reference(t):
    return t.reference or f"WT{t.id}"


def _shop_total(start, end):
    return _dec(_shop_receipts(start, end).aggregate(t=Sum("amount"))["t"])


# ------------------------------------------------------- collection events
def _collection_events(start, end):
    """Every payment received in the period as one flat list (newest first).

    type: bill (paid on a bill) | old_due (old dues cleared on a bill) | advance (order advance)
          | shop_wallet (a shop paid money into its Shop Portal wallet)
    """
    events = []
    bills = (Bill.objects.filter(bill_date__range=(start, end))
             .filter(Q(paid_amount__gt=0) | Q(old_due_paid__gt=0)).select_related("customer"))
    for b in bills:
        base = {"date": b.bill_date, "at": b.created_at, "customer": _customer_json(b.customer),
                "mode": b.payment_mode, "reference": b.bill_no, "link": f"/history/{b.id}"}
        if b.paid_amount > 0:
            events.append({**base, "type": "bill", "amount": b.paid_amount})
        if b.old_due_paid > 0:
            events.append({**base, "type": "old_due", "amount": b.old_due_paid})
    for o in _unbilled_advances(start, end).select_related("customer"):
        events.append({"date": o.order_date, "at": o.created_at, "customer": _customer_json(o.customer),
                       "mode": o.advance_mode, "reference": _order_no(o.id), "link": "/orders",
                       "type": "advance", "amount": o.advance_paid})
    for t in _shop_receipts(start, end):
        events.append({"date": localtime(t.when).date(), "at": t.when, "customer": _shop_json(t.wallet.shop),
                       "mode": "online", "reference": _shop_reference(t), "link": "/shop-payments",
                       "type": "shop_wallet", "amount": t.amount})
    events.sort(key=lambda e: (e["date"], e["at"]), reverse=True)
    return events


def _collected_by_day(start, end):
    """{date: amount received that day} - same rules as _collection_events but aggregated in the DB."""
    out = defaultdict(lambda: ZERO)
    for row in (Bill.objects.filter(bill_date__range=(start, end)).order_by()
                .values("bill_date").annotate(paid=Sum("paid_amount"), old=Sum("old_due_paid"))):
        out[row["bill_date"]] += _dec(row["paid"]) + _dec(row["old"])
    for row in (_unbilled_advances(start, end).order_by()
                .values("order_date").annotate(adv=Sum("advance_paid"))):
        out[row["order_date"]] += _dec(row["adv"])
    for t in _shop_receipts(start, end):
        out[localtime(t.when).date()] += t.amount
    return out


# --------------------------------------------------------------- overview
def _chart_series(start, end):
    """Sales and collections per day (periods up to ~2 months) or per month (longer periods)."""
    sales_by_day = {r["bill_date"]: _dec(r["t"]) for r in
                    Bill.objects.filter(bill_date__range=(start, end)).order_by()
                    .values("bill_date").annotate(t=Sum("final_amount"))}
    collected_by_day = _collected_by_day(start, end)

    daily = (end - start).days < DAILY_CHART_MAX_DAYS
    buckets = {}
    day = start
    while day <= end:
        key = day if daily else day.replace(day=1)
        buckets.setdefault(key, {"sales": ZERO, "collected": ZERO})
        buckets[key]["sales"] += sales_by_day.get(day, ZERO)
        buckets[key]["collected"] += collected_by_day.get(day, ZERO)
        day += timedelta(days=1)

    return {
        "mode": "day" if daily else "month",
        "points": [{"date": k.isoformat(),
                    "label": k.strftime("%d %b") if daily else k.strftime("%b %Y"),
                    "sales": v["sales"], "collected": v["collected"]}
                   for k, v in sorted(buckets.items())],
    }


def _sales_by_category(start, end, limit=5):
    """Share of sales per product category (normal or digital). The rest is grouped as 'Other'."""
    rows = (BillItem.objects.filter(bill__bill_date__range=(start, end))
            .annotate(cat=Coalesce("category__name", "digital_category__name",
                                   Value("Other"), output_field=CharField()))
            .order_by().values("cat").annotate(amount=Sum("total")))
    totals = defaultdict(lambda: ZERO)
    for r in rows:
        totals[r["cat"] or "Other"] += _dec(r["amount"])
    other = totals.pop("Other", ZERO)
    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)
    top, rest = ranked[:limit], ranked[limit:]
    other += sum((v for _, v in rest), ZERO)
    items = top + ([("Other", other)] if other > 0 else [])
    grand = sum((v for _, v in items), ZERO)
    return [{"name": name, "amount": amt,
             "percent": round(float(amt / grand * 100), 1) if grand > 0 else 0}
            for name, amt in items if amt > 0]


def _recent_transactions(start, end, limit=8):
    """Latest bills, old-due payments, order advances, membership fees and shop payments of the period, merged."""
    rows = []
    for b in (Bill.objects.filter(bill_date__range=(start, end)).select_related("customer")
              .order_by("-created_at")[:limit]):
        rows.append({"at": b.created_at, "date": b.bill_date, "reference": b.bill_no, "type": "Bill",
                     "customer": b.customer.name, "amount": b.final_amount, "link": f"/history/{b.id}"})
    for b in (Bill.objects.filter(bill_date__range=(start, end), old_due_paid__gt=0)
              .select_related("customer").order_by("-created_at")[:limit]):
        rows.append({"at": b.created_at, "date": b.bill_date, "reference": b.bill_no, "type": "Payment",
                     "customer": b.customer.name, "amount": b.old_due_paid, "link": f"/history/{b.id}"})
    for o in _unbilled_advances(start, end).select_related("customer").order_by("-created_at")[:limit]:
        rows.append({"at": o.created_at, "date": o.order_date, "reference": _order_no(o.id), "type": "Advance",
                     "customer": o.customer.name, "amount": o.advance_paid, "link": "/orders"})
    for m in (MembershipTransaction.objects.filter(created_at__date__range=(start, end))
              .select_related("customer").order_by("-created_at")[:limit]):
        rows.append({"at": m.created_at, "date": localtime(m.created_at).date(), "reference": f"M{m.id}",
                     "type": "Membership", "customer": m.customer.name, "amount": m.amount,
                     "link": "/membership-history"})
    for t in _shop_receipts(start, end).order_by("-when")[:limit]:
        rows.append({"at": t.when, "date": localtime(t.when).date(), "reference": _shop_reference(t),
                     "type": "Shop Payment", "customer": t.wallet.shop.name, "amount": t.amount,
                     "link": "/shop-payments"})
    rows.sort(key=lambda r: r["at"], reverse=True)
    return [{k: v for k, v in r.items() if k != "at"} for r in rows[:limit]]


@api_view(["GET"])
@permission_classes([IsSuperuser])
def reports_overview(request):
    start, end = _period(request.query_params)
    bills = Bill.objects.filter(bill_date__range=(start, end))
    agg = bills.aggregate(sales=Sum("final_amount"), outstanding=Sum("current_due"), discount=Sum("discount"),
                          paid=Sum("paid_amount"), old=Sum("old_due_paid"), count=Count("id"),
                          customers=Count("customer", distinct=True))
    advances = _unbilled_advances(start, end).aggregate(t=Sum("advance_paid"))["t"]
    paid, old, adv = _dec(agg["paid"]), _dec(agg["old"]), _dec(advances)
    shop_in = _shop_total(start, end)

    return Response({
        "period": _period_json(start, end),
        "summary": {
            "sales": _dec(agg["sales"]),
            "collected": paid + old + adv + shop_in,
            "outstanding": _dec(agg["outstanding"]),
            "bills": agg["count"] or 0,
            "customers": agg["customers"] or 0,
            "discount": _dec(agg["discount"]),
            # what "collected" is made of, shown as a hint under the card
            "collected_parts": {"bills": paid, "old_dues": old, "advances": adv, "shop_wallet": shop_in},
        },
        "chart": _chart_series(start, end),
        "by_category": _sales_by_category(start, end),
        "recent": _recent_transactions(start, end),
    })


# ---------------------------------------------------------- sales report
def _sales_rows(qs):
    return [{
        "id": b.id, "bill_no": b.bill_no, "date": b.bill_date, "customer": _customer_json(b.customer),
        "gross_total": b.gross_total, "discount": b.discount, "final_amount": b.final_amount,
        "paid_amount": b.paid_amount, "due": b.current_due,
        "status": b.payment_status, "mode": b.payment_mode,
    } for b in qs]


def _sales_report(request, start, end, paginate=True):
    p = request.query_params
    qs = _bills_in(start, end, p).select_related("customer")
    status = p.get("status")
    if status in ("paid", "partial", "due"):
        qs = qs.filter(payment_status=status)
    q = (p.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(customer__name__icontains=q) | Q(customer__phone__icontains=q) | Q(bill_no__icontains=q))

    agg = qs.aggregate(sales=Sum("final_amount"), discount=Sum("discount"), paid=Sum("paid_amount"),
                       due=Sum("current_due"), bills=Count("id"), customers=Count("customer", distinct=True))
    by_day = list(qs.order_by().values("bill_date").annotate(t=Sum("final_amount")).order_by("-t"))
    top = (qs.order_by().values("customer__name").annotate(t=Sum("final_amount")).order_by("-t").first())
    bills = agg["bills"] or 0
    summary = {
        "sales": _dec(agg["sales"]), "bills": bills, "customers": agg["customers"] or 0,
        "discount": _dec(agg["discount"]), "paid": _dec(agg["paid"]), "outstanding": _dec(agg["due"]),
        "average_bill": (_dec(agg["sales"]) / bills).quantize(Decimal("0.01")) if bills else ZERO,
        "top_customer": {"name": top["customer__name"], "amount": top["t"]} if top else None,
        "highest_day": {"date": by_day[0]["bill_date"], "amount": by_day[0]["t"]} if by_day else None,
        "lowest_day": {"date": by_day[-1]["bill_date"], "amount": by_day[-1]["t"]} if by_day else None,
    }
    qs = qs.order_by("-bill_date", "-bill_number")
    if not paginate:
        return _sales_rows(qs), summary, None
    pager, page = _paginate(request, qs)
    return _sales_rows(page), summary, pager


# ----------------------------------------------------- collection report
COLLECTION_TYPES = ("bill", "old_due", "advance", "shop_wallet")
PAY_MODES = ("cash", "upi", "bank", "online")


def _collections_report(request, start, end, paginate=True):
    p = request.query_params
    events = _collection_events(start, end)
    if p.get("type") in COLLECTION_TYPES:
        events = [e for e in events if e["type"] == p["type"]]
    if p.get("mode") in PAY_MODES:
        events = [e for e in events if e["mode"] == p["mode"]]
    q = (p.get("q") or "").strip().lower()
    if q:
        events = [e for e in events if q in e["customer"]["name"].lower()
                  or q in e["customer"]["phone"] or q in e["reference"].lower()]

    by_mode, by_type = defaultdict(lambda: ZERO), defaultdict(lambda: ZERO)
    for e in events:
        by_mode[e["mode"]] += e["amount"]
        by_type[e["type"]] += e["amount"]
    summary = {
        "total": sum((e["amount"] for e in events), ZERO), "count": len(events),
        "cash": by_mode["cash"], "upi": by_mode["upi"], "bank": by_mode["bank"], "online": by_mode["online"],
        "bill": by_type["bill"], "old_due": by_type["old_due"], "advance": by_type["advance"],
        "shop_wallet": by_type["shop_wallet"],
    }
    rows = [{k: v for k, v in e.items() if k != "at"} for e in events]
    if not paginate:
        return rows, summary, None
    pager, page = _paginate(request, rows)
    return list(page), summary, pager


# ---------------------------------------------------- outstanding report
def _bucket(age_days):
    if age_days is None:
        return "unknown"
    for name, low, high in AGEING_BUCKETS:
        if age_days >= low and (high is None or age_days <= high):
            return name
    return "60+"


def _outstanding_report(request, start, end, paginate=True):
    """Customers who owe money right now (whole shop - the date range does not apply).

    Age = days since the oldest bill that still makes up the customer's due. Customer.due_amount is
    matched against their unpaid bills from the newest backwards (older dues are the ones paid off
    first), so a bill that was cleared later through 'old due' is not counted as unpaid.
    """
    p = request.query_params
    today = timezone.localdate()
    customers = list(Customer.objects.filter(due_amount__gt=0))

    unpaid = defaultdict(list)
    for b in (Bill.objects.filter(customer__in=customers, current_due__gt=0)
              .order_by("-bill_date", "-id").values("customer_id", "bill_date", "current_due")):
        unpaid[b["customer_id"]].append(b)
    last_bill = {r["customer_id"]: r["d"] for r in
                 Bill.objects.filter(customer__in=customers).order_by().values("customer_id")
                 .annotate(d=Max("bill_date"))}

    rows = []
    for c in customers:
        remaining, used, since = c.due_amount, 0, None
        for b in unpaid[c.id]:
            if remaining <= 0:
                break
            remaining -= b["current_due"]
            used += 1
            since = b["bill_date"]
        age = (today - since).days if since else None
        rows.append({"id": c.id, "customer": _customer_json(c), "due_amount": c.due_amount,
                     "unpaid_bills": used, "since": since, "age_days": age, "ageing": _bucket(age),
                     "last_bill": last_bill.get(c.id)})

    # the ageing summary describes everyone who owes; the filters below only narrow the table
    totals = {name: ZERO for name, _, _ in AGEING_BUCKETS}
    totals["unknown"] = ZERO
    for r in rows:
        totals[r["ageing"]] += r["due_amount"]
    summary = {"total_due": sum((r["due_amount"] for r in rows), ZERO), "customers": len(rows),
               "ageing": totals,
               "largest": max(rows, key=lambda r: r["due_amount"])["customer"]["name"] if rows else None}

    category = p.get("category")
    if category in CUSTOMER_CATEGORIES:
        rows = [r for r in rows if r["customer"]["category"] == category]
    bucket = p.get("ageing")
    if bucket in totals:
        rows = [r for r in rows if r["ageing"] == bucket]
    q = (p.get("q") or "").strip().lower()
    if q:
        rows = [r for r in rows if q in r["customer"]["name"].lower() or q in r["customer"]["phone"]]
    rows.sort(key=lambda r: r["due_amount"], reverse=True)

    if not paginate:
        return rows, summary, None
    pager, page = _paginate(request, rows)
    return list(page), summary, pager


# ------------------------------------------------- printing & orders report
ORDER_STATUSES = ("pending", "progress", "completed", "delivered", "cancelled")


def _order_rows(qs, today):
    return [{
        "id": o.id, "order_no": _order_no(o.id), "work_name": o.work_name, "customer": _customer_json(o.customer),
        "order_date": o.order_date, "delivery_date": o.delivery_date, "status": o.status,
        "overdue": o.delivery_date < today and o.status not in ("delivered", "cancelled"),
        "total_amount": o.total_amount, "advance_paid": o.advance_paid, "due_amount": o.due_amount,
        "is_billed": o.is_billed,
    } for o in qs]


def _orders_report(request, start, end, paginate=True):
    p = request.query_params
    today = timezone.localdate()
    base = Order.objects.filter(order_date__range=(start, end)).select_related("customer")

    counts = {r["status"]: r["n"] for r in base.order_by().values("status").annotate(n=Count("id"))}
    agg = base.exclude(status="cancelled").aggregate(value=Sum("total_amount"), advance=Sum("advance_paid"),
                                                     due=Sum("due_amount"))
    overdue = base.filter(delivery_date__lt=today).exclude(status__in=("delivered", "cancelled")).count()

    # most printed jobs of the period (from the bills)
    popular = (BillItem.objects.filter(bill__bill_date__range=(start, end))
               .order_by().values("service_name")
               .annotate(qty=Sum("qty"), bills=Count("bill", distinct=True), revenue=Sum("total"))
               .order_by("-revenue")[:10])
    summary = {
        "orders": sum(counts.values()), "overdue": overdue,
        "status": {s: counts.get(s, 0) for s in ORDER_STATUSES},
        "value": _dec(agg["value"]), "advance": _dec(agg["advance"]), "due": _dec(agg["due"]),
        "popular": [{"name": r["service_name"] or "—", "qty": r["qty"] or 0, "bills": r["bills"],
                     "revenue": _dec(r["revenue"])} for r in popular],
    }

    qs = base
    status = p.get("status")
    if status == "overdue":
        qs = qs.filter(delivery_date__lt=today).exclude(status__in=("delivered", "cancelled"))
    elif status in ORDER_STATUSES:
        qs = qs.filter(status=status)
    q = (p.get("q") or "").strip()
    if q:
        cond = Q(customer__name__icontains=q) | Q(customer__phone__icontains=q) | Q(work_name__icontains=q)
        code = q.lower().lstrip("w")  # "W098" or "98" finds order 98
        if code.isdigit():
            cond |= Q(id=int(code))
        qs = qs.filter(cond)
    qs = qs.order_by("-order_date", "-id")

    if not paginate:
        return _order_rows(qs, today), summary, None
    pager, page = _paginate(request, qs)
    return _order_rows(page, today), summary, pager


# --------------------------------------------------------- customer report
def _customers_report(request, start, end, paginate=True):
    p = request.query_params
    in_range = Q(bill__bill_date__range=(start, end))
    qs = (Customer.objects.filter(in_range)
          .annotate(bills=Count("bill", filter=in_range, distinct=True),
                    purchases=Sum("bill__final_amount", filter=in_range),
                    paid=Sum("bill__paid_amount", filter=in_range),
                    period_due=Sum("bill__current_due", filter=in_range),
                    last_bill=Max("bill__bill_date", filter=in_range)))
    category = p.get("category")
    if category in CUSTOMER_CATEGORIES:
        qs = qs.filter(category=category)
    member_type = p.get("member_type")
    if member_type == "member":
        qs = qs.filter(is_member=True)
    elif member_type == "non_member":
        qs = qs.filter(is_member=False)
    q = (p.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(name__icontains=q) | Q(phone__icontains=q))
    qs = qs.order_by("-purchases", "name")

    today = timezone.localdate()
    # (named differently from the annotations above - an aggregate may not reuse an annotation's name)
    totals = qs.aggregate(grand_total=Sum("purchases"), customer_count=Count("id"))
    renewals = MembershipTransaction.objects.filter(created_at__date__range=(start, end))
    ren = renewals.aggregate(n=Count("id"), amount=Sum("amount"))
    top = qs.first()
    n = totals["customer_count"] or 0
    summary = {
        "customers": n, "purchases": _dec(totals["grand_total"]),
        "average": (_dec(totals["grand_total"]) / n).quantize(Decimal("0.01")) if n else ZERO,
        "new_customers": Customer.objects.filter(created_at__date__range=(start, end)).count(),
        "members": Customer.objects.filter(is_member=True).count(),
        "expiring_soon": Customer.objects.filter(is_member=True,
                                                 expiry_date__range=(today, today + timedelta(days=30))).count(),
        "renewals": ren["n"] or 0, "renewal_amount": _dec(ren["amount"]),
        "top_customer": {"name": top.name, "amount": top.purchases} if top else None,
    }

    def rows_of(items):
        return [{"id": c.id, "customer": _customer_json(c), "bills": c.bills, "purchases": _dec(c.purchases),
                 "paid": _dec(c.paid), "due": _dec(c.period_due), "last_bill": c.last_bill,
                 "expiry_date": c.expiry_date} for c in items]

    if not paginate:
        return rows_of(qs), summary, None
    pager, page = _paginate(request, qs)
    return rows_of(page), summary, pager


# ------------------------------------------------------ shop portal report
def _shop_rows(items):
    return [{"id": i["shop"].id, "shop": {"id": i["shop"].id, "name": i["shop"].name, "phone": i["shop"].phone},
             "received": i["received"], "orders": i["orders"], "spent": i["spent"], "pending": i["pending"],
             "balance": i["balance"], "last_activity": i["last_activity"]} for i in items]


def _shop_report(request, start, end, paginate=True):
    """One row per shop that did something in the period: money paid in, spent on orders, wallet balance."""
    p = request.query_params
    done = Q(status="completed")
    per_shop = (_shop_txns(start, end).order_by().values("wallet__shop_id")
                .annotate(received=Sum("amount", filter=Q(kind="credit") & done),
                          spent=Sum("amount", filter=Q(kind="debit") & done),
                          orders=Count("id", filter=Q(kind="debit") & done),
                          pending=Sum("amount", filter=Q(status="pending")),
                          last=Max("when")))
    stats = {r["wallet__shop_id"]: r for r in per_shop}
    shops = Shop.objects.filter(id__in=stats.keys())
    q = (p.get("q") or "").strip()
    if q:
        shops = shops.filter(Q(name__icontains=q) | Q(phone__icontains=q) | Q(owner_name__icontains=q))
    balances = dict(ShopWallet.objects.filter(shop__in=shops).values_list("shop_id", "balance"))

    items = []
    for shop in shops:
        r = stats[shop.id]
        items.append({"shop": shop, "received": _dec(r["received"]), "spent": _dec(r["spent"]),
                      "orders": r["orders"] or 0, "pending": _dec(r["pending"]), "balance": balances.get(shop.id, ZERO),
                      "last_activity": localtime(r["last"]).date() if r["last"] else None})
    items.sort(key=lambda i: (i["received"], i["spent"]), reverse=True)

    # the cards describe every shop in the period; the search only narrows the table
    totals = _shop_txns(start, end).aggregate(
        received=Sum("amount", filter=Q(kind="credit") & done), spent=Sum("amount", filter=Q(kind="debit") & done),
        orders=Count("id", filter=Q(kind="debit") & done), pending=Sum("amount", filter=Q(status="pending")),
        shops=Count("wallet__shop", distinct=True))
    held = ShopWallet.objects.aggregate(total=Sum("balance"), shops=Count("id", filter=Q(balance__gt=0)))
    summary = {
        "received": _dec(totals["received"]), "spent": _dec(totals["spent"]), "orders": totals["orders"] or 0,
        "pending": _dec(totals["pending"]), "shops": totals["shops"] or 0,
        "balance": _dec(held["total"]), "shops_with_balance": held["shops"] or 0,
    }
    if not paginate:
        return _shop_rows(items), summary, None
    pager, page = _paginate(request, items)
    return _shop_rows(page), summary, pager


BUILDERS = {
    "sales": _sales_report,
    "collections": _collections_report,
    "outstanding": _outstanding_report,
    "orders": _orders_report,
    "customers": _customers_report,
    "shop": _shop_report,
}


@api_view(["GET"])
@permission_classes([IsSuperuser])
def report_detail(request, kind):
    if kind not in BUILDERS:
        return Response({"detail": "Unknown report"}, status=404)
    start, end = _period(request.query_params)
    rows, summary, pager = BUILDERS[kind](request, start, end)
    response = pager.get_paginated_response(rows)
    response.data["summary"] = summary
    response.data["period"] = None if kind == "outstanding" else _period_json(start, end)
    return response


# ---------------------------------------------------------------- exports
def _s(value):
    """Typed text starting with = + - @ would run as a formula in Excel, so it is quoted."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


def _status_label(v):
    return {"paid": "Paid", "partial": "Partial", "due": "Unpaid"}.get(v, v or "")


TYPE_LABEL = {"bill": "Bill payment", "old_due": "Old due payment", "advance": "Order advance",
              "shop_wallet": "Shop wallet payment"}

# (header, value from a row, kind) - kind: text | date | money | int ; money columns get a TOTAL row
EXPORT = {
    "sales": ("Sales Report", [
        ("Bill No", lambda r: r["bill_no"], "text"), ("Date", lambda r: r["date"], "date"),
        ("Customer", lambda r: _s(r["customer"]["name"]), "text"), ("Category", lambda r: r["customer"]["category"], "text"),
        ("Total", lambda r: r["gross_total"], "money"), ("Discount", lambda r: r["discount"], "money"),
        ("Final Amount", lambda r: r["final_amount"], "money"), ("Paid", lambda r: r["paid_amount"], "money"),
        ("Due", lambda r: r["due"], "money"), ("Status", lambda r: _status_label(r["status"]), "text"),
    ]),
    "collections": ("Collection Report", [
        ("Date", lambda r: r["date"], "date"), ("Reference", lambda r: r["reference"], "text"),
        ("Customer", lambda r: _s(r["customer"]["name"]), "text"), ("Type", lambda r: TYPE_LABEL[r["type"]], "text"),
        ("Mode", lambda r: r["mode"].title(), "text"), ("Amount", lambda r: r["amount"], "money"),
    ]),
    "outstanding": ("Outstanding Report", [
        ("Customer", lambda r: _s(r["customer"]["name"]), "text"), ("Phone", lambda r: _s(r["customer"]["phone"]), "text"),
        ("Category", lambda r: r["customer"]["category"], "text"), ("Unpaid Bills", lambda r: r["unpaid_bills"], "int"),
        ("Due Since", lambda r: r["since"], "date"), ("Age (days)", lambda r: r["age_days"], "int"),
        ("Due Amount", lambda r: r["due_amount"], "money"),
    ]),
    "orders": ("Printing & Orders Report", [
        ("Order", lambda r: r["order_no"], "text"), ("Customer", lambda r: _s(r["customer"]["name"]), "text"),
        ("Work", lambda r: _s(r["work_name"]), "text"), ("Order Date", lambda r: r["order_date"], "date"),
        ("Delivery Date", lambda r: r["delivery_date"], "date"),
        ("Status", lambda r: "Overdue" if r["overdue"] else r["status"].title(), "text"),
        ("Total", lambda r: r["total_amount"], "money"), ("Advance", lambda r: r["advance_paid"], "money"),
        ("Due", lambda r: r["due_amount"], "money"),
    ]),
    "shop": ("Shop Portal Report", [
        ("Shop", lambda r: _s(r["shop"]["name"]), "text"), ("Phone", lambda r: _s(r["shop"]["phone"]), "text"),
        ("Wallet Payments Received", lambda r: r["received"], "money"), ("Orders Paid", lambda r: r["orders"], "int"),
        ("Spent on Orders", lambda r: r["spent"], "money"), ("Pending Payments", lambda r: r["pending"], "money"),
        ("Wallet Balance", lambda r: r["balance"], "money"), ("Last Activity", lambda r: r["last_activity"], "date"),
    ]),
    "customers": ("Customer Report", [
        ("Customer", lambda r: _s(r["customer"]["name"]), "text"), ("Phone", lambda r: _s(r["customer"]["phone"]), "text"),
        ("Category", lambda r: r["customer"]["category"], "text"),
        ("Member", lambda r: "Yes" if r["customer"]["is_member"] else "No", "text"),
        ("Bills", lambda r: r["bills"], "int"), ("Purchases", lambda r: r["purchases"], "money"),
        ("Paid", lambda r: r["paid"], "money"), ("Due", lambda r: r["due"], "money"),
        ("Last Bill", lambda r: r["last_bill"], "date"),
    ]),
}


def _export_table(kind, rows):
    title, cols = EXPORT[kind]
    body = [[get(r) for _, get, _ in cols] for r in rows]
    totals = None
    if any(k == "money" for _, _, k in cols):
        totals = ["TOTAL" if i == 0 else ("" if k != "money" else sum((float(row[i] or 0) for row in body), 0.0))
                  for i, (_, _, k) in enumerate(cols)]
    return title, [h for h, _, _ in cols], [k for _, _, k in cols], body, totals


def _period_text(kind, start, end):
    if kind == "outstanding":
        return "Customers with pending dues as of " + timezone.localdate().strftime("%d-%m-%Y")
    return f"From {start.strftime('%d-%m-%Y')} To {end.strftime('%d-%m-%Y')}"


def _export_xlsx(kind, rows, start, end):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter

    title, head, kinds, body, totals = _export_table(kind, rows)
    wb = Workbook()
    ws = wb.active
    ws.title = title[:31]
    width = len(head)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=width)
    ws["A1"] = "STAR OFFSET PRINTING - " + title.upper()
    ws["A1"].font = Font(size=14, bold=True)
    ws["A1"].alignment = Alignment(horizontal="center")
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=width)
    ws["A2"] = _period_text(kind, start, end)
    ws["A2"].alignment = Alignment(horizontal="center")

    ws.append([])
    ws.append(head)
    header_row = ws.max_row
    for c in ws[header_row]:
        c.font = Font(bold=True)
        c.alignment = Alignment(horizontal="center")
    for r in body:
        ws.append(r)
    first, last = header_row + 1, ws.max_row
    for row in ws.iter_rows(min_row=first, max_row=last):
        for cell, k in zip(row, kinds):
            if k == "date":
                cell.number_format = "DD-MM-YYYY"
            elif k == "money":
                cell.number_format = "#,##0.00"
                cell.value = float(cell.value or 0)
    if totals:
        ws.append([])
        ws.append(totals)
        for c in ws[ws.max_row]:
            c.font = Font(bold=True)
            if c.column <= width and kinds[c.column - 1] == "money":
                c.number_format = "#,##0.00"
    for i, h in enumerate(head, 1):
        longest = max([len(h)] + [len(str(r[i - 1])) for r in body if r[i - 1] is not None])
        ws.column_dimensions[get_column_letter(i)].width = min(max(longest + 3, 12), 45)
    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)

    out = BytesIO()
    wb.save(out)
    return out.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _export_pdf(kind, rows, start, end):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import landscape, letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    title, head, kinds, body, totals = _export_table(kind, rows)

    def cell(v, k):
        if v is None or v == "":
            return ""
        if k == "date":
            return v.strftime("%d-%m-%Y")
        if k == "money":
            return "Rs. {:,.2f}".format(float(v))
        return str(v)

    styles = getSampleStyleSheet()
    out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=landscape(letter), leftMargin=24, rightMargin=24,
                            topMargin=28, bottomMargin=28)
    data = [head] + [[cell(v, k) for v, k in zip(r, kinds)] for r in body]
    if totals:
        data.append([cell(v, k) if k == "money" else v for v, k in zip(totals, kinds)])
    table = Table(data, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d1d5db")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 7), ("TOPPADDING", (0, 0), (-1, 0), 7),
    ] + [("ALIGN", (i, 0), (i, -1), "RIGHT") for i, k in enumerate(kinds) if k in ("money", "int")]
    if totals:
        style += [("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"), ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#fef3c7"))]
    table.setStyle(TableStyle(style))
    doc.build([Paragraph(f"<b>STAR OFFSET PRINTING - {title.upper()}</b>", styles["Title"]),
               Paragraph(_period_text(kind, start, end), styles["Normal"]), Spacer(1, 12), table])
    return out.getvalue(), "application/pdf"


@api_view(["GET"])
@permission_classes([IsSuperuser])
def report_export(request, kind):
    if kind not in BUILDERS:
        return Response({"detail": "Unknown report"}, status=404)
    start, end = _period(request.query_params)
    rows, _summary, _pager = BUILDERS[kind](request, start, end, paginate=False)
    rows = list(rows)

    fmt = "pdf" if request.query_params.get("file") == "pdf" else "xlsx"
    content, mime = (_export_pdf if fmt == "pdf" else _export_xlsx)(kind, rows, start, end)
    response = HttpResponse(content, content_type=mime)
    response["Content-Disposition"] = f'attachment; filename="{kind}-report-{start}-to-{end}.{fmt}"'
    return response