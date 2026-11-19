"""Membership History API (admin only) - replaces the old /membership-history/ Django page.

    GET    /api/membership-history/        list + totals (search, payment, type, date range, page)
    DELETE /api/membership-history/<id>/   delete one record (same rule as the old delete_membership view)

Kept in its own file so api_views.py does not have to change.
"""
from datetime import datetime, timedelta

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .api_views import IsSuperuser
from .models import MembershipTransaction

PAYMENT_METHODS = ("cash", "upi", "card")


class MembershipPagination(PageNumberPagination):
    page_size = 10  # same as the old Paginator(transactions, 10)


def _parse_day(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _filter_memberships(qs, p, today):
    """Search / type / date filters. The payment-method filter is applied separately so the
    stat cards keep showing every method while one method is selected."""
    q = (p.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(customer__name__icontains=q) | Q(customer__phone__icontains=q)
                       | Q(customer__member_id__icontains=q))

    kind = (p.get("type") or "").strip().lower()
    if kind:
        qs = qs.filter(type__iexact=kind)

    rng = p.get("range")
    if rng == "today":
        qs = qs.filter(created_at__date=today)
    elif rng == "7d":
        qs = qs.filter(created_at__date__range=(today - timedelta(days=6), today))
    elif rng == "30d":
        qs = qs.filter(created_at__date__range=(today - timedelta(days=29), today))
    elif rng == "month":
        qs = qs.filter(created_at__year=today.year, created_at__month=today.month)
    elif rng == "last_month":
        last = today.replace(day=1) - timedelta(days=1)
        qs = qs.filter(created_at__year=last.year, created_at__month=last.month)

    date_from, date_to = _parse_day(p.get("date_from")), _parse_day(p.get("date_to"))
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)
    return qs


def membership_payload(m):
    c = m.customer
    return {
        "id": m.id,
        "customer": {"id": c.id, "name": c.name, "phone": c.phone,
                     "member_id": c.member_id, "category": c.category},
        "type": m.type,
        "payment_method": m.payment_method,
        "amount": m.amount,
        "start_date": m.start_date,
        "end_date": m.end_date,
        "created_at": m.created_at,
    }


@api_view(["GET"])
@permission_classes([IsSuperuser])
def membership_history(request):
    today = timezone.localdate()
    p = request.query_params
    base = _filter_memberships(MembershipTransaction.objects.select_related("customer"), p, today)

    qs = base
    method = (p.get("payment") or "").strip().lower()
    if method in PAYMENT_METHODS:
        qs = qs.filter(payment_method=method)
    qs = qs.order_by("-created_at", "-id")

    pager = MembershipPagination()
    page = pager.paginate_queryset(qs, request)
    response = pager.get_paginated_response([membership_payload(m) for m in page])

    # totals follow search / date filters but not the payment filter (see _filter_memberships)
    total = base.aggregate(count=Count("id"), amount=Sum("amount"))
    by_method = {row["payment_method"]: row["amount"] or 0
                 for row in base.values("payment_method").annotate(amount=Sum("amount"))}
    response.data["summary"] = {
        "count": total["count"] or 0,
        "amount": total["amount"] or 0,
        "cash": by_method.get("cash", 0),
        "upi": by_method.get("upi", 0),
        "card": by_method.get("card", 0),
    }
    return response


@api_view(["DELETE"])
@permission_classes([IsSuperuser])
def membership_delete(request, pk):
    membership = MembershipTransaction.objects.select_related("customer").filter(pk=pk).first()
    if membership is None:
        return Response({"detail": "Not found"}, status=404)

    # old behaviour: deleting a record also removes the customer's membership
    with transaction.atomic():
        customer = membership.customer
        customer.is_member = False
        customer.save(update_fields=["is_member"])
        membership.delete()
    return Response(status=204)