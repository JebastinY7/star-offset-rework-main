"""Admin/staff API for shop orders, including payment and production workflow."""
from decimal import Decimal, InvalidOperation
from django.db.models import Q
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from .artwork import public_files
from .models import ShopOrder
from .vendor_models import annotate_assign, assign_prefetch, assign_row, filter_assign


class IsStaffOrAdmin(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and (user.is_staff or user.is_superuser))


PAGE_SIZE = 10
VALID_STATUSES = {key for key, _label in ShopOrder.STATUS_CHOICES}
TRANSITIONS = {
    "submitted": {"awaiting_payment", "cancelled"},
    "awaiting_payment": {"payment_confirmed", "cancelled"},
    "payment_confirmed": {"in_production", "cancelled"},
    "in_production": {"ready", "cancelled"},
    "ready": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


def order_row(order):
    names = []
    for item in order.items.all():
        if item.service_name not in names:
            names.append(item.service_name)
    amount = order.final_amount if order.final_amount is not None else order.total_amount
    return {
        "id": order.id,
        "order_no": order.order_no,
        "shop_name": order.shop.name,
        "shop_id": order.shop_id,
        "username": order.shop.user.username,
        "phone": order.shop.phone or "",
        "email": order.shop.email or "",
        "date": order.created_at.date().isoformat(),
        "created_at": order.created_at.isoformat(),
        "items": order.items_count,
        "items_text": ", ".join(names[:2]) + (f" +{len(names)-2} more" if len(names) > 2 else ""),
        "amount": str(amount) if amount is not None else None,
        "estimated_amount": str(order.total_amount),
        "final_amount": str(order.final_amount) if order.final_amount is not None else None,
        "payment_method": order.payment_method,
        "payment_reference": order.payment_reference,
        "payment_confirmed_at": order.payment_confirmed_at.isoformat() if order.payment_confirmed_at else None,
        "payment_confirmed_by": order.payment_confirmed_by.get_username() if order.payment_confirmed_by else None,
        "status": order.status,
        "status_label": order.get_status_display(),
        "source": "shop",
        "assign": assign_row(order),  # is this order already given to a vendor?
    }


@api_view(["GET"])
@permission_classes([IsStaffOrAdmin])
def admin_shop_orders(request):
    qs = ShopOrder.objects.select_related("shop", "shop__user", "payment_confirmed_by").prefetch_related("items", assign_prefetch()).all()
    counts = {
        "total": qs.count(),
        "submitted": qs.filter(status="submitted").count(),
        "awaiting_payment": qs.filter(status="awaiting_payment").count(),
        "payment_confirmed": qs.filter(status="payment_confirmed").count(),
        "in_production": qs.filter(status="in_production").count(),
        "ready": qs.filter(status="ready").count(),
        "completed": qs.filter(status="completed").count(),
        "cancelled": qs.filter(status="cancelled").count(),
    }
    q = (request.query_params.get("q") or "").strip()[:100]
    status = request.query_params.get("status", "")
    if status in VALID_STATUSES:
        qs = qs.filter(status=status)
    if q:
        qs = qs.filter(Q(shop__name__icontains=q) | Q(shop__user__username__icontains=q)
                       | Q(shop__phone__icontains=q) | Q(instructions__icontains=q)
                       | Q(items__service_name__icontains=q)).distinct()
        digits = q.upper().replace("ORD-", "")
        if digits.isdigit():
            qs = qs.filter(Q(id=int(digits)) | Q(shop__name__icontains=q) | Q(shop__user__username__icontains=q)
                           | Q(shop__phone__icontains=q) | Q(instructions__icontains=q) | Q(items__service_name__icontains=q)).distinct()
    date_from = request.query_params.get("date_from")
    date_to = request.query_params.get("date_to")
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)
    qs = filter_assign(annotate_assign(qs), request.query_params.get("assign", ""))
    total = qs.count()
    try:
        page = max(1, int(request.query_params.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page = min(page, pages)
    rows = qs.order_by("-created_at", "-id")[(page-1)*PAGE_SIZE:page*PAGE_SIZE]
    return Response({"counts": counts, "results": [order_row(o) for o in rows], "total_count": total, "page": page, "pages": pages, "page_size": PAGE_SIZE})


@api_view(["GET", "PATCH"])
@permission_classes([IsStaffOrAdmin])
def admin_shop_order_detail(request, pk):
    order = ShopOrder.objects.select_related("shop", "shop__user", "payment_confirmed_by").prefetch_related("items", assign_prefetch()).filter(pk=pk).first()
    if order is None:
        return Response({"error": "Shop order not found."}, status=404)

    if request.method == "PATCH":
        next_status = request.data.get("status")
        fields = []

        if "final_amount" in request.data:
            try:
                final_amount = Decimal(str(request.data.get("final_amount")))
                if not final_amount.is_finite() or final_amount <= 0:
                    raise InvalidOperation
            except (InvalidOperation, TypeError, ValueError):
                return Response({"error": "Enter a valid final amount greater than zero."}, status=400)
            if order.status not in {"submitted", "awaiting_payment"}:
                return Response({"error": "The final price can only be edited before payment is confirmed."}, status=400)
            order.final_amount = final_amount
            fields.append("final_amount")

        if "payment_method" in request.data:
            order.payment_method = str(request.data.get("payment_method") or "")[:80]
            fields.append("payment_method")
        if "payment_reference" in request.data:
            order.payment_reference = str(request.data.get("payment_reference") or "")[:120]
            fields.append("payment_reference")

        if next_status is not None:
            if next_status not in VALID_STATUSES:
                return Response({"error": "Choose a valid order status."}, status=400)
            if next_status != order.status and next_status not in TRANSITIONS.get(order.status, set()):
                return Response({"error": f"Cannot move an order from {order.get_status_display()} to {dict(ShopOrder.STATUS_CHOICES).get(next_status, next_status)}."}, status=400)
            if next_status == "awaiting_payment":
                if order.final_amount is None:
                    return Response({"error": "Set the final amount before sending the order for payment."}, status=400)
            if next_status == "payment_confirmed":
                if order.final_amount is None or order.final_amount <= 0:
                    return Response({"error": "A valid final amount is required before confirming payment."}, status=400)
                order.payment_confirmed_at = timezone.now()
                order.payment_confirmed_by = request.user
                fields.extend(["payment_confirmed_at", "payment_confirmed_by"])
            if next_status:
                order.status = next_status
                fields.append("status")

        if fields:
            order.save(update_fields=list(dict.fromkeys(fields + ["updated_at"])))

    order.refresh_from_db()
    return Response({
        "order": {**order_row(order), "delivery_date": order.delivery_date.isoformat() if order.delivery_date else None,
                  "instructions": order.instructions, "updated_at": order.updated_at.isoformat()},
        "items": [{"id": i.id, "service_name": i.service_name, "kind": i.kind, "spec": i.spec, "qty": i.qty,
                   "estimate": str(i.estimate) if i.estimate is not None else None, "files": public_files(i.files)}
                  for i in order.items.all()],
    })
