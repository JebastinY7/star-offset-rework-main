"""Shop Profile: a shop views its registered details and edits its own contact details.

    GET   /api/shop/profile/   -> {profile: {...}}
    PATCH /api/shop/profile/   {owner_name?, phone?, email?, address?, gst_number?}

The shop name, shop ID, account status and username are managed by Star Offset and cannot be changed here.
The same validation rules as the admin's shop form are used, so a shop cannot save anything an admin could not.
"""
from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .shop_portal_api import IsShopUser
from .shops_api import ADDRESS_MAX, OWNER_MAX, _clean_email, _clean_gst, _clean_phone, _multiline, _text

EDITABLE = ("owner_name", "phone", "email", "address", "gst_number")


def _profile(shop):
    return {
        "shop_name": shop.name,
        "shop_id": f"SHOP-{shop.id:04d}",
        "status": "Active" if shop.user.is_active and shop.portal_access else "Inactive",
        "owner_name": shop.owner_name,
        "phone": shop.phone,
        "email": shop.email,
        "address": shop.address,
        "gst_number": shop.gst_number,
        "username": shop.user.username,
        "member_since": shop.created_at.date().isoformat(),
    }


@api_view(["GET", "PATCH"])
@permission_classes([IsShopUser])
def shop_profile(request):
    shop = request.user.shop_profile
    user = shop.user

    if request.method == "PATCH":
        d = request.data
        try:
            if "owner_name" in d:
                shop.owner_name = _text(d.get("owner_name"), "Contact person", OWNER_MAX, required=True)
            if "phone" in d:
                shop.phone = _clean_phone(d.get("phone"), shop.pk)
            if "email" in d:
                shop.email = _clean_email(d.get("email"), user.pk, shop.pk)
                user.email = shop.email
            if "address" in d:
                shop.address = _multiline(d.get("address"), "Shop address", ADDRESS_MAX)
            if "gst_number" in d:
                shop.gst_number = _clean_gst(d.get("gst_number"))
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        with transaction.atomic():
            user.save(update_fields=["email"])
            shop.save(update_fields=["owner_name", "phone", "email", "address", "gst_number"])

    return Response({"profile": _profile(shop)})