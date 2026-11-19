"""Web Push + email fallback tests:  python manage.py test star_admin.test_push"""
import base64
import os
from unittest import mock

from channels.db import database_sync_to_async
from channels.testing import WebsocketCommunicator
from channels.routing import URLRouter
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from django.contrib.auth.models import User
from django.core import mail
from django.core.management import call_command
from django.test import TransactionTestCase, override_settings
from io import StringIO
from pywebpush import WebPushException
from rest_framework.test import APIClient

from . import push
from .models import Shop
from .notification_models import notify, notify_shop
from .push_models import LivePresence, PushSubscription
from .realtime import make_ticket
from .routing import websocket_urlpatterns
from .vendor_models import Vendor

LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
FCM = "https://fcm.googleapis.com/fcm/send/abc123"


def _b64(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _keys():
    """A real VAPID key pair in the format `generate_vapid_keys` prints."""
    out = StringIO()
    call_command("generate_vapid_keys", stdout=out)
    vals = dict(l.split("=", 1) for l in out.getvalue().splitlines() if l.startswith("VAPID_"))
    return vals["VAPID_PUBLIC_KEY"], vals["VAPID_PRIVATE_KEY"]


def _browser_keys():
    """What a browser would send as keys{p256dh, auth}."""
    k = ec.generate_private_key(ec.SECP256R1())
    pub = k.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return _b64(pub), _b64(os.urandom(16))


PUB, PRIV = _keys()
BASE = dict(VAPID_PUBLIC_KEY=PUB, VAPID_PRIVATE_KEY=PRIV, VAPID_CLAIM_SUB="mailto:t@x.com", NOTIFY_ASYNC=False,
            NOTIFY_EMAIL_FALLBACK=True, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
            SHOP_PORTAL_URL="https://shop.test", ADMIN_PORTAL_URL="https://admin.test", CHANNEL_LAYERS=LAYERS)


@override_settings(**BASE)
class DeliveryTests(TransactionTestCase):
    def setUp(self):
        self.shop_user = User.objects.create_user("shopper", password="x")
        self.shop = Shop.objects.create(user=self.shop_user, name="Shop A", owner_name="A", phone="9000000001", email="a@x.com")
        self.staff = User.objects.create_user("boss", password="x", is_staff=True, email="boss@x.com")

    def _sub(self, user, endpoint=FCM):
        p256dh, auth = _browser_keys()
        return PushSubscription.objects.create(user=user, endpoint=endpoint, p256dh=p256dh, auth=auth)

    def test_push_delivered_no_email(self):
        self._sub(self.shop_user)
        with mock.patch("pywebpush.webpush") as wp:
            notify_shop(self.shop.pk, "order_status", "Order ready", "ORD-1 is ready for pickup.", "/orders/1")
        self.assertEqual(wp.call_count, 1)
        kw = wp.call_args.kwargs
        self.assertEqual(kw["subscription_info"]["endpoint"], FCM)
        self.assertIn("Order ready", kw["data"])
        self.assertEqual(len(mail.outbox), 0)
        self.assertIsNotNone(PushSubscription.objects.get().last_success_at)

    def test_no_subscription_sends_email(self):
        with mock.patch("pywebpush.webpush") as wp:
            notify_shop(self.shop.pk, "order_status", "Order ready", "ORD-1 is ready for pickup.", "/orders/1")
        wp.assert_not_called()
        self.assertEqual(len(mail.outbox), 1)
        m = mail.outbox[0]
        self.assertEqual(m.to, ["a@x.com"])
        self.assertEqual(m.subject, "[Star Offset] Order ready")
        self.assertIn("https://shop.test/orders/1", m.body)

    def test_expired_subscription_removed_then_email(self):
        self._sub(self.shop_user)
        gone = WebPushException("gone", response=mock.Mock(status_code=410))
        with mock.patch("pywebpush.webpush", side_effect=gone):
            notify_shop(self.shop.pk, "wallet", "Wallet credited", "₹100.00 was added.", "/wallet")
        self.assertEqual(PushSubscription.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 1)

    def test_temporary_failure_keeps_subscription_and_emails(self):
        self._sub(self.shop_user)
        with mock.patch("pywebpush.webpush", side_effect=WebPushException("boom", response=mock.Mock(status_code=500))):
            notify_shop(self.shop.pk, "wallet", "Wallet credited", "₹100.00 was added.", "/wallet")
        self.assertEqual(PushSubscription.objects.get().failures, 1)
        self.assertEqual(len(mail.outbox), 1)

    def test_one_browser_ok_is_enough(self):
        self._sub(self.shop_user, FCM)
        self._sub(self.shop_user, "https://updates.push.services.mozilla.com/wpush/v2/xyz")
        gone = WebPushException("gone", response=mock.Mock(status_code=404))
        with mock.patch("pywebpush.webpush", side_effect=[None, gone]):
            notify_shop(self.shop.pk, "order_status", "Order ready", "x", "/orders/1")
        self.assertEqual(len(mail.outbox), 0)

    def test_live_visible_tab_gets_no_email(self):
        push.mark_visible(self.shop_user.pk)
        notify_shop(self.shop.pk, "order_status", "Order ready", "x", "/orders/1")
        self.assertEqual(len(mail.outbox), 0)

    def test_stale_presence_gets_email(self):
        push.mark_visible(self.shop_user.pk)
        from datetime import timedelta
        from django.utils import timezone
        LivePresence.objects.update(last_visible=timezone.now() - timedelta(seconds=300))
        notify_shop(self.shop.pk, "order_status", "Order ready", "x", "/orders/1")
        self.assertEqual(len(mail.outbox), 1)

    def test_push_not_configured_falls_back_to_email(self):
        self._sub(self.shop_user)
        with override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY=""), mock.patch("pywebpush.webpush") as wp:
            notify_shop(self.shop.pk, "order_status", "Order ready", "x", "/orders/1")
        wp.assert_not_called()
        self.assertEqual(len(mail.outbox), 1)

    def test_email_fallback_can_be_switched_off(self):
        with override_settings(NOTIFY_EMAIL_FALLBACK=False):
            notify_shop(self.shop.pk, "order_status", "Order ready", "x", "/orders/1")
        self.assertEqual(len(mail.outbox), 0)

    def test_shop_without_portal_access_gets_nothing(self):
        Shop.objects.filter(pk=self.shop.pk).update(portal_access=False)
        notify_shop(self.shop.pk, "order_status", "Order ready", "x", "/orders/1")
        self.assertEqual(len(mail.outbox), 0)

    def test_staff_notification_goes_to_every_active_staff(self):
        other = User.objects.create_user("clerk", password="x", is_staff=True, email="clerk@x.com")
        User.objects.create_user("gone", password="x", is_staff=True, email="gone@x.com", is_active=False)
        self._sub(self.staff)  # boss has push, clerk has not
        with mock.patch("pywebpush.webpush") as wp:
            notify("shop_order", "New shop order", "Shop A placed ORD-1", "/shop-orders/1")
        self.assertEqual(wp.call_count, 1)
        self.assertEqual([m.to for m in mail.outbox], [["clerk@x.com"]])
        self.assertTrue(mail.outbox[0].body.startswith("Shop A placed ORD-1"))
        self.assertIn("https://admin.test/shop-orders/1", mail.outbox[0].body)
        self.assertIsNotNone(other.pk)

    def test_vendor_dispatch(self):
        vu = User.objects.create_user("vend", password="x")
        v = Vendor.objects.create(user=vu, name="Vendor A", owner_name="V", phone="9000000003", email="v@x.com")
        push.dispatch(("vendor", v.pk), "new_work", "New work assigned", "JOB-1 given to you.", "/assigned/1", ref=1)
        self.assertEqual([m.to for m in mail.outbox], [["v@x.com"]])

    def test_html_is_escaped_in_email(self):
        notify_shop(self.shop.pk, "order_status", "<b>Hi</b>", "<script>x</script>", "/orders/1")
        html = mail.outbox[0].alternatives[0][0]
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)

    def test_real_encryption_and_vapid_signing(self):
        """No mocks inside pywebpush: proves the generated key format works and the payload is encrypted."""
        self._sub(self.shop_user)
        resp = mock.Mock(status_code=201, ok=True)
        with mock.patch("requests.post", return_value=resp) as post:
            notify_shop(self.shop.pk, "order_status", "Order ready", "x", "/orders/1")
        self.assertEqual(post.call_count, 1)
        self.assertEqual(post.call_args.args[0], FCM)
        headers = post.call_args.kwargs["headers"]
        self.assertTrue(headers["authorization"].startswith("vapid t="))
        self.assertEqual(headers["content-encoding"], "aes128gcm")
        self.assertNotIn(b"Order ready", post.call_args.kwargs["data"])
        self.assertEqual(len(mail.outbox), 0)


