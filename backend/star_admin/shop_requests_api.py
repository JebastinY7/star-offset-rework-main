"""Quotation requests a shop sends from its cart.

    POST /api/shop/requests/   {items: [{kind, qty, ...ids}, ...]}  -> {request: {...}}

The browser's cart is only a list of choices.  Everything that matters is rebuilt here: the name and
specification come from the price tables and the estimate is recalculated with the shop's own rates,
so an edited / stale cart can never submit a wrong price.  A shop only ever creates its own requests.
"""
import uuid
from decimal import Decimal

from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import ShopQuotationRequest, ShopQuotationRequestItem
from .shop_portal_api import IsShopUser
from .shop_pricing_api import _qty, describe, estimate_for

MAX_ITEMS = 50
# only these keys are kept from the browser's item, and only as ids
PARAM_KEYS = {
    "normal": ("kind", "service_id", "size_id", "variant_id", "qty"),
    "digital": ("kind", "lamination_id", "side", "delivery_id", "qty"),
}


def _clean(raw):
    """Browser item -> params dict (ids / qty only), or None."""
    params = raw.get("params") if isinstance(raw, dict) else None
    if not isinstance(params, dict) or params.get("kind") not in PARAM_KEYS:
        return None
    return {k: params.get(k) for k in PARAM_KEYS[params["kind"]] if params.get(k) not in (None, "")} | {"kind": params["kind"]}


@api_view(["POST"])
@permission_classes([IsShopUser])
def shop_request_create(request):
    raw_items = request.data.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        return Response({"error": "Your cart is empty."}, status=400)
    if len(raw_items) > MAX_ITEMS:
        return Response({"error": f"A request can have at most {MAX_ITEMS} items. Please split it into two."}, status=400)

    lines = []
    for n, raw in enumerate(raw_items, start=1):
        params = _clean(raw)
        found = describe(params) if params else None
        if not found or _qty(params) is None:
            return Response({"error": f"Item {n} is no longer available. Please remove it from your cart and add it again."}, status=400)
        price = estimate_for(params)
        lines.append((params, found, price["estimate"] if price["available"] else None))

    with transaction.atomic():
        req = ShopQuotationRequest.objects.create(
            shop=request.user.shop_profile,
            request_no=f"TMP-{uuid.uuid4().hex[:12]}",  # replaced below, once the id is known
            items_count=len(lines),
            total_amount=sum((Decimal(e) for _, _, e in lines if e is not None), Decimal(0)),
        )
        req.request_no = f"QR-{req.id:05d}"
        req.save(update_fields=["request_no"])
        ShopQuotationRequestItem.objects.bulk_create([
            ShopQuotationRequestItem(request=req, kind=params["kind"], service_name=name, spec=spec,
                                     params=params, qty=int(params["qty"]), estimate=est)
            for params, (name, spec), est in lines
        ])

    return Response({"request": {
        "id": req.id, "request_no": req.request_no, "items": req.items_count,
        "amount": str(req.total_amount), "unpriced": sum(1 for _, _, e in lines if e is None),
    }}, status=201)
