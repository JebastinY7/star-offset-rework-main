"""Contact Support for shops.

    GET  /api/shop/support/   -> {contact: {...}, orders: [{id, order_no, date}, ...]}   (orders = the shop's latest, for the "related order" picker)
    POST /api/shop/support/   {topic, message, order_id?}                                  -> emails Star Offset; replies go to the shop's email

Star Offset's contact details default to the ones printed on its invoices.  They can be changed without a
code change in the backend .env:  SUPPORT_PHONE, SUPPORT_WHATSAPP, SUPPORT_EMAIL, SUPPORT_ADDRESS, SUPPORT_HOURS.
Messages go to SUPPORT_EMAIL, else ORDER_EMAIL, else the company email below.
"""
import logging
import os

from django.conf import settings as django_settings
from django.core.cache import cache
from django.core.mail import EmailMessage
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import ShopOrder
from .shop_portal_api import IsShopUser

logger = logging.getLogger(__name__)

COMPANY = "Star Offset Printing"
DEFAULTS = {
    "phone": "+91 9488634058",
    "whatsapp": "+91 9488634058",
    "email": "staroffsets@gmail.com",
    "address": "1/116, Puthanchanthai Jn, Maruthancode Post, K.K District - 629163",
    "hours": "",  # shown only when set
}
TOPICS = {
    "order": "Help with an order",
    "pricing": "Pricing question",
    "artwork": "Artwork or files",
    "account": "Account or login",
    "other": "Something else",
}
MESSAGE_MAX = 1500
MESSAGE_MIN = 10
HOURLY_LIMIT = 5  # messages per shop per hour


def _contact():
    return {k: (os.getenv(f"SUPPORT_{k.upper()}") or v).strip() for k, v in DEFAULTS.items()}


@api_view(["GET", "POST"])
@permission_classes([IsShopUser])
def shop_support(request):
    shop = request.user.shop_profile
    contact = _contact()

    if request.method == "GET":
        recent = ShopOrder.objects.filter(shop=shop).order_by("-created_at", "-id")[:20]
        return Response({
            "contact": contact,
            "topics": [{"value": k, "label": v} for k, v in TOPICS.items()],
            "orders": [{"id": o.id, "order_no": o.order_no, "date": o.created_at.date().isoformat()} for o in recent],
        })

    d = request.data
    topic = d.get("topic")
    message = str(d.get("message") or "").strip()
    if topic not in TOPICS:
        return Response({"error": "Choose what your message is about."}, status=400)
    if len(message) < MESSAGE_MIN:
        return Response({"error": f"Please write a little more (at least {MESSAGE_MIN} characters)."}, status=400)
    if len(message) > MESSAGE_MAX:
        return Response({"error": f"Your message can be at most {MESSAGE_MAX} characters."}, status=400)

    order = None
    if d.get("order_id") not in (None, ""):
        try:
            order = ShopOrder.objects.filter(shop=shop, pk=int(d.get("order_id"))).first()
        except (TypeError, ValueError):
            order = None
        if order is None:
            return Response({"error": "That order was not found."}, status=400)

    # best-effort brake on spam (per shop, per hour)
    limit_key = f"shop-support:{shop.pk}"
    sent = cache.get(limit_key, 0)
    if sent >= HOURLY_LIMIT:
        return Response({"error": "You have sent several messages in the last hour. Please wait a little, or call us."}, status=429)

    to_addr = os.getenv("SUPPORT_EMAIL") or os.getenv("ORDER_EMAIL") or DEFAULTS["email"]
    body = "\n".join([
        f"SUPPORT MESSAGE - {TOPICS[topic]}", "",
        f"Shop: {shop.name} (SHOP-{shop.id:04d})",
        f"Contact person: {shop.owner_name}",
        f"Phone: {shop.phone}",
        f"Email: {shop.email}",
        f"Related order: {order.order_no if order else 'None'}", "",
        message,
    ])
    msg = EmailMessage(f"Shop support: {TOPICS[topic]} - {shop.name}", body, getattr(django_settings, "DEFAULT_FROM_EMAIL", None),
                       [to_addr], reply_to=[shop.email] if shop.email else None)
    try:
        msg.send(fail_silently=False)
    except Exception:
        logger.exception("Could not send the shop support message")
        return Response({"error": "Your message could not be sent. Please try again, or call us."}, status=502)

    cache.set(limit_key, sent + 1, 3600)
    return Response({"ok": True})