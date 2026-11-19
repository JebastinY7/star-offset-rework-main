"""Live delivery over WebSockets (Django Channels).

Who listens (one socket per browser tab, see consumers.py):
    "staff"        every admin / staff account
    "shop.<id>"    one shop's portal
    "vendor.<id>"  one vendor's portal

Everything here NEVER raises: a push problem must not break an order, a payment or a vendor update.
Pushes are sent only after the database transaction commits, so the browser never hears about a
change that was rolled back (and an instant re-fetch always finds the new data).
"""
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core import signing
from django.db import transaction

logger = logging.getLogger(__name__)

STAFF_GROUP = "staff"
TICKET_SALT = "star-admin-ws-ticket"
TICKET_MAX_AGE = 60  # seconds - a ticket is only needed for the moment the socket connects


def shop_group(shop_id):
    return f"shop.{shop_id}"


def vendor_group(vendor_id):
    return f"vendor.{vendor_id}"


# ---------------------------------------------------------------- connection tickets
# The browser asks the normal (session-protected) API for a short-lived ticket, then opens the socket with it.
# This works even when the portal and the API are on different domains (cookies would not travel to the
# socket), and a foreign website cannot read a ticket, so it needs no origin check.
def make_ticket(user):
    return signing.dumps({"uid": user.pk}, salt=TICKET_SALT)


def read_ticket(token):
    """-> user id, or None when the ticket is missing, forged or older than TICKET_MAX_AGE."""
    try:
        return signing.loads(token or "", salt=TICKET_SALT, max_age=TICKET_MAX_AGE).get("uid")
    except signing.BadSignature:
        return None


# ---------------------------------------------------------------- sending
def _send_now(group, payload):
    try:
        layer = get_channel_layer()
        if layer is not None:
            async_to_sync(layer.group_send)(group, {"type": "push", "payload": payload})
    except Exception:  # noqa: BLE001
        logger.exception("Live push to %s failed", group)


def _push(group, payload):
    try:
        transaction.on_commit(lambda: _send_now(group, payload))
    except Exception:  # noqa: BLE001
        logger.exception("Could not queue live push to %s", group)


def push_staff(payload):
    _push(STAFF_GROUP, payload)


def push_shop(shop_id, payload):
    _push(shop_group(shop_id), payload)


def push_vendor(vendor_id, payload):
    _push(vendor_group(vendor_id), payload)
