"""Shop Portal logo: the picture shown at the top of the shop's sidebar.

    GET    /api/shop/logo/   -> the image itself (404 when the shop has none)
    POST   /api/shop/logo/   multipart form, field "logo" (png / jpg / webp / gif, up to 2 MB) -> {logo_url}
    DELETE /api/shop/logo/   remove it -> {logo_url: ""}

Only the shop itself can read or change its own logo (IsShopUser + request.user.shop_profile).  SVG is not
accepted on purpose: it can carry scripts.  The type is decided from the file's first bytes, not from the
file name or the browser's claim.  The bytes live in the database (ShopLogo), so they are not lost when the
Railway container is rebuilt.
"""
from django.http import HttpResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import ShopLogo
from .shop_portal_api import IsShopUser, logo_url

MAX_BYTES = 2 * 1024 * 1024


def _sniff(head):
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return ""


@api_view(["GET", "POST", "DELETE"])
@permission_classes([IsShopUser])
def shop_logo(request):
    shop = request.user.shop_profile

    if request.method == "GET":
        logo = ShopLogo.objects.filter(shop=shop).first()
        if logo is None:
            return Response({"error": "No logo."}, status=404)
        resp = HttpResponse(bytes(logo.data), content_type=logo.content_type)
        resp["Cache-Control"] = "private, max-age=86400"
        resp["X-Content-Type-Options"] = "nosniff"
        return resp

    if request.method == "DELETE":
        ShopLogo.objects.filter(shop=shop).delete()
        return Response({"logo_url": ""})

    f = request.FILES.get("logo")
    if f is None:
        return Response({"error": "Choose an image to upload."}, status=400)
    if f.size > MAX_BYTES:
        return Response({"error": "The logo must be 2 MB or smaller."}, status=400)
    data = f.read()
    kind = _sniff(data[:16])
    if not kind:
        return Response({"error": "Upload a PNG, JPG, WebP or GIF image."}, status=400)
    ShopLogo.objects.update_or_create(shop=shop, defaults={"content_type": kind, "data": data})
    return Response({"logo_url": logo_url(shop)})
