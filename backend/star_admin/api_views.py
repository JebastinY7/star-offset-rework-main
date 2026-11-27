"""JSON API used by the React frontend.

The old template views in views.py are untouched and keep working while
pages are migrated one by one.
"""
import csv
import mimetypes
import threading
import time
import uuid
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

import requests

from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.models import User
from django.core.files.base import ContentFile
from django.db import IntegrityError, connection, transaction
from django.db.models import Count, Max, Prefetch, Q, Sum
from django.http import HttpResponse
from django.utils import timezone
from django.utils.timezone import localtime
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.response import Response

from pricing.models import (DeliveryType, DigitalCategory, DigitalGSM, DigitalLamination,
                            DigitalPrice, DigitalProduct, Category, PriceRule, Size, Variant)
from pricing.code_prices import (get_price_rule as get_code_price_rule, get_latest_price_rule,
                                  get_price_rules)

from .billing_service import BillingError, save_bill_core
from .paper_prices import get_paper_rates
from .models import (Bill, Customer, MembershipTransaction, OffersHistory, Order, OrderItem,
                     PointTransaction, Quotation, QuotationItem, Setting, StaffActivity,
                     WhatsappMessage, user_role)
from .serializers import (CustomerSerializer, bill_payload, offer_payload, order_payload,
                          quotation_payload, whatsapp_message_payload)
from .utils import (download_whatsapp_media, format_phone, send_order_complete_message,
                    send_whatsapp_template, send_whatsapp_text)
from .visiting_card_pricing import calculate_visiting_card_price


def user_payload(user):
    return {
        "id": user.id,
        "username": user.username,
        "role": user_role(user),
        "is_superuser": user.is_superuser,
    }


# ---------------------------------------------------------------- auth
@api_view(["GET"])
@permission_classes([AllowAny])
@ensure_csrf_cookie
def csrf(request):
    """Call once on app start so the browser gets the csrftoken cookie."""
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([AllowAny])
def me(request):
    if not request.user.is_authenticated:
        return Response({"user": None})
    return Response({"user": user_payload(request.user)})


@api_view(["POST"])
def logout_view(request):
    logout(request)
    return Response({"ok": True})


# ----------------------------------------------------------- customers
class IsSuperuserForDelete(BasePermission):
    def has_permission(self, request, view):
        if view.action == "destroy":
            return bool(request.user and request.user.is_superuser)
        return bool(request.user and request.user.is_authenticated)


class CustomerPagination(PageNumberPagination):
    page_size = 8
    page_size_query_param = "page_size"
    max_page_size = 100


def membership_state(c, today):
    """-> ("active" | "expired" | "none", days_left or None)"""
    if not c.is_member:
        return "none", None
    if c.expiry_date and c.expiry_date < today:
        return "expired", (c.expiry_date - today).days
    return "active", ((c.expiry_date - today).days if c.expiry_date else None)


class CustomerViewSet(viewsets.ModelViewSet):
    serializer_class = CustomerSerializer
    permission_classes = [IsSuperuserForDelete]
    pagination_class = CustomerPagination

    def get_queryset(self):
        qs = Customer.objects.all().order_by("-id")
        p = self.request.query_params
        today = localtime().date()
        search = p.get("search")
        category = p.get("category")
        user_type = p.get("type")          # old filter: member / non
        membership = p.get("membership")   # active / expired / none
        due = p.get("due")                 # due / clear
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(phone__icontains=search))
        if category and category != "All":
            qs = qs.filter(category=category)
        if user_type == "member":
            qs = qs.filter(is_member=True)
        elif user_type == "non":
            qs = qs.filter(is_member=False)
        if membership == "active":
            qs = qs.filter(is_member=True).filter(Q(expiry_date__isnull=True) | Q(expiry_date__gte=today))
        elif membership == "expired":
            qs = qs.filter(is_member=True, expiry_date__lt=today)
        elif membership == "none":
            qs = qs.filter(is_member=False)
        if due == "due":
            qs = qs.filter(due_amount__gt=0)
        elif due == "clear":
            qs = qs.filter(due_amount__lte=0)
        return qs

    @action(detail=False, methods=["get"])
    def summary(self, request):
        """Numbers for the stat cards on the customers page (whole shop, not just this page)."""
        today = localtime().date()
        C = Customer.objects
        return Response({
            "total": C.count(),
            "active_members": C.filter(is_member=True).filter(
                Q(expiry_date__isnull=True) | Q(expiry_date__gte=today)).count(),
            "shops": C.filter(category="Shop").count(),
            "total_due": C.aggregate(t=Sum("due_amount"))["t"] or 0,
        })

    @action(detail=True, methods=["get"])
    def profile(self, request, pk=None):
        """Everything the customer profile page needs, in one request."""
        c = self.get_object()
        today = localtime().date()
        state, days_left = membership_state(c, today)

        bills = list(Bill.objects.filter(customer=c).order_by("-bill_number", "-id")[:100])
        sums = Bill.objects.filter(customer=c).aggregate(
            billed=Sum("final_amount"), paid=Sum("paid_amount"), old=Sum("old_due_paid"))
        orders = Order.objects.filter(customer=c)
        order_counts = {s: orders.filter(status=s).count()
                        for s in ("pending", "progress", "completed", "delivered", "cancelled")}
        renewals = list(MembershipTransaction.objects.filter(customer=c).order_by("-id")[:20])
        points = list(PointTransaction.objects.filter(customer=c).select_related("bill").order_by("-id")[:20])

        events = []
        for b in bills[:10]:
            events.append((b.created_at, "bill", f"Bill {b.bill_no} created - \u20b9{b.final_amount}"))
        for o in orders.order_by("-id")[:10]:
            events.append((o.created_at, "order", f"Order placed - {o.work_name}"))
        for m in renewals[:10]:
            events.append((m.created_at, "membership", f"Membership {m.type} - \u20b9{m.amount}"))
        for t in points[:10]:
            txt = (f"Earned {t.points_added} points" if t.type == "earn" else f"Used {t.points_used} points")
            events.append((t.date, "points", txt + (f" on {t.bill.bill_no}" if t.bill else "")))
        events.append((c.created_at, "customer", "Customer added"))
        events.sort(key=lambda e: e[0], reverse=True)

        data = CustomerSerializer(c).data
        data["membership_status"] = state
        data["days_left"] = days_left
        return Response({
            "customer": data,
            "totals": {
                "billed": sums["billed"] or 0,
                "paid": (sums["paid"] or 0) + (sums["old"] or 0),
                "outstanding": c.due_amount,
                "points": c.points,
                "bill_count": Bill.objects.filter(customer=c).count(),
            },
            "bills": [{
                "id": b.id, "bill_no": b.bill_no, "bill_date": b.bill_date,
                "final_amount": b.final_amount, "paid_amount": b.paid_amount,
                "old_due_paid": b.old_due_paid, "due_amount": b.due_amount,
                "payment_status": b.payment_status,
            } for b in bills],
            "orders": {
                "counts": order_counts,
                "recent": [{
                    "id": o.id, "work_name": o.work_name, "status": o.status,
                    "total_amount": o.total_amount, "delivery_date": o.delivery_date,
                } for o in orders.order_by("-id")[:5]],
            },
            "renewals": [{
                "id": m.id, "type": m.type, "payment_method": m.payment_method, "amount": m.amount,
                "start_date": m.start_date, "end_date": m.end_date,
            } for m in renewals],
            "points": [{
                "id": t.id, "type": t.type, "points_added": t.points_added, "points_used": t.points_used,
                "bill_no": t.bill.bill_no if t.bill else "", "date": localtime(t.date).isoformat(),
            } for t in points],
            "activity": [{"kind": k, "text": t, "at": localtime(at).isoformat()} for at, k, t in events[:15]],
        })


