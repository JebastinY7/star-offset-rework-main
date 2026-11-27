"""Bill saving logic, shared by the React API.

Ported from views.save_bill (same due / discount rules) so it can be called
with plain data instead of a Django form POST. The old view in views.py is
left untouched until every page has moved to React.
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from .models import Bill, BillItem, Customer, Order, PointTransaction
from .visiting_card_pricing import calculate_visiting_card_price


PAYMENT_MODES = ("cash", "upi", "bank")


class BillingError(Exception):
    pass


def D(v):
    return Decimal(str(v if v not in (None, "") else 0))


def custom_round_amount(amount):
    whole = int(amount)
    return whole if (amount - whole) < Decimal("0.5") else whole + 1


@transaction.atomic
def save_bill_core(*, customer_id, items, bill_id=None, order_id=None,
                   extra_discount=0, old_due_payment=0, paid_amount=None,
                   payment_mode="cash"):
    if not customer_id:
        raise BillingError("Customer not selected")
    if not items:
        raise BillingError("No items added")

    try:
        # Row lock: two bills saved at the same moment can't overwrite each
        # other's due balance.
        customer = Customer.objects.select_for_update().get(id=customer_id)
    except Customer.DoesNotExist:
        raise BillingError("Customer not found")

    today = timezone.localdate()

    customer_type = "Customer"
    if customer.category.lower() == "shop":
        customer_type = "Shop"
    elif customer.is_member and customer.expiry_date and customer.expiry_date >= today:
        customer_type = "Member"

    # Recalculate Visiting Card prices on the server before totals are computed.
    # The customer/shop rate table is selected from the saved customer category.
    rate_type = "shop" if (customer.category or "").strip().lower() == "shop" else "customer"
    for item in items:
        if item.get("billingType") == "visiting":
            vc = item.get("visitingCard") if isinstance(item.get("visitingCard"), dict) else {}
            if not vc:
                raise BillingError("Visiting Card specifications are missing")
            try:
                calculated = calculate_visiting_card_price(
                    gsm=vc.get("gsm"),
                    size=vc.get("size"),
                    qty=item.get("qty"),
                    sides=vc.get("sides"),
                    price_type=rate_type,
                    method=vc.get("method"),
                    lamination=vc.get("lamination", "Without Lamination"), jobs=item.get("job", vc.get("jobs", 1)),
                )
            except (TypeError, ValueError) as exc:
                raise BillingError(str(exc))
            item["price"] = calculated["unit_price"]
            item["total"] = calculated["total"]
            item["extraCharge"] = item.get("extraCharge", 0)
            item["discount"] = item.get("discount", 0)

    extra_discount = D(extra_discount)

    # ---- previous due / edit handling (same rules as the old view) ----
    bill = None
    later_change = Decimal("0")

    if bill_id:
        try:
            bill = Bill.objects.get(id=int(bill_id))
        except Bill.DoesNotExist:
            raise BillingError("Bill not found")

        if bill.customer_id == customer.id:
            bill_owner = customer
            previous_due = bill.previous_due
            # newer bills / Pay Due payments made after this bill stay as they are
            later_change = customer.due_amount - bill.due_amount
        else:
            bill_owner = Customer.objects.select_for_update().get(id=bill.customer_id)
            previous_due = customer.due_amount

        for t in PointTransaction.objects.filter(bill=bill):
            if t.type == "redeem":
                bill_owner.points += t.points_used
            elif t.type == "earn":
                bill_owner.points -= t.points_added
        PointTransaction.objects.filter(bill=bill).delete()

        if bill_owner.id != customer.id:
            # give the old customer back what this bill added to his due
            bill_owner.due_amount = max(
                bill_owner.due_amount - (bill.due_amount - bill.previous_due), Decimal("0")
            )
            bill_owner.save()
    else:
        previous_due = customer.due_amount

    old_due_payment = max(min(D(old_due_payment), previous_due), Decimal("0"))
    remaining_old_due = previous_due - old_due_payment

    # No discount while old due is still pending
    if remaining_old_due > 0:
        for it in items:
            gross = D(it["total"]) - D(it.get("extraCharge")) + D(it.get("discount"))
            it["discount"] = 0
            it["total"] = gross + D(it.get("extraCharge"))

    gross_total = sum(
        (D(it["total"]) - D(it.get("extraCharge")) + D(it.get("discount"))) for it in items
    )
    item_discount_total = sum(D(it.get("discount")) for it in items)
    total_extra_charge = sum(D(it.get("extraCharge")) for it in items)

    # Item discounts count for every customer type, so the saved amount
    # always matches what the billing screen shows.
    total_discount = item_discount_total + extra_discount

    raw_final = max(gross_total - total_discount + total_extra_charge, Decimal("0"))
    final = Decimal(custom_round_amount(raw_final))

    paid = Decimal("0") if paid_amount in (None, "") else D(paid_amount)
    paid = max(paid, Decimal("0"))

    current_due = max(final - paid, Decimal("0"))
    due_amount = current_due + remaining_old_due
    customer.due_amount = max(due_amount + later_change, Decimal("0"))

    if paid >= final:
        payment_status = "paid"
    elif paid > 0:
        payment_status = "partial"
    else:
        payment_status = "due"

    # Cash / UPI / Bank as chosen on the screen; nothing received at all = Credit
    payment_mode = str(payment_mode or "cash").lower()
    if payment_mode not in PAYMENT_MODES:
        payment_mode = "cash"
    if paid + old_due_payment <= 0:
        payment_mode = "credit"

    fields = dict(
        payment_mode=payment_mode,
        gross_total=gross_total,
        extra_charge_total=total_extra_charge,
        total_amount=gross_total - total_discount + total_extra_charge,
        discount=total_discount,
        points_used=0,
        final_amount=final,
        paid_amount=paid,
        old_due_paid=old_due_payment,
        previous_due=previous_due,
        current_due=current_due,
        due_amount=due_amount,
        payment_status=payment_status,
    )

    if bill:
        bill.customer = customer
        for k, v in fields.items():
            setattr(bill, k, v)
        bill.save()
        bill.billitem_set.all().delete()
    else:
        next_number = (Bill.objects.aggregate(m=Max("bill_number"))["m"] or 0) + 1
        order = Order.objects.filter(id=order_id).first() if order_id else None
        bill = Bill.objects.create(
            bill_no=f"B{next_number}", bill_number=next_number, customer=customer,
            order=order, bill_date=today, **fields,
        )
        if order:
            order.is_billed = True
            order.total_amount = final
            order.advance_paid = paid
            order.due_amount = current_due
            order.save()

    for it in items:
        btype = it.get("billingType")
        common = dict(
            bill=bill,
            qty=it.get("qty"),
            price=it.get("price"),
            total=it.get("total"),
            discount=it.get("discount", 0),
            extra_charge=it.get("extraCharge", 0),
            extra_purpose=it.get("extraPurpose", ""),
        )
        if btype == "visiting":
            vc = it.get("visitingCard") if isinstance(it.get("visitingCard"), dict) else {}
            specifications = {"kind": "visiting_card", **vc}
            BillItem.objects.create(
                service_name=it.get("name") or "Visiting Card",
                manual_name=it.get("name") or "Visiting Card",
                specifications=specifications,
                job=it.get("job", vc.get("jobs", 1)),
                **common,
            )
        elif btype == "manual":
            name = it.get("name")
            BillItem.objects.create(
                service_name=name, manual_name=name,
                category_id=it.get("categoryId") or None,
                size_id=it.get("sizeId") or None,
                variant_id=it.get("variantId") or None,
                **common,
            )
        elif btype == "normal print":
            BillItem.objects.create(
                service_name=it["name"],
                category_id=it.get("categoryId") or None,
                size_id=it.get("sizeId") or None,
                variant_id=it.get("variantId") or None,
                job=it.get("job", 1),
                **common,
            )
        elif btype == "digital print":
            # stored name drops the last part (delivery type), as before
            name = " - ".join(it.get("name", "").split(" - ")[:-1])
            BillItem.objects.create(
                service_name=name,
                digital_category_id=it.get("categoryId") or None,
                digital_gsm_id=it.get("sizeId") or None,
                digital_product_id=it.get("variantId") or None,
                digital_lamination_id=it.get("laminationId") or None,
                delivery_type_id=it.get("deliveryTypeId") or None,
                side=it.get("side"),
                side_name=it.get("sideName"),
                job=it.get("job", 1),
                **common,
            )

    customer.save()
    return bill