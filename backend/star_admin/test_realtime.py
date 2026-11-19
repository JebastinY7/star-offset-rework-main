"""Live-notification tests:  python manage.py test star_admin.test_realtime"""
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.test import TestCase, TransactionTestCase, override_settings

from .models import Shop, ShopOrder
from .notification_models import ShopNotification, notify
from .realtime import make_ticket
from .routing import websocket_urlpatterns
from .vendor_models import Vendor, VendorJob

LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
APP = URLRouter(websocket_urlpatterns)


def _connect(user=None, ticket=None):
    t = ticket if ticket is not None else (make_ticket(user) if user else "")
    return WebsocketCommunicator(APP, f"/ws/notifications/?ticket={t}")


@override_settings(CHANNEL_LAYERS=LAYERS)
class LiveTests(TransactionTestCase):
    def setUp(self):
        self.staff = User.objects.create_user("boss", password="x", is_staff=True)
        su = User.objects.create_user("shopper", password="x")
        self.shop = Shop.objects.create(user=su, name="Shop A", owner_name="A", phone="9000000001", email="a@x.com")
        su2 = User.objects.create_user("shopper2", password="x")
        self.shop2 = Shop.objects.create(user=su2, name="Shop B", owner_name="B", phone="9000000002", email="b@x.com")
        vu = User.objects.create_user("vend", password="x")
        self.vendor = Vendor.objects.create(user=vu, name="Vendor A", owner_name="V", phone="9000000003", email="v@x.com")

    async def _open(self, user):
        c = _connect(user)
        ok, _ = await c.connect()
        self.assertTrue(ok)
        self.assertEqual((await c.receive_json_from())["type"], "ready")
        return c

    async def test_bad_ticket_refused(self):
        for t in ("", "garbage"):
            ok, _ = await _connect(ticket=t).connect()
            self.assertFalse(ok)

    async def test_inactive_user_refused(self):
        await database_sync_to_async(User.objects.filter(pk=self.staff.pk).update)(is_active=False)
        ok, _ = await _connect(self.staff).connect()
        self.assertFalse(ok)

    async def test_ping(self):
        c = await self._open(self.staff)
        await c.send_json_to({"type": "ping"})
        self.assertEqual(await c.receive_json_from(), {"type": "pong"})
        await c.disconnect()

    async def test_staff_notify_reaches_staff_only(self):
        staff, shop = await self._open(self.staff), await self._open(self.shop.user)
        await database_sync_to_async(notify)("shop_order", "New shop order", "Shop A placed ORD-1", "/shop-orders/1")
        m = await staff.receive_json_from()
        self.assertEqual(m["type"], "notification")
        self.assertEqual(m["notification"]["title"], "New shop order")
        self.assertFalse(m["notification"]["read"])
        self.assertTrue(await shop.receive_nothing())
        await staff.disconnect(); await shop.disconnect()

    async def test_shop_order_status_reaches_that_shop_only(self):
        a, b = await self._open(self.shop.user), await self._open(self.shop2.user)

        def work():
            o = ShopOrder.objects.create(shop=self.shop, total_amount=100, final_amount=100)
            o.status = "in_production"
            o.save()
            return o.pk
        pk = await database_sync_to_async(work)()
        m = await a.receive_json_from()
        self.assertEqual(m["notification"]["title"], "Order in production")
        self.assertEqual(m["notification"]["link"], f"/orders/{pk}")
        self.assertTrue(await b.receive_nothing())
        self.assertEqual(await database_sync_to_async(ShopNotification.objects.filter(shop=self.shop).count)(), 1)
        await a.disconnect(); await b.disconnect()

    async def test_vendor_job_events(self):
        v = await self._open(self.vendor.user)

        def work():
            o = ShopOrder.objects.create(shop=self.shop, total_amount=100, final_amount=100)
            j = VendorJob.objects.create(order=o, vendor=self.vendor, status="enquiry")
            j.status = "quoted"; j.save()
            j.status = "assigned"; j.save()
            return j.pk
        pk = await database_sync_to_async(work)()
        first = await v.receive_json_from()
        self.assertEqual((first["type"], first["kind"]), ("vendor_event", "price_request"))
        second = await v.receive_json_from()   # quoted -> nothing for the vendor; assigned -> new work
        self.assertEqual(second["kind"], "new_work")
        self.assertEqual(second["link"], f"/assigned/{pk}")
        await v.disconnect()


@override_settings(CHANNEL_LAYERS=LAYERS)
class ApiTests(TestCase):
    def setUp(self):
        su = User.objects.create_user("shopper", password="x")
        self.shop = Shop.objects.create(user=su, name="Shop A", owner_name="A", phone="9000000001", email="a@x.com")

    def test_ticket_needs_login_and_works(self):
        self.assertIn(self.client.get("/api/shop/ws-ticket/").status_code, (401, 403))
        self.client.login(username="shopper", password="x")
        r = self.client.get("/api/shop/ws-ticket/")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ticket"])

    def test_shop_bell_api(self):
        n = ShopNotification.objects.create(shop=self.shop, kind="wallet", title="Wallet credited")
        self.client.login(username="shopper", password="x")
        d = self.client.get("/api/shop/notifications/").json()
        self.assertEqual((d["unread"], d["results"][0]["read"]), (1, False))
        import json
        r = self.client.post("/api/shop/notifications/read/", json.dumps({"id": n.pk}), content_type="application/json")
        self.assertEqual(r.json()["unread"], 0)