@override_settings(**BASE)
class ApiTests(TransactionTestCase):
    def setUp(self):
        self.shop_user = User.objects.create_user("shopper", password="x")
        self.shop = Shop.objects.create(user=self.shop_user, name="Shop A", owner_name="A", phone="9000000001", email="a@x.com")
        self.other_user = User.objects.create_user("shopper2", password="x")
        Shop.objects.create(user=self.other_user, name="Shop B", owner_name="B", phone="9000000002", email="b@x.com")
        self.client = APIClient()

    def _body(self, endpoint=FCM):
        p256dh, auth = _browser_keys()
        return {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}}

    def test_requires_login(self):
        self.assertIn(self.client.get("/api/shop/push/key/").status_code, (401, 403))
        self.assertIn(self.client.post("/api/shop/push/subscribe/", self._body(), format="json").status_code, (401, 403))

    def test_key(self):
        self.client.force_login(self.shop_user)
        r = self.client.get("/api/shop/push/key/")
        self.assertEqual(r.json(), {"enabled": True, "public_key": PUB})
        with override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY=""):
            self.assertEqual(self.client.get("/api/shop/push/key/").json(), {"enabled": False, "public_key": ""})

    def test_subscribe_and_move_between_accounts(self):
        self.client.force_login(self.shop_user)
        self.assertEqual(self.client.post("/api/shop/push/subscribe/", self._body(), format="json").status_code, 200)
        self.assertEqual(PushSubscription.objects.get().user, self.shop_user)
        c2 = APIClient()
        c2.force_login(self.other_user)  # same browser, another shop signs in
        self.assertEqual(c2.post("/api/shop/push/subscribe/", self._body(), format="json").status_code, 200)
        self.assertEqual(PushSubscription.objects.count(), 1)
        self.assertEqual(PushSubscription.objects.get().user, self.other_user)

    def test_rejects_non_push_hosts_and_bad_data(self):
        self.client.force_login(self.shop_user)
        for ep in ("http://fcm.googleapis.com/x", "https://evil.example.com/x", "https://127.0.0.1/x", "https://fcm.googleapis.com.evil.com/x"):
            self.assertEqual(self.client.post("/api/shop/push/subscribe/", self._body(ep), format="json").status_code, 400, ep)
        self.assertEqual(self.client.post("/api/shop/push/subscribe/", {"endpoint": FCM}, format="json").status_code, 400)
        self.assertEqual(PushSubscription.objects.count(), 0)

    def test_unsubscribe_only_own(self):
        self.client.force_login(self.shop_user)
        self.client.post("/api/shop/push/subscribe/", self._body(), format="json")
        c2 = APIClient()
        c2.force_login(self.other_user)
        c2.post("/api/shop/push/unsubscribe/", {"endpoint": FCM}, format="json")
        self.assertEqual(PushSubscription.objects.count(), 1)
        self.client.post("/api/shop/push/unsubscribe/", {"endpoint": FCM}, format="json")
        self.assertEqual(PushSubscription.objects.count(), 0)

    def test_shop_cannot_use_other_prefix(self):
        self.client.force_login(self.shop_user)
        self.assertEqual(self.client.get("/api/vendor/push/key/").status_code, 403)  # fenced to /api/shop/

    def test_vendor_and_staff_prefixes(self):
        vu = User.objects.create_user("vend", password="x")
        Vendor.objects.create(user=vu, name="V", owner_name="V", phone="9000000003", email="v@x.com")
        c = APIClient(); c.force_login(vu)
        self.assertTrue(c.get("/api/vendor/push/key/").json()["enabled"])
        staff = User.objects.create_user("boss", password="x", is_staff=True)
        c = APIClient(); c.force_login(staff)
        self.assertTrue(c.get("/api/admin/push/key/").json()["enabled"])

    def test_portal_access_off_is_refused(self):
        Shop.objects.filter(pk=self.shop.pk).update(portal_access=False)
        self.client.force_login(self.shop_user)
        self.assertFalse(self.client.get("/api/shop/push/key/").json()["enabled"])
        self.assertEqual(self.client.post("/api/shop/push/subscribe/", self._body(), format="json").status_code, 403)


@override_settings(**BASE)
class PresenceSocketTests(TransactionTestCase):
    async def test_visible_ping_marks_presence_hidden_does_not(self):
        user = await database_sync_to_async(User.objects.create_user)("boss", password="x", is_staff=True)
        c = WebsocketCommunicator(URLRouter(websocket_urlpatterns), f"/ws/notifications/?ticket={make_ticket(user)}")
        ok, _ = await c.connect()
        self.assertTrue(ok)
        await c.receive_json_from()  # ready
        await c.send_json_to({"type": "ping", "visible": False})
        self.assertEqual(await c.receive_json_from(), {"type": "pong"})
        self.assertFalse(await database_sync_to_async(push.is_live)(user.pk))
        await c.send_json_to({"type": "ping", "visible": True})
        self.assertEqual(await c.receive_json_from(), {"type": "pong"})
        self.assertTrue(await database_sync_to_async(push.is_live)(user.pk))
        await c.disconnect()
