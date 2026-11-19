"""The WebSocket every portal opens:  ws(s)://<host>/ws/notifications/?ticket=<ticket>

The server only pushes; the browser only answers {"type": "ping", "visible": true|false} (keeps the connection alive
through proxies and tells the server whether a tab of this account is on screen - see push.py).
"""
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth import get_user_model
from urllib.parse import parse_qs

from . import push
from .realtime import STAFF_GROUP, read_ticket, shop_group, vendor_group


@database_sync_to_async
def _mark_visible(uid):
    push.mark_visible(uid)  # never raises


@database_sync_to_async
def _groups_for(token):
    """Which groups this ticket's account may listen to. Empty list = refuse the connection."""
    uid = read_ticket(token)
    if not uid:
        return []
    user = get_user_model().objects.filter(pk=uid, is_active=True).first()
    if user is None:
        return []
    if user.is_staff or user.is_superuser:
        return [STAFF_GROUP]
    from .models import Shop
    from .vendor_models import Vendor
    vendor = Vendor.objects.filter(user=user, portal_access=True).first()
    if vendor is not None:
        return [vendor_group(vendor.pk)]
    shop = Shop.objects.filter(user=user, portal_access=True).first()
    if shop is not None:
        return [shop_group(shop.pk)]
    return []


class NotificationConsumer(AsyncJsonWebsocketConsumer):
    joined = ()
    uid = None

    async def connect(self):
        if self.channel_layer is None:
            await self.close()
            return
        token = (parse_qs(self.scope.get("query_string", b"").decode()).get("ticket") or [""])[0]
        groups = await _groups_for(token)
        if not groups:
            await self.close()  # refused (HTTP 403 on the handshake)
            return
        self.joined = tuple(groups)
        self.uid = read_ticket(token)
        for g in self.joined:
            await self.channel_layer.group_add(g, self.channel_name)
        await self.accept()
        await self.send_json({"type": "ready"})

    async def disconnect(self, code):
        for g in self.joined:
            await self.channel_layer.group_discard(g, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if isinstance(content, dict) and content.get("type") == "ping":
            if content.get("visible") is True and self.uid:
                await _mark_visible(self.uid)  # a tab is on screen: no email / push needed for what it already shows
            await self.send_json({"type": "pong"})

    # group_send(..., {"type": "push", "payload": {...}}) lands here
    async def push(self, event):
        await self.send_json(event["payload"])
