"""Place Order - emails a shop's complete order, with the artwork files attached, to Star Offset.

    POST /api/shop/orders/email/   multipart/form-data
        items          JSON list  [{"params": {...}}, ...]   (same cart items used by /api/shop/requests/)
        delivery_date  text (optional)
        instructions   text (optional)
        files_0, files_1 ...   artwork files of item 1, item 2, ... (0..MAX_FILES files in total)

As with shop_requests_api, the browser's cart is only a list of choices: item names, specifications and
estimates are rebuilt here from the price tables, so an edited cart can never change what is emailed.

Settings (.env):  ORDER_EMAIL = address that receives orders (falls back to DEFAULT_FROM_EMAIL).
Mail itself uses the existing EMAIL_* settings.
"""
import json
import logging
from datetime import date
import os
from decimal import Decimal
from pathlib import Path

from django.conf import settings as django_settings
from django.core.mail import EmailMessage
from django.db import transaction
from django.utils import timezone
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from .artwork import delete_artwork, save_artwork
from .models import ShopOrder, ShopOrderItem, ShopWallet, ShopWalletTransaction
from .notification_models import notify
from .shop_portal_api import IsShopUser
from .shop_pricing_api import _qty, describe, estimate_for
from .shop_requests_api import MAX_ITEMS, _clean
from .visiting_card_pricing import calculate_visiting_card_price

logger = logging.getLogger(__name__)

MAX_FILES = 10
MAX_TOTAL_BYTES = 20 * 1024 * 1024  # most mail servers reject messages above ~25 MB
ALLOWED_EXT = {
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".tif", ".tiff", ".bmp", ".svg",
    ".psd", ".ai", ".eps", ".cdr", ".indd", ".zip", ".rar", ".7z",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt",
}


def _money(v):
    return f"Rs. {Decimal(v):,.2f}"


