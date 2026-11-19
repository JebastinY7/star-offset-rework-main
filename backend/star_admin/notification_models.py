"""Bell-icon notifications for Star Offset staff (Admin top bar).

Four things create one:
  * a customer sends a WhatsApp message -> kind "whatsapp_message" (live_events.py)
  * a shop places an order            -> kind "shop_order"   (shop_orders_api.py)
  * a vendor marks a job Ready        -> kind "vendor_ready" (vendor_portal_api.py)
  * a vendor answers a price request  -> kind "vendor_quote" (vendor_portal_api.py)
Read / unread is kept per staff user (read_by), so one person reading it does not hide it from the others.

Every notification is also pushed over the WebSocket (star_admin/realtime.py), so the bell updates at once,
and sent as a Web Push / fallback email for people whose portal is closed (star_admin/push.py).
Shops get their own bell (ShopNotification below): order status changes and wallet credits (see live_events.py).
"""
import datetime
import logging

from django.contrib.auth.models import User
from django.db import models
from django.utils import timezone

from . import push, realtime

logger = logging.getLogger(__name__)
KEEP_DAYS = 60


class AdminNotification(models.Model):
    KIND_CHOICES = [("whatsapp_message", "WhatsApp message"), ("shop_order", "New shop order"), ("vendor_ready", "Vendor job ready for pickup"), ("vendor_quote", "Vendor price quote")]

    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    title = models.CharField(max_length=120)
    message = models.CharField(max_length=300, blank=True, default="")
    link = models.CharField(max_length=200, blank=True, default="")  # front-end route to open on click
    created_at = models.DateTimeField(auto_now_add=True)
    read_by = models.ManyToManyField(User, related_name="read_notifications", blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.title} - {self.message}"

    def as_row(self, read=False):
        return {"id": self.id, "kind": self.kind, "title": self.title, "message": self.message, "link": self.link,
                "created_at": self.created_at.isoformat(), "read": read}


class ShopNotification(models.Model):
    """Bell-icon notification for ONE shop (Shop Portal top bar). Read / unread is per shop."""
    shop = models.ForeignKey("star_admin.Shop", on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(max_length=20)  # order_status / wallet
    title = models.CharField(max_length=120)
    message = models.CharField(max_length=300, blank=True, default="")
    link = models.CharField(max_length=200, blank=True, default="")  # shop-portal route to open on click
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.shop_id}: {self.title}"

    def as_row(self):
        return {"id": self.id, "kind": self.kind, "title": self.title, "message": self.message, "link": self.link,
                "created_at": self.created_at.isoformat(), "read": self.read_at is not None}


def notify(kind, title, message="", link=""):
    """Create a notification. Never raises: a notification problem must not break an order or a vendor update."""
    try:
        n = AdminNotification.objects.create(kind=kind, title=title[:120], message=message[:300], link=link[:200])
        AdminNotification.objects.filter(created_at__lt=timezone.now() - datetime.timedelta(days=KEEP_DAYS)).delete()
        realtime.push_staff({"type": "notification", "notification": n.as_row()})  # instant bell + toast
        push.dispatch(("staff",), kind, n.title, n.message, n.link, ref=n.pk)  # Web Push, else email (portal closed)
    except Exception:  # noqa: BLE001
        logger.exception("Could not create notification")


def notify_shop(shop_id, kind, title, message="", link=""):
    """Create a notification for one shop and push it to that shop's open portal. Never raises."""
    try:
        n = ShopNotification.objects.create(shop_id=shop_id, kind=kind, title=title[:120], message=message[:300], link=link[:200])
        ShopNotification.objects.filter(shop_id=shop_id, created_at__lt=timezone.now() - datetime.timedelta(days=KEEP_DAYS)).delete()
        realtime.push_shop(shop_id, {"type": "notification", "notification": n.as_row()})
        push.dispatch(("shop", shop_id), kind, n.title, n.message, n.link, ref=n.pk)  # Web Push, else email (portal closed)
    except Exception:  # noqa: BLE001
        logger.exception("Could not create shop notification")