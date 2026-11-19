"""Shop Portal invoices: a shop views / downloads the invoice for an order it has paid for.

    GET /api/shop/orders/<id>/invoice/        the invoice as JSON (the portal draws the page from this)
    GET /api/shop/orders/<id>/invoice/pdf/    the same invoice as a PDF file (download)

Whose name is on it (this is the shop's copy of the invoice):
  * Header             - the shop itself: its name, address, phone, email and GST number as saved for that shop.
  * Bill To            - the main shop, Star Offset Printing (COMPANY below).
(Star Offset's own admin bill is separate: it has Star Offset in the header and the shop under Bill To.)

An invoice exists once the order's payment is confirmed (wallet / online payments confirm at once, bank
payments when the admin confirms) and the order is not cancelled.  A shop only ever sees its own orders.
"""
import re
from decimal import Decimal
from io import BytesIO
from xml.sax.saxutils import escape

from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import ShopOrder
from .shop_portal_api import IsShopUser

# The main shop - printed on every shop invoice under "Bill To".
COMPANY = {
    "name": "Star Offset Printing",
    "address": "1/116, Puthanchanthai Jn, Maruthancode Post, K.K District - 629163",
    "phone": "+91 9488634058",
    "email": "staroffsets@gmail.com",
}

NOT_READY = "An invoice is available once the payment for this order has been confirmed."


def invoice_ready(order):
    """True when this order can show an invoice."""
    return bool(order.payment_confirmed_at) and order.status != "cancelled" and order.final_amount is not None


def _money(value):
    return f"{Decimal(value or 0):.2f}"


def _inr(value):
    return "Rs. {:,.2f}".format(float(value or 0))


def _cap(text):
    return (text[:1].upper() + text[1:]) if text else ""


def build_invoice(order):
    """Everything the invoice shows, as plain data (used by both the page and the PDF)."""
    shop = order.shop
    items, subtotal = [], Decimal("0")
    for n, item in enumerate(order.items.all(), start=1):
        amount = item.estimate
        if amount is not None:
            subtotal += amount
        items.append({
            "no": n,
            "name": item.service_name,
            "spec": [s for s in (item.spec or []) if isinstance(s, dict)],
            "qty": item.qty,
            "rate": _money(amount / item.qty) if amount is not None and item.qty else None,
            "amount": _money(amount) if amount is not None else None,
        })

    total = order.final_amount if order.final_amount is not None else order.total_amount
    adjustment = total - subtotal  # the admin can change the final price after the order was placed
    paid_on = timezone.localtime(order.payment_confirmed_at).date() if order.payment_confirmed_at else None
    invoice_date = paid_on or timezone.localtime(order.created_at).date()
    safe_name = re.sub(r"[^A-Za-z0-9]+", "-", shop.name).strip("-")[:40] or "Shop"

    return {
        "invoice_no": f"INV-{order.order_no}",
        "date": invoice_date.isoformat(),
        "order_no": order.order_no,
        "order_date": timezone.localtime(order.created_at).date().isoformat(),
        "delivery_date": order.delivery_date.isoformat() if order.delivery_date else None,
        "seller": {  # the shop - shown in the header
            "name": shop.name,
            "owner_name": shop.owner_name,
            "address": shop.address,
            "phone": shop.phone,
            "email": shop.email,
            "gst_number": shop.gst_number,
        },
        "bill_to": {**COMPANY, "owner_name": "", "gst_number": ""},  # the main shop
        "items": items,
        "subtotal": _money(subtotal),
        "adjustment": _money(adjustment) if abs(adjustment) >= Decimal("0.01") else None,
        "total": _money(total),
        "payment": {
            "status": "Paid",
            "method": _cap(order.payment_method),
            "reference": order.payment_reference,
            "paid_on": paid_on.isoformat() if paid_on else None,
        },
        "filename": f"Invoice-{order.order_no}-{safe_name}.pdf",
    }


def _own_order(request, pk):
    return (ShopOrder.objects.select_related("shop").prefetch_related("items")
            .filter(shop=request.user.shop_profile, pk=pk).first())


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_invoice(request, pk):
    order = _own_order(request, pk)
    if order is None:
        return Response({"error": "Order not found."}, status=404)
    if not invoice_ready(order):
        return Response({"error": NOT_READY}, status=409)
    return Response({"invoice": build_invoice(order)})