@api_view(["POST"])
@permission_classes([IsShopUser])
@parser_classes([MultiPartParser, FormParser])
def shop_order_email(request):
    to_addr = os.getenv("ORDER_EMAIL") or getattr(django_settings, "DEFAULT_FROM_EMAIL", None)
    if not to_addr:
        return Response({"error": "Order email is not configured on the server. Please contact Star Offset."}, status=500)

    # ---- items (rebuilt from the database)
    try:
        raw_items = json.loads(request.data.get("items") or "[]")
    except ValueError:
        raw_items = []
    if not isinstance(raw_items, list) or not raw_items:
        return Response({"error": "Your order cart is empty."}, status=400)
    if len(raw_items) > MAX_ITEMS:
        return Response({"error": f"An order can have at most {MAX_ITEMS} items."}, status=400)

    # ---- artwork files, grouped per item (files_0 belongs to the first item, files_1 to the second, ...)
    item_files = [request.FILES.getlist(f"files_{n}") for n in range(len(raw_items))]
    all_files = [f for group in item_files for f in group]
    if len(all_files) > MAX_FILES:
        return Response({"error": f"You can attach at most {MAX_FILES} files to an order."}, status=400)
    if sum(f.size for f in all_files) > MAX_TOTAL_BYTES:
        return Response({"error": f"Artwork files are too large. Keep the total under {MAX_TOTAL_BYTES // (1024 * 1024)} MB."}, status=400)
    for f in all_files:
        if Path(f.name).suffix.lower() not in ALLOWED_EXT:
            return Response({"error": f"'{f.name}' is not an accepted artwork file type."}, status=400)

    lines, rows, total, any_price = [], [], Decimal(0), False
    for n, raw in enumerate(raw_items, start=1):
        raw_params = raw.get("params") if isinstance(raw, dict) and isinstance(raw.get("params"), dict) else {}
        if raw_params.get("kind") == "visiting":
            vc = raw_params.get("visiting_card") or {}
            try:
                qty = int(vc.get("qty") or raw.get("qty") or 0)
            except (TypeError, ValueError):
                qty = 0
            if qty < 1 or qty > 1000000:
                return Response({"error": f"Item {n}: enter a valid visiting card quantity."}, status=400)
            name = "Visiting Card"
            spec = raw.get("spec") if isinstance(raw, dict) and isinstance(raw.get("spec"), list) else []
            if not spec:
                spec = [{"label": "Printing Method", "value": str(vc.get("method") or "").title()}]
                if vc.get("method") != "offset":
                    spec.extend([
                        {"label": "GSM", "value": vc.get("gsm", "")},
                        {"label": "Size", "value": vc.get("size", "")},
                    ])
                spec.extend([
                    {"label": "Print Variant", "value": "Single side" if vc.get("sides") == "single" else "Double side"},
                    {"label": "Lamination", "value": vc.get("lamination", "Without Lamination")},
                ])
                if vc.get("method") == "offset":
                    spec.append({"label": "Jobs", "value": str(vc.get("jobs") or 1)})
                if vc.get("designNotes"):
                    spec.append({"label": "Design notes", "value": str(vc["designNotes"])[:500]})
            spec = [x for x in spec if isinstance(x, dict) and x.get("label") and x.get("value")]
            params = {"kind": "visiting", "qty": qty, "visiting_card": vc}
            try:
                price_result = calculate_visiting_card_price(
                    gsm=vc.get("gsm"), size=vc.get("size"), qty=qty,
                    sides=vc.get("sides", "single"), price_type="shop",
                    method=vc.get("method"), lamination=vc.get("lamination", "Without Lamination"), jobs=vc.get("jobs", 1),
                )
            except ValueError as exc:
                return Response({"error": f"Item {n}: {exc}"}, status=400)
            est = Decimal(price_result["total"])
            total += est
            any_price = True
        else:
            params = _clean(raw)
            found = describe(params) if params else None
            if not found or _qty(params) is None:
                return Response({"error": f"Item {n} is no longer available. Please remove it from your cart and add it again."}, status=400)
            name, spec = found
            est = None
        # DTP production preferences are user-entered metadata, never pricing inputs.
        # Validate and store them per item so the ERP order view and email show them.
        if name.strip().casefold() == "dtp":
            details = raw.get("dtp_details") if isinstance(raw, dict) else None
            if not isinstance(details, dict):
                return Response({"error": f"Item {n}: specify DTP font, size and language."}, status=400)
            font = str(details.get("font_family") or "").strip()[:100]
            language = str(details.get("language") or "").strip()[:40]
            notes = str(details.get("notes") or "").strip()[:500]
            try:
                font_size = Decimal(str(details.get("font_size") or ""))
                valid_size = font_size.is_finite() and Decimal("1") <= font_size <= Decimal("200")
            except (ValueError, ArithmeticError):
                valid_size = False
            if not font or not language or not valid_size:
                return Response({"error": f"Item {n}: enter a valid DTP font, font size (1–200 pt) and language."}, status=400)
            spec = [*spec, {"label": "Preferred Font", "value": font},
                    {"label": "Font Size", "value": f"{font_size.normalize()} pt"},
                    {"label": "Language", "value": language}]
            if notes:
                spec.append({"label": "DTP Instructions", "value": notes})
        if params["kind"] != "visiting":
            price = estimate_for(params)
            est = price["estimate"] if price["available"] else None
            if est is None:
                return Response({"error": f"A final price is not available for {name}. Please contact Star Offset before placing this order."}, status=400)
            total += Decimal(est)
            any_price = True
        names = [f.name for f in item_files[n - 1]]
        rows.append({"kind": params["kind"], "service_name": name, "spec": spec, "params": params, "qty": int(params["qty"]),
                     "estimate": Decimal(est) if est is not None else None,
                     "files": [{"name": f.name, "size": f.size} for f in item_files[n - 1]]})
        lines.append("\n".join([
            f"Item {n}: {name}",
            f"Quantity: {int(params['qty']):,}",
            "Specifications: " + (", ".join(f"{s['label']}: {s['value']}" for s in spec) or "Not specified"),
            "Final price: " + (_money(est) if est is not None else "To be quoted"),
            "Artwork files: " + (", ".join(names) if names else "None"),
        ]))

    # ---- save the order, debit the wallet atomically, and email it; if email fails the transaction rolls back
    shop = request.user.shop_profile
    delivery_raw = (request.data.get("delivery_date") or "").strip()[:10]
    try:
        delivery_on = date.fromisoformat(delivery_raw) if delivery_raw else None
    except ValueError:
        delivery_on = None
    delivery = delivery_on.strftime("%d %b %Y") if delivery_on else "Not specified"
    notes_raw = (request.data.get("instructions") or "").strip()[:2000]
    notes = notes_raw or "None"

    saved_paths = []  # private copies of the artwork; removed again if the order fails
    try:
        with transaction.atomic():
            has_unpriced = any(row.get("estimate") is None for row in rows)
            if has_unpriced:
                # Never debit the shop wallet for a cart containing an unpriced item.
                order = ShopOrder.objects.create(shop=shop, items_count=len(rows), total_amount=Decimal("0"), final_amount=None,
                    status="submitted", payment_method="", payment_reference="",
                    delivery_date=delivery_on, instructions=notes_raw)
            else:
                wallet, _ = ShopWallet.objects.get_or_create(shop=shop)
                wallet = ShopWallet.objects.select_for_update().get(pk=wallet.pk)
                if wallet.balance < total:
                    raise ValueError(f"Insufficient wallet balance. Order total is ₹{total:,.2f}; wallet balance is ₹{wallet.balance:,.2f}. Add money to your wallet and try again.")
                wallet.balance -= total
                wallet.save(update_fields=["balance", "updated_at"])
                order = ShopOrder.objects.create(shop=shop, items_count=len(rows), total_amount=total, final_amount=total,
                    status="payment_confirmed", payment_method="wallet", payment_reference="Wallet debit pending", payment_confirmed_at=timezone.now(),
                    delivery_date=delivery_on, instructions=notes_raw)
                ShopWalletTransaction.objects.create(wallet=wallet, kind="debit", amount=total, status="completed",
                    reference=f"ORD-{order.id:04d}", description=f"Payment for printing order ORD-{order.id:04d}", completed_at=timezone.now())
                order.payment_reference = f"WALLET-ORD-{order.id:04d}"
                order.save(update_fields=["payment_reference", "updated_at"])
            for n, row in enumerate(rows, start=1):
                row["files"] = [save_artwork(order.order_no, n, f) for f in item_files[n - 1]]
                saved_paths += [f["path"] for f in row["files"]]
                ShopOrderItem.objects.create(order=order, **row)
            notify("shop_order", "New shop order", f"{shop.name} placed {order.order_no} - {len(rows)} item{'' if len(rows) == 1 else 's'} - {_money(total)}",
                   f"/shop-orders/{order.id}")

            body = "\n".join([
                f"PRINTING ORDER {order.order_no}", "",
                f"Payment status: Paid from wallet",
                f"Shop: {shop.name}",
                f"Username: {shop.user.username}",
                f"Phone: {shop.phone or 'Not available'}",
                f"Number of items: {len(lines)}", "",
                *[part for line in lines for part in (line, "")],
                f"Final total: {'To be quoted' if any(row.get('estimate') is None for row in rows) else _money(total)}",
                f"Payment: {'Pending quote and confirmation' if any(row.get('estimate') is None for row in rows) else 'Paid from shop wallet'}",
                f"Required delivery date: {delivery}",
                f"Additional instructions: {notes}",
                f"Artwork files attached: {len(all_files)} (named Item<number>_<file name>)",
            ])
            subject = f"Printing Order {order.order_no} - {shop.name} - {len(lines)} item{'' if len(lines) == 1 else 's'}"
            msg = EmailMessage(subject, body, getattr(django_settings, "DEFAULT_FROM_EMAIL", None), [to_addr],
                               reply_to=[shop.email] if shop.email else None)
            for n, group in enumerate(item_files, start=1):
                for f in group:
                    msg.attach(f"Item{n}_{f.name}", f.read(), f.content_type or "application/octet-stream")
            msg.send(fail_silently=False)
    except ValueError as exc:
        delete_artwork(saved_paths)
        return Response({"error": str(exc)}, status=400)
    except Exception:
        delete_artwork(saved_paths)
        logger.exception("Could not place the shop order")
        return Response({"error": "The order could not be sent. Please try again in a moment."}, status=502)

    return Response({"ok": True, "id": order.id, "order_no": order.order_no, "items": len(lines), "files": len(all_files), "final_amount": str(total), "status": order.status}, status=201)