@api_view(["GET"])
def live_search_customers(request):
    q = request.query_params.get("q", "")
    rows = Customer.objects.filter(Q(name__icontains=q) | Q(phone__startswith=q))[:5]
    return Response({"customers": CustomerSerializer(rows, many=True).data})


# ----------------------------------------------------------- dashboard
@api_view(["GET"])
def dashboard(request):
    today = localtime().date()
    C, B, O = Customer.objects, Bill.objects, Order.objects

    today_bills = B.filter(bill_date=today)
    agg = lambda qs, f: qs.aggregate(t=Sum(f))["t"] or 0

    expiring = C.filter(is_member=True, expiry_date__range=[today, today + timedelta(days=5)])

    def cust(c, **extra):
        return {"id": c.id, "name": c.name, "phone": c.phone, "category": c.category, **extra}

    def last_bill(c):
        b = B.filter(customer=c).order_by("-id").first()
        return {"last_bill_id": b.id, "last_bill_no": b.bill_no} if b else {"last_bill_id": None, "last_bill_no": ""}

    def activity_feed():
        """Latest things that happened, merged from bills / quotations / orders / new customers."""
        events = []
        for b in B.select_related("customer").order_by("-created_at")[:6]:
            events.append((b.created_at, "bill", f"Bill {b.bill_no} created"))
        for q in Quotation.objects.order_by("-created_at")[:6]:
            events.append((q.created_at, "quotation", f"Quotation {q.quotation_no} created"))
        for o in O.order_by("-created_at")[:6]:
            events.append((o.created_at, "order", f"New order - {o.work_name}"))
        for c in C.order_by("-created_at")[:6]:
            events.append((c.created_at, "customer", f"New customer - {c.name}"))
        events.sort(key=lambda e: e[0], reverse=True)
        return [{"kind": k, "text": t, "at": localtime(at).isoformat()} for at, k, t in events[:8]]

    return Response({
        "customers": {
            "total": C.count(),
            "students": C.filter(category="Student").count(),
            "customers": C.filter(category="Customer").count(),
            "shops": C.filter(category="Shop").count(),
            "active_cards": C.filter(is_member=True, expiry_date__gte=today).count(),
            "expired_cards": C.filter(is_member=True, expiry_date__lt=today).count(),
            "no_card": C.filter(is_member=False).count(),
        },
        "today": {
            "sales": agg(today_bills, "final_amount"),
            "bill_count": today_bills.count(),
            "discount": agg(today_bills, "discount"),
            "due": agg(B.filter(bill_date=today, due_amount__gt=0), "due_amount"),
            # old dues customers paid off while billing today
            "collected": agg(today_bills, "old_due_paid"),
        },
        "orders": {
            "pending": O.filter(status="pending").count(),
            "progress": O.filter(status="progress").count(),
            "completed": O.filter(status="completed").count(),
            "delivered": O.filter(status="delivered").count(),
            "overdue": O.filter(delivery_date__lt=today)
                        .exclude(status__in=["delivered", "cancelled"]).count(),
        },
        "recent_bills": [
            {"id": b.id, "bill_no": b.bill_no, "customer": b.customer.name,
             "final_amount": b.final_amount, "bill_date": b.bill_date}
            for b in B.select_related("customer").order_by("-id")[:5]
        ],
        "recent_customers": [cust(c) for c in C.order_by("-id")[:5]],
        "expiring_customers": [
            cust(c, expiry_date=c.expiry_date, days_left=(c.expiry_date - today).days)
            for c in expiring
        ],
        "recent_due_customers": [
            cust(c, due_amount=c.due_amount, **last_bill(c))
            for c in C.filter(due_amount__gt=0).order_by("-due_amount")[:5]
        ],
        "recent_quotations": [
            {"id": q.id, "quotation_no": q.quotation_no, "customer": q.customer_name or "Walk-in",
             "total_amount": q.total_amount}
            for q in Quotation.objects.order_by("-id")[:5]
        ],
        "activity": activity_feed(),
    })


# ------------------------------------------------- billing: price lookups
@api_view(["GET"])
def billing_meta(request):
    return Response({
        "categories": list(Category.objects.values("id", "name")),
        "digital_categories": list(DigitalCategory.objects.values("id", "name")),
        "delivery_types": list(DeliveryType.objects.order_by("display_order", "name").values("id", "name")),
    })


@api_view(["GET"])
def billing_sizes(request):
    cid = request.query_params.get("category_id")
    if not cid or cid == "None":
        return Response({"sizes": []})

    category = Category.objects.filter(pk=cid).first()
    if category and "bill book" in (category.name or "").casefold():
        # Bill Book supports exactly these four sizes. Do not expose legacy or
        # code-rule entries such as A5/2 in the invoice dropdown.
        allowed_sizes = ["A4", "A5", "A6", "LEGAL"]
        for size_name in allowed_sizes:
            Size.objects.get_or_create(category=category, name=size_name)
        sizes = Size.objects.filter(category=category, name__in=allowed_sizes)
        size_order = {name: index for index, name in enumerate(allowed_sizes)}
        return Response({
            "sizes": sorted(
                list(sizes.values("id", "name")),
                key=lambda item: size_order.get(item["name"].upper(), 99),
            )
        })

    sizes = Size.objects.filter(category_id=cid).order_by("id")
    return Response({"sizes": list(sizes.values("id", "name"))})


@api_view(["GET"])
def billing_variants(request):
    sid = request.query_params.get("size_id")
    size = Size.objects.select_related("category").filter(pk=sid).first() if sid else None
    qs = Variant.objects.filter(size_id=sid)

    if size and "bill book" in (size.category.name or "").casefold():
        # Return exactly the two supported duplicate-print choices for the
        # selected Bill Book size. Do not aggregate rules across all sizes:
        # A4/A5 use 50p-30p names, Legal uses 70p-50p names, and A6 has no
        # code-price rows, so it uses the A4-compatible names for the shop
        # formula (which identifies the low option from the word "Low").
        size_name = (size.name or "").strip().casefold()
        prefix = "70p-50p" if size_name == "legal" else "50p-30p"
        canonical_names = (
            f"({prefix}) Print",
            f"({prefix}) Low Print",
        )

        result = []
        for order, canonical_name in enumerate(canonical_names):
            # Reuse one exact size-specific row if it already exists. Older
            # duplicate/legacy variants are deliberately not returned.
            variant_obj = Variant.objects.filter(
                size=size, name__iexact=canonical_name
            ).order_by("id").first()
            if variant_obj is None:
                variant_obj = Variant.objects.create(
                    size=size,
                    name=canonical_name,
                    display_order=order,
                )
            elif variant_obj.display_order != order:
                variant_obj.display_order = order
                variant_obj.save(update_fields=["display_order"])

            result.append({
                "id": variant_obj.id,
                "name": "Dupl. Low Print" if "low" in canonical_name.casefold() else "Dupl. Print",
            })

        return Response({"variants": result})

    qs = qs.order_by("display_order", "name")
    return Response({"variants": list(qs.values("id", "name"))})


