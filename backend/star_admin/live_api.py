"""Live-notification endpoints.

    GET  /api/{admin|shop|vendor}/ws-ticket/   {ticket}   short-lived ticket for opening the WebSocket
    GET  /api/shop/notifications/               {unread, results:[{id, kind, title, message, link, created_at, read}]}  (latest 30)
    POST /api/shop/notifications/read/          {id: 5}  or  {all: true}   -> {unread}

(The ws-ticket is routed under all three prefixes because shop / vendor accounts are fenced to their own /api/<kind>/.)
"""
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .notification_models import ShopNotification
from .realtime import TICKET_MAX_AGE, make_ticket
from .shop_portal_api import IsShopUser

LATEST = 30


@api_view(["GET"])
def ws_ticket(request):
    resp = Response({"ticket": make_ticket(request.user), "expires_in": TICKET_MAX_AGE})
    resp["Cache-Control"] = "no-store"
    return resp


def _unread(shop):
    return ShopNotification.objects.filter(shop=shop, read_at__isnull=True).count()


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_notifications(request):
    shop = request.user.shop_profile
    rows = ShopNotification.objects.filter(shop=shop)[:LATEST]
    return Response({"unread": _unread(shop), "results": [n.as_row() for n in rows]})


@api_view(["POST"])
@permission_classes([IsShopUser])
def shop_notifications_read(request):
    shop = request.user.shop_profile
    unread = ShopNotification.objects.filter(shop=shop, read_at__isnull=True)
    if request.data.get("all") in (True, "true", "True", 1, "1"):
        unread.update(read_at=timezone.now())
    else:
        if not ShopNotification.objects.filter(shop=shop, pk=request.data.get("id")).exists():
            return Response({"error": "Notification not found."}, status=404)
        unread.filter(pk=request.data.get("id")).update(read_at=timezone.now())
    return Response({"unread": _unread(shop)})