def _day(iso):
    y, m, d = iso.split("-")
    return f"{d}-{m}-{y}"


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_invoice_pdf(request, pk):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    order = _own_order(request, pk)
    if order is None:
        return Response({"error": "Order not found."}, status=404)
    if not invoice_ready(order):
        return Response({"error": NOT_READY}, status=409)
    inv = build_invoice(order)

    styles = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=9, leading=12)
    tiny = ParagraphStyle("tiny", parent=small, fontSize=7.5, leading=10, textColor=colors.HexColor("#6b7280"))
    label = ParagraphStyle("label", parent=small, fontSize=8, textColor=colors.HexColor("#6b7280"))
    right = ParagraphStyle("right", parent=small, alignment=2)
    gold = colors.HexColor("#c49b2c")
    grey = colors.HexColor("#d1d5db")

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm, title=f"Invoice {inv['invoice_no']}")
    story = []

    # ---- header: the shop on the left, invoice details on the right
    seller = inv["seller"]
    brand = [Paragraph(f"<b>{escape(seller['name'])}</b>", ParagraphStyle("brand", parent=styles["Title"], alignment=0, fontSize=18, leading=22, spaceAfter=2))]
    if seller["address"]:
        brand.append(Paragraph(escape(seller["address"]).replace("\n", "<br/>"), small))
    shop_contact = " &nbsp;|&nbsp; ".join(x for x in (f"Phone: {escape(seller['phone'])}" if seller["phone"] else "", escape(seller["email"]) if seller["email"] else "") if x)
    if shop_contact:
        brand.append(Paragraph(shop_contact, small))
    if seller["gst_number"]:
        brand.append(Paragraph(f"GSTIN: {escape(seller['gst_number'])}", small))
    brand_cell = brand
    meta = [Paragraph("<b>INVOICE</b>", ParagraphStyle("inv", parent=right, fontSize=16, leading=20, textColor=gold)),
            Paragraph(f"<b>Invoice No:</b> {escape(inv['invoice_no'])}", right),
            Paragraph(f"<b>Date:</b> {_day(inv['date'])}", right),
            Paragraph(f"<b>Order No:</b> {escape(inv['order_no'])}", right),
            Paragraph(f"<b>Order Date:</b> {_day(inv['order_date'])}", right)]
    head = Table([[brand_cell, meta]], colWidths=[110 * mm, 70 * mm])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, 0), 1.2, gold),
                              ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story += [head, Spacer(1, 8)]

    # ---- Bill To (the main shop); the shop's own details are already in the header
    b = inv["bill_to"]
    to_lines = [Paragraph("BILL TO", label), Paragraph(f"<b>{escape(b['name'])}</b>", ParagraphStyle("partyname", parent=small, fontSize=11, leading=14)),
                Paragraph(escape(b["address"]), small), Paragraph(f"Phone: {escape(b['phone'])}", small), Paragraph(escape(b["email"]), small)]
    parties = Table([[to_lines]], colWidths=[180 * mm])
    parties.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BOX", (0, 0), (-1, -1), 0.5, grey),
                                 ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fafafa")), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                                 ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10)]))
    story += [parties, Spacer(1, 10)]

    # ---- items
    rows = [["S.No", "Description", "Qty", "Rate", "Amount"]]
    for i in inv["items"]:
        spec = ", ".join(f"{s.get('label', '')}: {s.get('value', '')}" for s in i["spec"])
        cell = [Paragraph(f"<b>{escape(i['name'])}</b>", small)] + ([Paragraph(escape(spec), tiny)] if spec else [])
        rows.append([str(i["no"]), cell, f"{i['qty']:,}", f"{float(i['rate']):,.2f}" if i["rate"] else "-", f"{float(i['amount']):,.2f}" if i["amount"] else "-"])
    items = Table(rows, colWidths=[13 * mm, 87 * mm, 20 * mm, 28 * mm, 32 * mm], repeatRows=1)
    items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")), ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("GRID", (0, 0), (-1, -1), 0.4, grey),
        ("ALIGN", (2, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story += [items, Spacer(1, 10)]

    # ---- totals
    sums = []
    if inv["adjustment"]:
        sums += [("Sub Total", inv["subtotal"]), ("Price adjustment", inv["adjustment"])]
    sums.append(("Total Amount", inv["total"]))
    totals = Table([[k, _inr(v)] for k, v in sums], colWidths=[45 * mm, 38 * mm], hAlign="RIGHT")
    totals.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"), ("FONTSIZE", (0, -1), (-1, -1), 11),
                                ("LINEABOVE", (0, -1), (-1, -1), 0.8, colors.black), ("TOPPADDING", (0, 0), (-1, -1), 4)]))
    story += [totals, Spacer(1, 10)]

    # ---- payment
    p = inv["payment"]
    pay = [f"<b>Payment Status:</b> {p['status']}"]
    if p["method"]:
        pay.append(f"<b>Mode:</b> {escape(p['method'])}")
    if p["reference"]:
        pay.append(f"<b>Reference:</b> {escape(p['reference'])}")
    if p["paid_on"]:
        pay.append(f"<b>Paid on:</b> {_day(p['paid_on'])}")
    story += [Paragraph(" &nbsp;|&nbsp; ".join(pay), small), Spacer(1, 22)]

    # ---- signature
    sign = [Spacer(1, 18 * mm), Paragraph(f"For <b>{escape(seller['name']).upper()}</b>", right),
            Paragraph("Authorised Signatory", ParagraphStyle("auth", parent=right, fontSize=8, textColor=colors.HexColor("#6b7280")))]
    sign_box = Table([[sign]], colWidths=[60 * mm], hAlign="RIGHT")
    sign_box.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "RIGHT"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story += [sign_box, Spacer(1, 10), Paragraph("This is a computer-generated invoice.", tiny)]

    doc.build(story)
    response = HttpResponse(buf.getvalue(), content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{inv["filename"]}"'
    response["Cache-Control"] = "private, no-store"
    response["Access-Control-Expose-Headers"] = "Content-Disposition"
    return response