@api_view(["GET"])
def billing_price(request):
    p = request.query_params
    empty = {"price": 0, "shop_discount": 0, "cs_discount": 0, "notes": ""}
    if not (p.get("category_id") and p.get("size_id") and p.get("qty") and p.get("variant_id")):
        return Response(empty)
    try:
        qty = int(p["qty"])
    except (ValueError, TypeError):
        return Response(empty)

    category = Category.objects.filter(pk=p["category_id"]).first()
    size = Size.objects.filter(pk=p["size_id"], category=category).first() if category else None
    variant = Variant.objects.filter(pk=p["variant_id"], size=size).first() if size else None
    if not category or not size or not variant:
        return Response(empty)

    rule = get_code_price_rule(category.name, size.name, variant.name, qty)
    latest = rule or get_latest_price_rule(category.name, size.name, variant.name)
    response_data = {
        "price": float(rule.price or 0) if rule else 0,
        "shop_discount": float(latest.shop_discount or 0) if latest else 0,
        "cs_discount": float(latest.cs_discount or 0) if latest else 0,
        "notes": (rule.notes or "") if rule else "",
        # Paper price per sheet (Settings > Paper Price) - the Bill Book / Notice preview uses these
        "paper_rates": get_paper_rates(),
    }

    # Shop customers use the same final, no-discount rates as the Shop Portal,
    # including the client's quantity-slab print rate cards. Regular customers
    # continue to use the existing customer price and discount calculation.
    if (p.get("customer_type") or "").strip().lower() == "shop":
        from .shop_pricing_api import estimate_for, _printing_rate_card_total
        shop_result = estimate_for({
            "kind": "normal",
            "service_id": category.id,
            "size_id": size.id,
            "variant_id": variant.id,
            "qty": qty,
        })
        response_data["shop_available"] = bool(shop_result.get("available"))
        response_data["shop_total"] = shop_result.get("estimate")

        # Return the actual per-sheet rate from the selected quantity slab.
        # Do not derive the displayed rate from the rounded job total.
        raw_rate_card_total = _printing_rate_card_total(
            category.name, size.name, variant.name, qty
        )
        if raw_rate_card_total is not None and qty > 0:
            response_data["shop_rate"] = (
                float(raw_rate_card_total) / qty if raw_rate_card_total > 0 else 0
            )
        elif shop_result.get("available") and qty > 0:
            # Non-rate-card shop services retain their existing effective rate.
            response_data["shop_rate"] = float(shop_result["estimate"]) / qty
        else:
            response_data["shop_rate"] = 0

    return Response(response_data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def billing_visiting_card_price(request):
    p = request.query_params
    try:
        result = calculate_visiting_card_price(
            gsm=p.get("gsm"), size=p.get("size"), qty=p.get("qty"),
            sides=p.get("sides", "single"), price_type=p.get("price_type", "customer"),
            method=p.get("method"), lamination=p.get("lamination", "Without Lamination"), jobs=p.get("jobs", 1),
        )
    except ValueError as exc:
        return Response({"available": False, "error": str(exc)}, status=400)
    return Response(result)


@api_view(["GET"])
def billing_digital_gsm(request):
    cid = request.query_params.get("category_id")
    if not cid or cid == "undefined":
        return Response({"gsms": []})
    return Response({"gsms": list(DigitalGSM.objects.filter(category_id=cid).values("id", "name"))})


@api_view(["GET"])
def billing_digital_products(request):
    gid = request.query_params.get("gsm_id")
    rows = DigitalProduct.objects.filter(gsm_id=gid).distinct()
    return Response({"products": [{"id": r.id, "name": r.name} for r in rows]})


@api_view(["GET"])
def billing_digital_laminations(request):
    pid = request.query_params.get("product_id")
    return Response({"laminations": list(
        DigitalLamination.objects.filter(product_id=pid).distinct().values("id", "name"))})


@api_view(["GET"])
def billing_digital_price(request):
    p = request.query_params
    try:
        qty = int(p.get("qty", 0))
    except ValueError:
        qty = 0
    row = DigitalPrice.objects.filter(
        lamination_id=p.get("lamination_id"), side=p.get("side"),
        delivery_type_id=p.get("delivery_type"), min_qty__lte=qty,
    ).filter(Q(max_qty__gte=qty) | Q(max_qty__isnull=True)).order_by("-min_qty").first()
    if not row:
        return Response({"success": False})
    return Response({
        "success": True,
        "shop_rate": float(row.shop_rate),
        "customer_rate": float(row.customer_rate),
        "customer_discount": float(row.customer_discount),
    })


# ------------------------------------------------------------------ bills
class BillPagination(PageNumberPagination):
    page_size = 9


def _save(request, bill_id=None):
    d = request.data
    try:
        bill = save_bill_core(
            customer_id=d.get("customer_id"),
            items=d.get("items") or [],
            bill_id=bill_id,
            order_id=d.get("order_id"),
            extra_discount=d.get("extra_discount"),
            old_due_payment=d.get("old_due_payment"),
            paid_amount=d.get("paid_amount"),
            payment_mode=d.get("payment_mode"),
        )
    except BillingError as e:
        return Response({"error": str(e)}, status=400)
    except (KeyError, ArithmeticError, ValueError, TypeError) as e:
        return Response({"error": f"Invalid bill data ({e})"}, status=400)
    # bill created from a quotation ("Convert to Bill"): remember which bill it became
    if bill_id is None and str(d.get("quotation_id") or "").isdigit():
        Quotation.objects.filter(pk=int(d["quotation_id"]), converted_bill__isnull=True).update(converted_bill=bill)
    return Response({"id": bill.id, "bill_no": bill.bill_no})


BILL_STATUSES = ("paid", "partial", "due")


def _filter_bills(qs, p, today):
    """Search / payment status / date range filters shared by the bills list, its totals and the Excel export."""
    q = (p.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(customer__name__icontains=q) | Q(customer__phone__icontains=q) | Q(bill_no__icontains=q))

    status = p.get("status")
    if status in BILL_STATUSES:
        qs = qs.filter(payment_status=status)

    rng = p.get("range")
    if rng == "today":
        qs = qs.filter(bill_date=today)
    elif rng == "7d":
        qs = qs.filter(bill_date__range=(today - timedelta(days=6), today))
    elif rng == "30d":
        qs = qs.filter(bill_date__range=(today - timedelta(days=29), today))
    elif rng == "month":
        qs = qs.filter(bill_date__year=today.year, bill_date__month=today.month)
    elif rng == "last_month":
        last = today.replace(day=1) - timedelta(days=1)
        qs = qs.filter(bill_date__year=last.year, bill_date__month=last.month)
    return qs


@api_view(["GET", "POST"])
def bills(request):
    if request.method == "POST":
        return _save(request)

    qs = _filter_bills(Bill.objects.select_related("customer").order_by("-bill_number"),
                       request.query_params, timezone.localdate())
    pager = BillPagination()
    page = pager.paginate_queryset(qs, request)
    response = pager.get_paginated_response([bill_payload(b) for b in page])

    # totals follow the search / date filters, but not the status filter (so the cards never hide
    # the other statuses while one status tab is selected)
    p = request.query_params.copy()
    p["status"] = ""
    sums = _filter_bills(Bill.objects.all(), p, timezone.localdate()).aggregate(
        total=Count("id"), billed=Sum("final_amount"), received=Sum("paid_amount"), outstanding=Sum("current_due"))
    response.data["summary"] = {
        "total": sums["total"] or 0,
        "billed": sums["billed"] or 0,
        "received": sums["received"] or 0,
        "outstanding": sums["outstanding"] or 0,
    }
    return response


@api_view(["GET"])
def order_history(request):
    """Bills that were generated from an order (old /order-history/ page), newest first."""
    today = timezone.localdate()
    p = request.query_params.copy()
    q = (p.pop("q", [""])[0] or "").strip()
    qs = _filter_bills(Bill.objects.filter(order__isnull=False).select_related("customer", "order").order_by("-id"), p, today)
    if q:
        cond = (Q(customer__name__icontains=q) | Q(customer__phone__icontains=q)
                | Q(order__work_name__icontains=q) | Q(bill_no__icontains=q))
        code = q.lower().lstrip("w")  # "W098" or "98" finds order 98
        if code.isdigit():
            cond |= Q(order_id=int(code))
        qs = qs.filter(cond)

    pager = BillPagination()
    page = pager.paginate_queryset(qs, request)
    rows = []
    for b in page:
        row = bill_payload(b)
        row.update({"order_id": b.order_id, "order_no": "W" + str(b.order_id).zfill(3),
                    "work_name": b.order.work_name, "order_status": b.order.status})
        rows.append(row)
    response = pager.get_paginated_response(rows)

    sums = qs.aggregate(total=Count("id"), billed=Sum("final_amount"), received=Sum("paid_amount"),
                        outstanding=Sum("current_due"))
    response.data["summary"] = {k: sums[k] or 0 for k in ("total", "billed", "received", "outstanding")}
    return response


@api_view(["GET"])
def bills_export(request):
    """Excel file with every bill matching the current filters (all pages)."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter

    qs = _filter_bills(Bill.objects.select_related("customer").order_by("-bill_number"),
                       request.query_params, timezone.localdate())
    wb = Workbook()
    ws = wb.active
    ws.title = "Bills"
    head = ["Bill No", "Customer", "Phone", "Date", "Subtotal", "Discount", "Final Amount", "Paid", "Due", "Payment Mode", "Status"]
    ws.append(head)
    for c in ws[1]:
        c.font = Font(bold=True)
        c.alignment = Alignment(horizontal="center")
    labels = {"paid": "Paid", "partial": "Partial", "due": "Unpaid"}
    for b in qs:
        ws.append([
            b.bill_no, _csv_cell(b.customer.name), _csv_cell(b.customer.phone), b.bill_date,
            float(b.gross_total), float(b.discount), float(b.final_amount), float(b.paid_amount),
            float(b.current_due), b.payment_mode.title(), labels.get(b.payment_status, b.payment_status),
        ])
    for row in ws.iter_rows(min_row=2):
        row[3].number_format = "DD-MM-YYYY"
    for i, h in enumerate(head, 1):
        ws.column_dimensions[get_column_letter(i)].width = max(len(h) + 4, 14)
    ws.freeze_panes = "A2"

    response = HttpResponse(content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    response["Content-Disposition"] = 'attachment; filename="bills.xlsx"'
    wb.save(response)
    return response


def _inr(value):
    return "Rs. {:,.2f}".format(float(value or 0))


@api_view(["GET"])
def bill_pdf(request, pk):
    """The bill as a downloadable PDF (same content as the printed invoice)."""
    from io import BytesIO

    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from xml.sax.saxutils import escape

    bill = Bill.objects.select_related("customer").filter(pk=pk).first()
    if bill is None:
        return Response({"detail": "Not found"}, status=404)

    styles = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=9, leading=12)
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm, title=f"Bill {bill.bill_no}")
    gold = colors.HexColor("#c49b2c")

    story = [
        Paragraph("<b>INVOICE / CASH BILL</b>", ParagraphStyle("t", parent=styles["Heading3"], alignment=1)),
        Paragraph("<b>Star Offset Printing</b>", styles["Title"]),
        Paragraph("1/116, Puthanchanthai Jn, Maruthancode Post, K.K District - 629163", small),
        Paragraph("Phone: +91 9488634058 &nbsp;|&nbsp; staroffsets@gmail.com", small),
        Spacer(1, 8),
    ]
    info = Table([
        [Paragraph(f"<b>Bill No:</b> {escape(bill.bill_no)}", small), Paragraph(f"<b>Name:</b> {escape(bill.customer.name)}", small)],
        [Paragraph(f"<b>Date:</b> {bill.bill_date.strftime('%d-%m-%Y')}", small), Paragraph(f"<b>Phone:</b> {escape(bill.customer.phone)}", small)],
    ], colWidths=[90 * mm, 90 * mm])
    info.setStyle(TableStyle([("LINEBELOW", (0, 1), (-1, 1), 1, gold), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story += [info, Spacer(1, 8)]

    rows = [["S.No", "Service", "Qty", "Price", "Discount", "Extra", "Total"]]
    for n, i in enumerate(bill.billitem_set.order_by("id"), 1):
        name = escape(i.service_name) + (f"<br/><font size=7>Extra: {escape(i.extra_purpose)}</font>" if i.extra_purpose else "")
        rows.append([str(n), Paragraph(name, small), str(i.qty), f"{float(i.price):,.2f}",
                     f"{float(i.discount):,.2f}" if i.discount > 0 else "-",
                     f"{float(i.extra_charge):,.2f}" if i.extra_charge > 0 else "-", f"{float(i.total):,.2f}"])
    items = Table(rows, colWidths=[12 * mm, 70 * mm, 14 * mm, 25 * mm, 22 * mm, 20 * mm, 25 * mm], repeatRows=1)
    items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")), ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#d1d5db")),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story += [items, Spacer(1, 10)]

    sums = []
    if bill.discount > 0 or bill.extra_charge_total > 0:
        sums.append(("Gross Total", bill.gross_total))
    if bill.discount > 0:
        sums.append(("Discount", bill.discount))
    if bill.extra_charge_total > 0:
        sums.append(("Extra Charge", bill.extra_charge_total))
    sums += [("Net Total", bill.total_amount), ("Final Amount", bill.final_amount), ("Paid Amount", bill.paid_amount)]
    if bill.current_due > 0:
        sums.append(("Due (This Bill)", bill.current_due))
    if bill.previous_due > 0:
        sums.append(("Previous Due", bill.previous_due))
    if bill.old_due_paid > 0:
        sums.append(("Old Due Paid", bill.old_due_paid))
    if bill.due_amount > 0 and bill.due_amount != bill.current_due:
        sums.append(("Total Due", bill.due_amount))
    summary = Table([[k, _inr(v)] for k, v in sums], colWidths=[40 * mm, 35 * mm], hAlign="RIGHT")
    summary.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                                 ("LINEABOVE", (0, 0), (-1, 0), 0.5, colors.grey)]))
    story += [summary, Spacer(1, 6),
              Paragraph(f"<b>Status:</b> {'Unpaid' if bill.payment_status == 'due' else bill.payment_status.title()}"
                        + (f" &nbsp;|&nbsp; <b>Payment Mode:</b> {bill.payment_mode.title()}" if bill.payment_mode != "credit" else ""), small),
              Spacer(1, 30), Paragraph("Customer Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;For <b>STAR OFFSET PRINTING</b>", small)]
    doc.build(story)

    response = HttpResponse(buf.getvalue(), content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="Bill-{bill.bill_no}.pdf"'
    return response


@api_view(["GET", "PUT", "DELETE"])
def bill_detail(request, pk):
    try:
        bill = Bill.objects.select_related("customer").get(pk=pk)
    except Bill.DoesNotExist:
        return Response({"detail": "Not found"}, status=404)

    if request.method == "GET":
        return Response(bill_payload(bill, with_items=True))

    # editing / deleting bills is admin-only (same as the old history screen)
    if not request.user.is_superuser:
        return Response({"detail": "Only admin can do this"}, status=403)
    if request.method == "DELETE":
        bill.delete()
        return Response(status=204)
    return _save(request, bill_id=bill.id)


# ----------------------------------------------------------------- orders
ORDER_STATUS_FLOW = {"pending": "progress", "progress": "completed", "completed": "delivered"}
ORDER_FORM_STATUSES = ("pending", "progress", "completed", "delivered")


class OrderPagination(PageNumberPagination):
    page_size = 7


def _orders_queryset():
    """Orders with customer + items loaded in 3 queries (no N+1 in the list)."""
    items = OrderItem.objects.select_related(
        "category", "size", "variant", "digital_category", "digital_gsm",
        "digital_product", "digital_lamination", "delivery_type",
    ).order_by("id")
    return Order.objects.select_related("customer").prefetch_related(Prefetch("items", queryset=items))


def _order_lines(raw_items, customer=None):
    """Request items -> unsaved OrderItem rows. Visiting-card rates are recalculated server-side."""
    lines = []
    for it in raw_items:
        qty = int(Decimal(str(it.get("qty") or 0)))
        if qty <= 0:
            raise ValueError("Quantity must be more than 0")

        visiting_price = None
        if it.get("billingType") == "visiting":
            visiting = it.get("visitingCard") or {}
            visiting_price = calculate_visiting_card_price(
                gsm=visiting.get("gsm"), size=visiting.get("size"), qty=qty,
                sides=visiting.get("sides", "single"),
                price_type="shop" if (getattr(customer, "category", "") or "").lower() == "shop" else "customer",
                method=visiting.get("method"),
                lamination=visiting.get("lamination", "Without Lamination"), jobs=it.get("job", visiting.get("jobs", 1)),
            )
            line = OrderItem(
                billing_type="normal", work_type="visiting_card", specifications=visiting,
            )
        elif it.get("billingType") == "digital":
            line = OrderItem(
                billing_type="digital",
                digital_category_id=it.get("categoryId") or None,
                digital_gsm_id=it.get("sizeId") or None,
                digital_product_id=it.get("variantId") or None,
                digital_lamination_id=it.get("laminationId") or None,
                delivery_type_id=it.get("deliveryTypeId") or None,
                side=it.get("side") or "",
                side_name=it.get("sideName") or "",
                customer_type=it.get("customerType") or "",
            )
        else:
            line = OrderItem(
                billing_type="normal",
                category_id=it.get("categoryId") or None,
                size_id=it.get("sizeId") or None,
                variant_id=it.get("variantId") or None,
            )
        line.qty = qty
        line.job = int(it.get("job") or 1)
        if visiting_price:
            line.price = Decimal(visiting_price["unit_price"])
            line.total = Decimal(visiting_price["total"])
        else:
            line.price = Decimal(str(it.get("price") or 0))
            line.total = Decimal(str(it.get("total") or 0))
        lines.append(line)
    return lines


def _save_order(request, order=None):
    """Create (order=None) or update an order together with its items."""
    d = request.data

    try:
        customer = Customer.objects.get(id=d.get("customer_id"))
    except (Customer.DoesNotExist, ValueError, TypeError):
        return Response({"error": "Please select a customer"}, status=400)

    work_name = (d.get("work_name") or "").strip()
    if not work_name:
        return Response({"error": "Work name is required"}, status=400)

    try:
        order_date = date.fromisoformat(str(d.get("order_date")))
    except ValueError:
        return Response({"error": "Please select order date"}, status=400)
    try:
        delivery_date = date.fromisoformat(str(d.get("delivery_date")))
    except ValueError:
        return Response({"error": "Please select delivery date"}, status=400)
    if delivery_date < order_date:
        return Response({"error": "Delivery date cannot be before the order date"}, status=400)

    allowed = ORDER_FORM_STATUSES + (("cancelled",) if order else ())
    status = d.get("status") or "pending"
    if status not in allowed:
        return Response({"error": "Invalid status"}, status=400)

    try:
        lines = _order_lines(d.get("items") or [], customer=customer)
        advance = Decimal(str(d.get("advance_paid") or 0))
    except (ArithmeticError, ValueError, TypeError) as e:
        return Response({"error": f"Invalid order data ({e})"}, status=400)
    if not lines:
        return Response({"error": "Add at least one item"}, status=400)

    # total comes from the items, never from the browser
    total = sum((l.total for l in lines), Decimal("0"))
    advance = min(max(advance, Decimal("0")), total)

    advance_mode = str(d.get("advance_mode") or "cash").lower()
    if advance_mode not in ("cash", "upi", "bank"):
        advance_mode = "cash"
    advance_reference = (str(d.get("advance_reference") or "").strip()[:100]) if advance > 0 else ""

    with transaction.atomic():
        if order is None:
            order = Order()
        order.customer = customer
        order.work_name = work_name
        order.notes = d.get("notes") or ""
        order.order_date = order_date
        order.delivery_date = delivery_date
        order.total_amount = total
        order.advance_paid = advance
        order.advance_mode = advance_mode
        order.advance_reference = advance_reference
        order.due_amount = total - advance
        order.status = status
        order.save()

        order.items.all().delete()
        for line in lines:
            line.order = order
        OrderItem.objects.bulk_create(lines)

    return Response({"id": order.id})


def _filter_orders(qs, p, today):
    """Search / status / delivery-date filters shared by the orders list and the CSV export."""
    q = (p.get("q") or "").strip()
    if q:
        cond = Q(customer__name__icontains=q) | Q(customer__phone__icontains=q) | Q(work_name__icontains=q)
        code = q.lower().lstrip("w")  # "W098" or "98" finds order 98
        if code.isdigit():
            cond |= Q(id=int(code))
        qs = qs.filter(cond)

    status = p.get("status")
    if status == "overdue":
        qs = qs.filter(delivery_date__lt=today).exclude(status__in=["delivered", "cancelled"])
    elif status:
        qs = qs.filter(status=status)

    delivery = p.get("delivery")
    if delivery == "today":
        qs = qs.filter(delivery_date=today)
    elif delivery == "tomorrow":
        qs = qs.filter(delivery_date=today + timedelta(days=1))
    elif delivery == "week":
        qs = qs.filter(delivery_date__range=(today, today + timedelta(days=7)))
    return qs


@api_view(["GET", "POST"])
def orders(request):
    if request.method == "POST":
        return _save_order(request)

    p = request.query_params
    today = timezone.localdate()
    qs = _orders_queryset().order_by("-id")

    qs = _filter_orders(qs, p, today)

    pager = OrderPagination()
    page = pager.paginate_queryset(qs, request)
    response = pager.get_paginated_response([order_payload(o) for o in page])

    response.data["summary"] = {
        "total": Order.objects.count(),
        "pending": Order.objects.filter(status="pending").count(),
        "progress": Order.objects.filter(status="progress").count(),
        "completed": Order.objects.filter(status="completed").count(),
        "overdue": Order.objects.filter(delivery_date__lt=today)
                        .exclude(status__in=["delivered", "cancelled"]).count(),
    }
    return response


def _csv_cell(value):
    """Typed text starting with = + - @ would run as a formula in Excel, so it is quoted."""
    s = "" if value is None else str(value)
    return "'" + s if s[:1] in ("=", "+", "-", "@") else s


@api_view(["GET"])
def orders_export(request):
    """CSV of every order matching the current filters (all pages)."""
    qs = _filter_orders(_orders_queryset().order_by("-id"), request.query_params, timezone.localdate())

    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = 'attachment; filename="orders.csv"'
    writer = csv.writer(response)
    writer.writerow(["Order ID", "Customer", "Mobile", "Work", "Order Date", "Delivery Date", "Status",
                     "Total", "Advance", "Advance Mode", "Reference", "Due", "Billed"])
    for o in qs:
        writer.writerow([
            "W" + str(o.id).zfill(3), _csv_cell(o.customer.name), _csv_cell(o.customer.phone), _csv_cell(o.work_name),
            o.order_date.isoformat(), o.delivery_date.isoformat(), o.status,
            o.total_amount, o.advance_paid, o.advance_mode, _csv_cell(o.advance_reference), o.due_amount,
            "Yes" if o.is_billed else "No",
        ])
    return response


@api_view(["GET", "PUT", "DELETE"])
def order_detail(request, pk):
    order = _orders_queryset().filter(pk=pk).first()
    if order is None:
        return Response({"detail": "Not found"}, status=404)

    if request.method == "GET":
        return Response(order_payload(order))

    # editing / deleting orders is admin-only (same as the old orders screen)
    if not request.user.is_superuser:
        return Response({"detail": "Only admin can do this"}, status=403)
    if request.method == "DELETE":
        order.delete()
        return Response(status=204)
    return _save_order(request, order)


@api_view(["POST"])
def order_status(request, pk):
    """Move an order one step forward: pending -> progress -> completed -> delivered."""
    order = Order.objects.filter(pk=pk).first()
    if order is None:
        return Response({"detail": "Not found"}, status=404)

    new_status = request.data.get("status")
    if ORDER_STATUS_FLOW.get(order.status) != new_status:
        return Response({"error": "This order cannot move to that status"}, status=400)

    order.status = new_status
    order.save(update_fields=["status"])
    return Response({"id": order.id, "status": order.status})


@api_view(["POST"])
def order_cancel(request, pk):
    if not request.user.is_superuser:
        return Response({"detail": "Only admin can do this"}, status=403)

    order = Order.objects.filter(pk=pk).first()
    if order is None:
        return Response({"detail": "Not found"}, status=404)
    if order.is_billed:
        return Response({"error": "A billed order cannot be cancelled"}, status=400)

    order.status = "cancelled"
    order.save(update_fields=["status"])
    return Response({"id": order.id, "status": order.status})


@api_view(["POST"])
def order_whatsapp(request, pk):
    """Send the 'order completed' WhatsApp template (old send_order_whatsapp view)."""
    order = Order.objects.select_related("customer").filter(pk=pk).first()
    if order is None:
        return Response({"detail": "Not found"}, status=404)

    try:
        result = send_order_complete_message(order)
    except (requests.RequestException, ValueError) as e:
        return Response({"error": f"Could not reach WhatsApp: {e}"}, status=502)

    if not result.get("messages"):
        error_msg = result.get("error", {}).get("message", "Unknown error")
        return Response({"error": f"Failed to send WhatsApp: {error_msg}"}, status=400)

    WhatsappMessage.objects.create(
        direction="out",
        phone=format_phone(order.customer.phone),
        customer=order.customer,
        message_type="template",
        body=f"Order completed notification sent for: {order.work_name}",
        wa_message_id=result["messages"][0].get("id"),
        is_read=True,
        raw_payload=result,
    )
    return Response({"message": f"WhatsApp message sent to {order.customer.name}"})


# ------------------------------------------------------------- quotations
# A quotation is a price estimate for a (not necessarily registered) person:
# plain name + phone, no customer record, no payments. Same item shapes as orders,
# plus "manual" (OTHERS) lines with a typed name and a typed price.
class QuotationPagination(PageNumberPagination):
    page_size = 7


def _quote_money(value):
    """Request number -> Decimal with 2 places. Raises ValueError / ArithmeticError on junk."""
    amount = Decimal(str(value or 0)).quantize(Decimal("0.01"))
    if amount < 0:
        raise ValueError("Amounts cannot be negative")
    return amount


def _quotation_lines(raw_items):
    """Request items -> unsaved QuotationItem rows. Raises ValueError on bad data."""
    lines = []
    for it in raw_items:
        qty = int(Decimal(str(it.get("qty") or 0)))
        if qty <= 0:
            raise ValueError("Quantity must be more than 0")
        kind = it.get("billingType")

        if kind == "visiting":
            vc = it.get("visitingCard") if isinstance(it.get("visitingCard"), dict) else {}
            if not vc:
                raise ValueError("Visiting Card specifications are missing")
            line = QuotationItem(billing_type="normal", work_type="visiting_card", specifications=vc,
                                 customer_type=str(vc.get("priceType") or "customer")[:20])
        elif kind == "manual":
            name = (it.get("name") or "").strip()
            if not name:
                raise ValueError("Manual items need a name")
            line = QuotationItem(billing_type="normal", manual_name=name[:255])
        elif kind == "digital":
            line = QuotationItem(
                billing_type="digital",
                digital_category_id=it.get("categoryId") or None,
                digital_gsm_id=it.get("sizeId") or None,
                digital_product_id=it.get("variantId") or None,
                digital_lamination_id=it.get("laminationId") or None,
                work_type=str(it.get("deliveryTypeId") or "")[:50],  # delivery type id, as text
                side=(it.get("side") or "")[:20],
                side_name=(it.get("sideName") or "")[:50],
                customer_type=(it.get("customerType") or "")[:20],
            )
        else:
            line = QuotationItem(
                billing_type="normal",
                category_id=it.get("categoryId") or None,
                size_id=it.get("sizeId") or None,
                variant_id=it.get("variantId") or None,
            )
        line.qty = qty
        line.job = max(int(Decimal(str(it.get("job") or 1))), 1)
        line.price = _quote_money(it.get("price"))
        line.total = _quote_money(it.get("total"))
        if kind == "visiting":
            price_result = calculate_visiting_card_price(
                gsm=vc.get("gsm"), size=vc.get("size"), qty=qty,
                sides=vc.get("sides", "single"), price_type=vc.get("priceType", "customer"),
                method=vc.get("method"), lamination=vc.get("lamination", "Without Lamination"), jobs=it.get("job", vc.get("jobs", 1)),
            )
            line.price = Decimal(price_result["unit_price"])
            line.total = Decimal(price_result["total"])
        lines.append(line)
    return lines


def _save_quotation(request, quotation=None):
    """Create (quotation=None) or update a quotation together with its items."""
    d = request.data

    customer_name = (d.get("customer_name") or "").strip()
    customer_phone = (d.get("customer_phone") or "").strip()
    work_name = (d.get("work_name") or "").strip()
    # name and mobile are both optional: most quotations never turn into an order
    if len(customer_name) > 100:
        return Response({"error": "Customer name is too long (max 100 characters)"}, status=400)
    if len(customer_phone) > 15:
        return Response({"error": "Mobile number is too long (max 15 characters)"}, status=400)
    if not work_name:
        return Response({"error": "Work name is required"}, status=400)
    if len(work_name) > 200:
        return Response({"error": "Work name is too long (max 200 characters)"}, status=400)

    try:
        quotation_date = date.fromisoformat(str(d.get("quotation_date")))
    except ValueError:
        return Response({"error": "Please select the quotation date"}, status=400)
    valid_until = None
    if d.get("valid_until"):
        try:
            valid_until = date.fromisoformat(str(d.get("valid_until")))
        except ValueError:
            return Response({"error": "Invalid 'valid until' date"}, status=400)
        if valid_until < quotation_date:
            return Response({"error": "'Valid until' cannot be before the quotation date"}, status=400)

    try:
        lines = _quotation_lines(d.get("items") or [])
    except (ArithmeticError, ValueError, TypeError) as e:
        return Response({"error": f"Invalid quotation data ({e})"}, status=400)
    if not lines:
        return Response({"error": "Add at least one item"}, status=400)

    # total comes from the items (+ extra charges - discount), never from the browser
    try:
        discount = _quote_money(d.get("discount"))
        extra_charge = _quote_money(d.get("extra_charge"))
    except (ArithmeticError, ValueError, TypeError):
        return Response({"error": "Invalid discount or extra charge"}, status=400)
    subtotal = sum((l.total for l in lines), Decimal("0"))
    if discount > subtotal:
        return Response({"error": "Discount cannot be more than the items total"}, status=400)
    total = subtotal - discount + extra_charge
    if total >= Decimal("100000000"):  # total_amount is DecimalField(max_digits=10, decimal_places=2)
        return Response({"error": "Quotation total is too large"}, status=400)

    creating = quotation is None
    try:
        with transaction.atomic():
            if creating:
                # unique placeholder, replaced by Q<id> below once the row has an id
                quotation = Quotation(quotation_no=f"TMP{uuid.uuid4().hex[:12]}")
            quotation.customer_name = customer_name
            quotation.customer_phone = customer_phone
            quotation.work_name = work_name
            quotation.quotation_date = quotation_date
            quotation.valid_until = valid_until
            quotation.notes = (d.get("notes") or "").strip()
            quotation.terms = (d.get("terms") or "").strip()
            quotation.discount = discount
            quotation.extra_charge = extra_charge
            quotation.total_amount = total
            quotation.save()
            if creating:
                quotation.quotation_no = f"Q{quotation.id:04d}"
                quotation.save(update_fields=["quotation_no"])

            quotation.items.all().delete()
            for line in lines:
                line.quotation = quotation
            QuotationItem.objects.bulk_create(lines)
    except IntegrityError:
        # a category / size / variant picked in the form was deleted in the meantime
        return Response({"error": "One of the selected items no longer exists. Please re-add it."}, status=400)

    return Response({"id": quotation.id})


@api_view(["GET", "POST"])
def quotations(request):
    if request.method == "POST":
        return _save_quotation(request)

    p = request.query_params
    today = timezone.localdate()
    qs = Quotation.objects.select_related("converted_bill").order_by("-id")
    q = (p.get("q") or "").strip()
    if q:
        qs = qs.filter(
            Q(customer_name__icontains=q) | Q(customer_phone__icontains=q) | Q(work_name__icontains=q)
            | Q(quotation_no__icontains=q)
        )
    if p.get("billed") == "yes":
        qs = qs.filter(converted_bill__isnull=False)
    elif p.get("billed") == "no":
        qs = qs.filter(converted_bill__isnull=True)
    if p.get("validity") == "valid":
        qs = qs.filter(Q(valid_until__isnull=True) | Q(valid_until__gte=today))
    elif p.get("validity") == "expired":
        qs = qs.filter(valid_until__lt=today)
    for key, lookup in (("date_from", "quotation_date__gte"), ("date_to", "quotation_date__lte")):
        if p.get(key):
            try:
                qs = qs.filter(**{lookup: date.fromisoformat(p.get(key))})
            except ValueError:
                pass

    pager = QuotationPagination()
    page = pager.paginate_queryset(qs, request)
    response = pager.get_paginated_response([quotation_payload(x) for x in page])

    everything = Quotation.objects.all()
    response.data["summary"] = {
        "total": everything.count(),
        "this_month": everything.filter(quotation_date__year=today.year, quotation_date__month=today.month).count(),
        "amount": float(everything.aggregate(s=Sum("total_amount"))["s"] or 0),
        "billed": everything.filter(converted_bill__isnull=False).count(),
    }
    return response


@api_view(["GET", "PUT", "DELETE"])
def quotation_detail(request, pk):
    quotation = Quotation.objects.filter(pk=pk).first()
    if quotation is None:
        return Response({"detail": "Not found"}, status=404)

    if request.method == "GET":
        return Response(quotation_payload(quotation, with_items=True))

    # editing / deleting quotations is admin-only (same as the old quotations screen)
    if not request.user.is_superuser:
        return Response({"detail": "Only admin can do this"}, status=403)
    if request.method == "DELETE":
        quotation.delete()
        return Response(status=204)
    return _save_quotation(request, quotation)


# ------------------------------------------------- messages (WhatsApp inbox)
# Inbox = one row per phone number. Chat = the full thread + send a text reply.
# The /webhook/ view that stores incoming messages is untouched.
class ConversationPagination(PageNumberPagination):
    page_size = 25


def _unread_conversations():
    """Phones with at least one unread incoming message (used for the sidebar badge)."""
    # order_by() clears the model's default ordering, otherwise created_at leaks into
    # SELECT DISTINCT and every message counts as its own phone.
    return (WhatsappMessage.objects.filter(direction="in", is_read=False)
            .order_by().values("phone").distinct().count())


@api_view(["GET"])
def whatsapp_unread(request):
    return Response({"count": _unread_conversations()})


@api_view(["GET"])
def whatsapp_conversations(request):
    q = (request.query_params.get("q") or "").strip()

    base = WhatsappMessage.objects.all()
    if q:
        # a conversation matches if its phone, customer name or ANY message text matches
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
        .order_by("-last_time", "-last_id")
    )

    pager = ConversationPagination()
    page = pager.paginate_queryset(groups, request)

    # one query for all the "last message" rows on this page
    last = WhatsappMessage.objects.select_related("customer").in_bulk([g["last_id"] for g in page])
    rows = []
    for g in page:
        m = last[g["last_id"]]
        rows.append({
            "phone": g["phone"],
            "customer_name": m.customer.name if m.customer else None,
            "unread": g["unread"],
            "last_message": whatsapp_message_payload(m),
        })

    response = pager.get_paginated_response(rows)
    response.data["unread_conversations"] = _unread_conversations()
    return response


MEDIA_TYPES = ("image", "document", "video", "audio", "sticker")


def _repair_whatsapp_media(messages):
    """Old messages may have a media id in raw_payload but no saved file. Try to download them
    now (same logic as the old chat view). Only runs when a chat is first opened."""
    for m in messages:
        if m.message_type not in MEDIA_TYPES or m.media:
            continue
        try:
            media_id = ((m.raw_payload or {}).get(m.message_type) or {}).get("id")
            if not media_id:
                continue

            media_bytes, mime = download_whatsapp_media(media_id)
            if not media_bytes:
                continue

            if not m.media_mime_type and mime:
                m.media_mime_type = mime

            if m.media_filename and "." in m.media_filename:
                filename = m.media_filename
            else:
                ext = (mimetypes.guess_extension(mime or "") or "").lstrip(".")
                filename = f"{media_id}.{ext or 'bin'}"

            m.media.save(filename, ContentFile(media_bytes), save=False)
            m.save(update_fields=["media", "media_mime_type"])
        except Exception as e:  # one bad file must not break the whole chat
            print(f"[MEDIA RETRY ERROR] message={m.id}: {e}")


@api_view(["GET", "POST"])
def whatsapp_chat(request, phone):
    """GET  -> the thread (oldest first) and marks the customer's messages as read.
               ?after=<id> returns only newer messages (the page polls with this).
       POST -> send a free-text reply {message}."""
    phone = str(phone).strip()
    customer = Customer.objects.filter(phone__endswith=phone[-10:]).first()

    if request.method == "POST":
        text = (request.data.get("message") or "").strip()
        if not text:
            return Response({"error": "Type a message first"}, status=400)

        try:
            result = send_whatsapp_text(phone, text)
        except (requests.RequestException, ValueError) as e:
            return Response({"error": f"Could not reach WhatsApp: {e}"}, status=502)

        if not result.get("messages"):
            error_msg = result.get("error", {}).get("message", "Unknown error")
            return Response({"error": f"Failed to send: {error_msg}"}, status=400)

        msg = WhatsappMessage.objects.create(
            direction="out",
            phone=phone,
            customer=customer,
            message_type="text",
            body=text,
            wa_message_id=result["messages"][0].get("id"),
            is_read=True,
        )
        return Response(whatsapp_message_payload(msg), status=201)

    thread = WhatsappMessage.objects.filter(phone=phone)
    after = request.query_params.get("after")
    if after and after.isdigit():
        messages = list(thread.filter(id__gt=int(after)).order_by("created_at", "id"))
    else:
        messages = list(thread.order_by("created_at", "id"))
        _repair_whatsapp_media(messages)

    # opening the chat = reading it
    thread.filter(direction="in", is_read=False).update(is_read=True)

    # WhatsApp only allows free text within 24h of the customer's last message
    last_in = (thread.filter(direction="in").order_by("-created_at")
               .values_list("created_at", flat=True).first())
    window_open = bool(last_in and timezone.now() - last_in < timedelta(hours=24))

    return Response({
        "phone": phone,
        "customer_name": customer.name if customer else None,
        "window_open": window_open,
        "messages": [whatsapp_message_payload(m) for m in messages],
    })


# ------------------------------------------------------------ settings
# Admin only (same rule as the old template view: non-superusers got a 403).
class IsSuperuser(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


MIN_PASSWORD_LEN = 6


def get_setting():
    setting = Setting.objects.first()
    if not setting:
        setting = Setting.objects.create(
            membership_validity_days=365, renewal_fee=0, shop_renewal_fee=0
        )
    return setting


def setting_payload(s):
    return {
        "membership_validity_days": s.membership_validity_days,
        "renewal_fee": s.renewal_fee,
        "shop_renewal_fee": s.shop_renewal_fee,
    }


def staff_payload(u, last_seen=None):
    online = bool(last_seen and (timezone.now() - last_seen) < timedelta(minutes=5))
    return {
        "id": u.id,
        "username": u.username,
        "is_active": u.is_active,
        "is_online": online,
        "last_seen": last_seen,
    }


def staff_queryset():
    return User.objects.filter(is_staff=True, is_superuser=False)


def staff_list_payload():
    seen = dict(StaffActivity.objects.values_list("user_id", "last_seen"))
    return [staff_payload(u, seen.get(u.id)) for u in staff_queryset().order_by("username")]


def _money(value, label):
    try:
        d = Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise ValueError(f"{label} must be a number")
    if d < 0:
        raise ValueError(f"{label} cannot be negative")
    return d.quantize(Decimal("0.01"))


@api_view(["GET", "PATCH"])
@permission_classes([IsSuperuser])
def settings_membership(request):
    setting = get_setting()
    if request.method == "PATCH":
        d = request.data
        try:
            days = int(d.get("membership_validity_days"))
            if days < 1:
                raise ValueError
        except (TypeError, ValueError):
            return Response({"error": "Validity must be a whole number of days (1 or more)"}, status=400)
        try:
            renewal = _money(d.get("renewal_fee"), "Renewal fee")
            shop = _money(d.get("shop_renewal_fee"), "Shop renewal fee")
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        setting.membership_validity_days = days
        setting.renewal_fee = renewal
        setting.shop_renewal_fee = shop
        setting.save()
        setting.refresh_from_db()
    return Response(setting_payload(setting))


@api_view(["POST"])
@permission_classes([IsSuperuser])
def settings_admin_password(request):
    d = request.data
    current = d.get("current_password") or ""
    new = d.get("new_password") or ""
    confirm = d.get("confirm_password") or ""
    if not request.user.check_password(current):
        return Response({"error": "Current password is incorrect"}, status=400)
    if new != confirm:
        return Response({"error": "Passwords do not match"}, status=400)
    if len(new) < MIN_PASSWORD_LEN:
        return Response({"error": f"Password must be at least {MIN_PASSWORD_LEN} characters"}, status=400)
    request.user.set_password(new)
    request.user.save()
    update_session_auth_hash(request, request.user)  # stay logged in
    return Response({"ok": True})


@api_view(["GET", "POST"])
@permission_classes([IsSuperuser])
def settings_staff(request):
    if request.method == "POST":
        username = (request.data.get("username") or "").strip()
        password = request.data.get("password") or ""
        if not username or not password:
            return Response({"error": "Username and password required"}, status=400)
        if len(password) < MIN_PASSWORD_LEN:
            return Response({"error": f"Password must be at least {MIN_PASSWORD_LEN} characters"}, status=400)
        if User.objects.filter(username__iexact=username).exists():
            return Response({"error": "Username already exists"}, status=400)
        User.objects.create_user(username=username, password=password, is_staff=True)
    return Response({"staff": staff_list_payload()}, status=201 if request.method == "POST" else 200)


@api_view(["DELETE"])
@permission_classes([IsSuperuser])
def settings_staff_detail(request, pk):
    try:
        staff = staff_queryset().get(pk=pk)
    except User.DoesNotExist:
        return Response({"error": "Staff not found"}, status=404)
    staff.delete()
    return Response({"staff": staff_list_payload()})


@api_view(["POST"])
@permission_classes([IsSuperuser])
def settings_staff_toggle(request, pk):
    try:
        staff = staff_queryset().get(pk=pk)
    except User.DoesNotExist:
        return Response({"error": "Staff not found"}, status=404)
    staff.is_active = not staff.is_active
    staff.save(update_fields=["is_active"])
    return Response({"staff": staff_list_payload()})


@api_view(["POST"])
@permission_classes([IsSuperuser])
def settings_staff_password(request, pk):
    try:
        staff = staff_queryset().get(pk=pk)
    except User.DoesNotExist:
        return Response({"error": "Staff not found"}, status=404)
    new = request.data.get("new_password") or ""
    if len(new) < MIN_PASSWORD_LEN:
        return Response({"error": f"Password must be at least {MIN_PASSWORD_LEN} characters"}, status=400)
    staff.set_password(new)
    staff.save()
    return Response({"ok": True})


# ------------------------------------------------------------------ offers
# Admin only (same rule as the old offers / offer-history screens).
# Sending an offer = one WhatsApp template message per customer. That takes ~1 second per
# customer, which is longer than a web request may last (gunicorn kills it after 30s), so the
# sending runs in a background thread and the page polls /offers/<id>/progress/.
OFFER_GROUPS = ("all", "members", "non_members")
OFFER_CATEGORIES = {"all": None, "student": "Student", "customer": "Customer", "shop": "Shop"}

OFFER_JOBS = {}  # offer id -> {"total", "success", "failed", "done"}  (kept in this process only)


class OfferPagination(PageNumberPagination):
    page_size = 10


def _offer_recipients(group, category):
    """[(name, phone)] for a group/category choice. One entry per phone number, so a number
    saved on two customer records is not messaged twice."""
    customers = Customer.objects.exclude(phone__isnull=True).exclude(phone="")
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


def _offer_choice(request):
    group = request.query_params.get("group") or request.data.get("group") or "all"
    category = request.query_params.get("category") or request.data.get("category") or "all"
    if group not in OFFER_GROUPS or category not in OFFER_CATEGORIES:
        return None, None
    return group, category


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
            OffersHistory.objects.filter(pk=offer_id).update(total_sent=job["success"])
            time.sleep(1)
    finally:
        job["done"] = True
        connection.close()  # this thread opened its own DB connection


@api_view(["GET"])
@permission_classes([IsSuperuser])
def offers_recipients(request):
    """How many people an offer would reach (shown before sending)."""
    group, category = _offer_choice(request)
    if group is None:
        return Response({"error": "Invalid group or category"}, status=400)
    return Response({"count": len(_offer_recipients(group, category))})


@api_view(["POST"])
@permission_classes([IsSuperuser])
def offers_send(request):
    title = (request.data.get("title") or "").strip()
    message_text = (request.data.get("message") or "").strip()
    shop_number = (request.data.get("shop_number") or "").strip()
    group, category = _offer_choice(request)

    if not title or not message_text:
        return Response({"error": "Title and Message required"}, status=400)
    if len(title) > 100:
        return Response({"error": "Title can be at most 100 characters"}, status=400)
    if not shop_number:
        return Response({"error": "Shop contact number is required"}, status=400)
    if group is None:
        return Response({"error": "Invalid group or category"}, status=400)

    if any(not j["done"] for j in OFFER_JOBS.values()):
        return Response({"error": "Another offer is still being sent. Please wait for it to finish."},
                        status=409)

    people = _offer_recipients(group, category)
    if not people:
        return Response({"error": "No customers with a phone number match this selection"}, status=400)

    offer = OffersHistory.objects.create(
        title=title, message=message_text, group=group, category=category, total_sent=0
    )

    # WhatsApp template parameters may not contain line breaks, tabs or long runs of spaces
    clean_message = " ".join(f"{title} - {message_text}".split())

    for old_id in sorted(OFFER_JOBS)[:-20]:  # keep the job list small
        OFFER_JOBS.pop(old_id, None)
    OFFER_JOBS[offer.id] = {"total": len(people), "success": 0, "failed": 0, "done": False}

    threading.Thread(
        target=_run_offer_job, args=(offer.id, people, clean_message, shop_number), daemon=True
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
    return Response({"id": pk, "total": offer.total_sent, "success": offer.total_sent,
                     "failed": 0, "done": True})


@api_view(["GET"])
@permission_classes([IsSuperuser])
def offers_history(request):
    qs = OffersHistory.objects.all().order_by("-id")
    q = (request.query_params.get("q") or "").strip()
    if q:
        qs = qs.filter(title__icontains=q)

    pager = OfferPagination()
    page = pager.paginate_queryset(qs, request)
    return pager.get_paginated_response([offer_payload(o) for o in page])


@api_view(["DELETE"])
@permission_classes([IsSuperuser])
def offers_history_delete(request, pk):
    offer = OffersHistory.objects.filter(pk=pk).first()
    if offer is None:
        return Response({"detail": "Not found"}, status=404)
    offer.delete()
    return Response(status=204)