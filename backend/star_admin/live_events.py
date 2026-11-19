"""Turns database changes into instant pushes, without touching the existing API code.

    shop order moves to a new status   -> that shop's bell + toast
    shop wallet payment completes      -> that shop's bell + toast, and its balance refreshes
    vendor is asked for a price / given work / job cancelled or completed -> that vendor's toast + list refresh
    customer WhatsApp message arrives  -> staff WhatsApp badge refreshes + a bell notification
(Staff bell notifications are created by notify() in notification_models.py and pushed there.)

Connected from StarAdminConfig.ready(). Every handler swallows its own errors: a live-update problem must never
stop an order, payment or job from saving.
"""
import logging

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from . import push, realtime
from .models import ShopOrder, ShopWalletTransaction, WhatsappMessage
from .notification_models import notify, notify_shop
from .vendor_models import VendorJob

logger = logging.getLogger(__name__)


def _money(v):
    return f"₹{float(v or 0):,.2f}"


def _remember_status(sender, instance, raw=False, **kwargs):
    """Keep the status the row had before this save, so post_save can tell whether it changed."""
    instance._old_status = None
    if raw or instance.pk is None:
        return
    try:
        instance._old_status = sender.objects.filter(pk=instance.pk).values_list("status", flat=True).first()
    except Exception:  # noqa: BLE001
        logger.exception("Could not read previous status")


for _model in (ShopOrder, ShopWalletTransaction, VendorJob):
    pre_save.connect(_remember_status, sender=_model, dispatch_uid=f"live_old_status_{_model.__name__}")


# ------------------------------------------------------------------ shop orders
ORDER_TEXT = {
    "awaiting_payment": ("Payment needed", "{no} is awaiting payment - final amount {amount}."),
    "payment_confirmed": ("Payment confirmed", "Payment for {no} is confirmed."),
    "in_production": ("Order in production", "{no} is now in production."),
    "ready": ("Order ready", "{no} is ready for pickup."),
    "completed": ("Order completed", "{no} is completed. Thank you!"),
    "cancelled": ("Order cancelled", "{no} was cancelled."),
}


@receiver(post_save, sender=ShopOrder, dispatch_uid="live_shop_order")
def shop_order_saved(sender, instance, created, raw=False, **kwargs):
    try:
        old = getattr(instance, "_old_status", None)
        if raw or created or old is None or old == instance.status or instance.status not in ORDER_TEXT:
            return
        title, text = ORDER_TEXT[instance.status]
        amount = instance.final_amount if instance.final_amount is not None else instance.total_amount
        notify_shop(instance.shop_id, "order_status", title,
                    text.format(no=instance.order_no, amount=_money(amount)), f"/orders/{instance.pk}")
    except Exception:  # noqa: BLE001
        logger.exception("Live shop-order event failed")


# ------------------------------------------------------------------ shop wallet
@receiver(post_save, sender=ShopWalletTransaction, dispatch_uid="live_wallet_txn")
def wallet_txn_saved(sender, instance, created, raw=False, **kwargs):
    try:
        if raw or instance.status != "completed" or getattr(instance, "_old_status", None) == "completed":
            return
        shop_id = instance.wallet.shop_id
        realtime.push_shop(shop_id, {"type": "wallet"})  # balance changed: the portal re-reads it
        if instance.kind == "credit" and instance.description != "Online payment for order":
            notify_shop(shop_id, "wallet", "Wallet credited", f"{_money(instance.amount)} was added to your wallet.", "/wallet")
        elif instance.kind == "refund":
            notify_shop(shop_id, "wallet", "Refund received", f"{_money(instance.amount)} was refunded to your wallet.", "/wallet")
    except Exception:  # noqa: BLE001
        logger.exception("Live wallet event failed")


# ------------------------------------------------------------------ vendor jobs
@receiver(post_save, sender=VendorJob, dispatch_uid="live_vendor_job")
def vendor_job_saved(sender, instance, created, raw=False, **kwargs):
    try:
        old, new = getattr(instance, "_old_status", None), instance.status
        if raw or old == new:
            return
        ref = f"{instance.job_no} ({instance.order_no})"
        if new == "enquiry" and created:
            event = ("price_request", "New price request", f"{ref} - please send your price.", "/price-requests")
        elif new == "countered":
            price = f" Rs. {instance.counter_price:,.2f}" if instance.counter_price is not None else ""
            event = ("price_counter", "Counter offer received", f"Star Offset offered{price} for {ref} - accept it or send a new price.", "/price-requests")
        elif new == "assigned":
            text = f"Your price was accepted. {ref} is now yours." if old in ("enquiry", "quoted", "countered") else f"{ref} has been given to you."
            event = ("new_work", "New work assigned", text, f"/assigned/{instance.pk}")
        elif new in ("cancelled", "completed") and not created:
            event = ("job_closed", f"Job {new}", f"{ref} was marked {new}.", "/history")
        else:
            return
        kind, title, message, link = event
        realtime.push_vendor(instance.vendor_id, {"type": "vendor_event", "kind": kind, "title": title, "message": message, "link": link})
        push.dispatch(("vendor", instance.vendor_id), kind, title, message, link, ref=instance.pk)  # Web Push, else email
    except Exception:  # noqa: BLE001
        logger.exception("Live vendor-job event failed")


# ------------------------------------------------------------------ WhatsApp
@receiver(post_save, sender=WhatsappMessage, dispatch_uid="live_whatsapp_in")
def whatsapp_saved(sender, instance, created, raw=False, **kwargs):
    if created and not raw and instance.direction == "in":
        try:
            realtime.push_staff({"type": "messages"})  # the Messages badge re-counts
            # ...and the message also appears in the top-bar bell (opening the chat clears it)
            who = (instance.customer.name if instance.customer_id and instance.customer.name else "") or instance.phone
            kind = (instance.message_type or "text").lower()
            text = (instance.body or "").strip() or ("Sent a " + kind if kind != "text" else "New message")
            notify("whatsapp_message", f"WhatsApp: {who}", text, f"/messages/{instance.phone}")
        except Exception:  # noqa: BLE001
            logger.exception("Live WhatsApp event failed")
