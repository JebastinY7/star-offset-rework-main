from django.utils.timezone import localtime
from rest_framework import serializers
from .models import Customer


class CustomerSerializer(serializers.ModelSerializer):
    """Customer JSON. The stored password field is never exposed."""

    class Meta:
        model = Customer
        exclude = ["password"]
        read_only_fields = ["Customer_code", "due_amount", "points", "created_at"]

    def validate(self, data):
        # Same rules as the old add_customer / edit_customer views
        inst = self.instance
        is_member = data.get("is_member", inst.is_member if inst else False)

        if is_member:
            member_id = data.get("member_id", inst.member_id if inst else None)
            if not member_id:
                raise serializers.ValidationError({"member_id": "Membership ID is required"})
            qs = Customer.objects.filter(member_id=member_id)
            if inst:
                qs = qs.exclude(pk=inst.pk)
            if qs.exists():
                raise serializers.ValidationError({"member_id": "Membership ID already exists"})
        else:
            data["member_id"] = None
            data["join_date"] = None
            data["expiry_date"] = None
        return data

    def validate_phone(self, value):
        value = value.strip()
        qs = Customer.objects.filter(phone=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Phone number already exists")
        return value


# ------------------------------------------------------------------ bills
from .models import Bill, BillItem  # noqa: E402


def bill_item_payload(i):
    """BillItem -> the shape the React billing screen works with."""
    visiting_card = i.specifications if isinstance(i.specifications, dict) and i.specifications.get("kind") == "visiting_card" else None
    if visiting_card:
        btype, cat, size, var = "visiting", None, None, None
    elif i.digital_category_id:
        btype, cat, size, var = "digital print", i.digital_category_id, i.digital_gsm_id, i.digital_product_id
    elif i.manual_name:
        btype, cat, size, var = "manual", i.category_id, i.size_id, i.variant_id
    else:
        btype, cat, size, var = "normal print", i.category_id, i.size_id, i.variant_id

    price, discount, extra, total = float(i.price), float(i.discount), float(i.extra_charge), float(i.total)
    return {
        "id": i.id,
        "billingType": btype,
        "name": i.service_name,
        "visitingCard": {k: v for k, v in visiting_card.items() if k != "kind"} if visiting_card else None,
        "categoryId": cat or "", "sizeId": size or "", "variantId": var or "",
        "laminationId": i.digital_lamination_id or "",
        "deliveryTypeId": i.delivery_type_id or "",
        "deliveryTypeName": i.delivery_type.name if i.delivery_type_id else "",
        "side": i.side or "", "sideName": i.side_name or "",
        "qty": i.qty, "job": i.job,
        "price": price, "discount": discount, "extraCharge": extra,
        "extraPurpose": i.extra_purpose or "", "total": total,
        "gross": round(total + discount - extra, 2),
    }


def bill_payload(bill, with_items=False):
    items = list(bill.billitem_set.select_related("delivery_type").order_by("id"))
    item_discount = sum(float(i.discount) for i in items)
    data = {
        "id": bill.id, "bill_no": bill.bill_no, "bill_date": bill.bill_date,
        "customer": CustomerSerializer(bill.customer).data,
        "gross_total": bill.gross_total, "discount": bill.discount,
        "extra_charge_total": bill.extra_charge_total, "total_amount": bill.total_amount,
        "final_amount": bill.final_amount, "paid_amount": bill.paid_amount,
        "old_due_paid": bill.old_due_paid, "previous_due": bill.previous_due,
        "current_due": bill.current_due, "due_amount": bill.due_amount,
        "payment_status": bill.payment_status,
        "payment_mode": bill.payment_mode,
        # discount typed in the "Extra Discount" box = total discount - item discounts
        "extra_discount": round(max(float(bill.discount) - item_discount, 0), 2),
    }
    if with_items:
        data["items"] = [bill_item_payload(i) for i in items]
        data["payments"] = bill_payments(bill)
    return data


def bill_payments(bill):
    """Payment history of a bill.

    There is no payment table (BillPayment was removed in migration 0049), so the rows are
    rebuilt from what the bill stores: the amount paid with the bill, and any old due cleared on it.
    Receipt numbers are derived from the bill number.
    """
    rows = []
    if bill.paid_amount > 0:
        rows.append({"date": bill.bill_date, "receipt_no": f"RC-{bill.bill_no}", "mode": bill.payment_mode,
                     "amount": bill.paid_amount, "note": "Paid with bill"})
    if bill.old_due_paid > 0:
        rows.append({"date": bill.bill_date, "receipt_no": f"RC-{bill.bill_no}-OD", "mode": bill.payment_mode,
                     "amount": bill.old_due_paid, "note": "Old due payment"})
    return rows


# ----------------------------------------------------------------- orders
from django.utils import timezone  # noqa: E402

from .models import Order, OrderItem  # noqa: E402


def order_item_payload(i):
    """OrderItem -> the shape the React order form / billing screen works with."""
    vc = {}
    if i.billing_type == "digital":
        cat, size, var = i.digital_category_id, i.digital_gsm_id, i.digital_product_id
        parts = [i.digital_category, i.digital_gsm, i.digital_product, i.digital_lamination]
        name = " - ".join([p.name for p in parts if p] + [x for x in (i.side_name, i.delivery_type.name if i.delivery_type_id else "") if x])
        category_name = i.digital_category.name if i.digital_category_id else ""
    else:
        cat, size, var = i.category_id, i.size_id, i.variant_id
        if (i.work_type or "") == "visiting_card":
            vc = i.specifications if isinstance(i.specifications, dict) else {}
            name = "Visiting Card — " + " · ".join([
                f"Printing: {str(vc.get('method', '')).title()}",
                f"GSM: {vc.get('gsm', '')}", f"Size: {vc.get('size', '')}",
                f"Print Variant: {'Single side' if vc.get('sides') == 'single' else 'Double side'}",
                f"Lamination: {vc.get('lamination', '')}", f"Quantity: {vc.get('qty', i.qty)}",
            ])
        else:
            name = " - ".join(p.name for p in (i.category, i.size, i.variant) if p)
        category_name = i.category.name if i.category_id else ""
    return {
        "id": i.id,
        "billingType": "visiting" if (i.work_type or "") == "visiting_card" else i.billing_type,
        "visitingCard": vc if (i.work_type or "") == "visiting_card" else None,
        "name": name or "Item",
        "categoryId": cat or "", "categoryName": category_name,
        "sizeId": size or "", "variantId": var or "",
        "laminationId": i.digital_lamination_id or "",
        "deliveryTypeId": i.delivery_type_id or "",
        "side": i.side or "", "sideName": i.side_name or "",
        "customerType": i.customer_type or "",
        "qty": i.qty, "job": i.job,
        "price": float(i.price), "total": float(i.total),
    }


def order_payload(order):
    """Order (+ its items) -> JSON. Callers should prefetch items for lists."""
    return {
        "id": order.id,
        "customer": CustomerSerializer(order.customer).data,
        "work_name": order.work_name,
        "notes": order.notes or "",
        "order_date": order.order_date,
        "delivery_date": order.delivery_date,
        "total_amount": float(order.total_amount),
        "advance_paid": float(order.advance_paid),
        "advance_mode": order.advance_mode,
        "advance_reference": order.advance_reference,
        "due_amount": float(order.due_amount),
        "is_billed": order.is_billed,
        "status": order.status,
        "is_overdue": order.delivery_date < timezone.localdate() and order.status not in ("delivered", "cancelled"),
        "items": [order_item_payload(i) for i in order.items.all()],
    }


# ------------------------------------------------------------- quotations
from pricing.models import DeliveryType  # noqa: E402

from .models import Quotation  # noqa: E402


def delivery_type_names():
    """{"3": "Urgent", ...}. QuotationItem.work_type stores the delivery type id as text."""
    return {str(d.id): d.name for d in DeliveryType.objects.all()}


def quotation_item_payload(i, delivery_names):
    """QuotationItem -> the shape the React quotation form works with.

    billingType is "normal" | "digital" | "manual" (manual = the OTHERS line with a typed name).
    """
    delivery_id = i.work_type if (i.work_type or "").isdigit() else ""
    delivery_name = delivery_names.get(delivery_id, "")

    if (i.work_type or "") == "visiting_card":
        btype, cat, size, var = "visiting", None, None, None
        vc = i.specifications if isinstance(i.specifications, dict) else {}
        name = "Visiting Card — " + " · ".join([
            f"Printing: {str(vc.get('method', '')).title()}", f"GSM: {vc.get('gsm', '')}",
            f"Size: {vc.get('size', '')}",
            f"Print Variant: {'Single side' if vc.get('sides') == 'single' else 'Double side'}",
            f"Lamination: {vc.get('lamination', '')}", f"Quantity: {vc.get('qty', i.qty)}",
        ])
    elif i.billing_type == "digital":
        btype, cat, size, var = "digital", i.digital_category_id, i.digital_gsm_id, i.digital_product_id
        parts = [i.digital_category, i.digital_gsm, i.digital_product, i.digital_lamination]
        name = " - ".join([p.name for p in parts if p] + [x for x in (i.side_name, delivery_name) if x])
    elif i.manual_name:
        btype, cat, size, var = "manual", None, None, None
        name = i.manual_name
    else:
        btype, cat, size, var = "normal", i.category_id, i.size_id, i.variant_id
        name = " - ".join(p.name for p in (i.category, i.size, i.variant) if p)

    return {
        "id": i.id,
        "billingType": btype,
        "name": name or "Item",
        "categoryId": cat or "", "sizeId": size or "", "variantId": var or "",
        "laminationId": i.digital_lamination_id or "",
        "deliveryTypeId": int(delivery_id) if delivery_id else "",
        "side": i.side or "", "sideName": i.side_name or "",
        "customerType": i.customer_type or "",
        "visitingCard": i.specifications if (i.work_type or "") == "visiting_card" else None,
        "qty": i.qty, "job": i.job,
        "price": float(i.price), "total": float(i.total),
    }


def quotation_payload(q, with_items=False):
    """Quotation -> JSON. The list view skips the items; the detail view includes them."""
    data = {
        "id": q.id,
        "code": f"Q{q.id:03d}",  # what the old screens showed (Q005), not the stored quotation_no
        "quotation_no": q.quotation_no,
        "customer_name": q.customer_name,
        "customer_phone": q.customer_phone,
        "work_name": q.work_name,
        "quotation_date": q.quotation_date,
        "valid_until": q.valid_until,
        "total_amount": float(q.total_amount),
        "discount": float(q.discount),
        "extra_charge": float(q.extra_charge),
        "notes": q.notes or "",
        "terms": q.terms or "",
        "is_billed": q.converted_bill_id is not None,
        "bill_id": q.converted_bill_id,
        "bill_no": q.converted_bill.bill_no if q.converted_bill_id else "",
    }
    if with_items:
        names = delivery_type_names()
        items = q.items.select_related(
            "category", "size", "variant", "digital_category", "digital_gsm",
            "digital_product", "digital_lamination",
        ).order_by("id")
        data["items"] = [quotation_item_payload(i, names) for i in items]
    return data


def whatsapp_message_payload(m):
    """One WhatsApp message for the Messages screen (inbox preview + chat bubble)."""
    return {
        "id": m.id,
        "direction": m.direction,            # "in" = customer, "out" = us
        "message_type": m.message_type,      # text, image, document, video, audio, sticker, template
        "body": m.body or "",                # text, or caption for media
        "media_url": m.media.url if m.media else None,
        "media_filename": m.media_filename or "",
        "media_mime_type": m.media_mime_type or "",
        "created_at": localtime(m.created_at).isoformat(),
    }


def offer_payload(o):
    """One row of the offers history."""
    return {
        "id": o.id,
        "title": o.title,
        "message": o.message,
        "group": o.group,
        "category": o.category,
        "total_sent": o.total_sent,
        "failed": o.failed,
        "total_recipients": o.total_recipients,
        "status": o.status,
        "valid_from": o.valid_from.isoformat() if o.valid_from else None,
        "valid_until": o.valid_until.isoformat() if o.valid_until else None,
        "shop_number": o.shop_number,
        "created_at": localtime(o.created_at).isoformat(),
    }