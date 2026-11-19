"""Price negotiation: vendor quotes -> Star Offset counters -> vendor accepts / re-quotes -> Star Offset assigns."""
from django.contrib.auth.models import User
from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Shop, ShopOrder, ShopOrderItem
from .vendor_models import Vendor, VendorJob


class CounterOfferFlow(TestCase):
    def setUp(self):
        self.staff = User.objects.create_user("boss", password="x", is_staff=True)
        shop = Shop.objects.create(user=User.objects.create_user("shopper", password="x"), name="Shop A", owner_name="A",
                                   phone="9000000001", email="a@x.com")
        self.vendor = Vendor.objects.create(user=User.objects.create_user("vend", password="x"), name="Vendor A", owner_name="V",
                                            phone="9000000003", email="v@x.com")
        self.order = ShopOrder.objects.create(shop=shop, total_amount=100, final_amount=100)
        self.item = ShopOrderItem.objects.create(order=self.order, kind="normal", service_name="Bill Book", qty=100)
        self.job = VendorJob.objects.create(order=self.order, vendor=self.vendor, status="enquiry")
        self.job.items.set([self.item])
        self.admin, self.vend = APIClient(), APIClient()
        self.admin.force_authenticate(self.staff)
        self.vend.force_authenticate(self.vendor.user)

    def vendor_says(self, **body):
        return self.vend.post(f"/api/vendor/quotes/{self.job.pk}/", body, format="json")

    def admin_says(self, **body):
        return self.admin.patch(f"/api/admin/vendor-jobs/{self.job.pk}/", body, format="json")

    def test_full_negotiation_then_assign(self):
        self.assertEqual(self.vendor_says(action="quote", price="1000", note="first").status_code, 200)
        # admin cannot counter without a price
        self.assertEqual(self.admin_says(status="countered").status_code, 400)
        r = self.admin_says(status="countered", counter_price="800", counter_note="please", send_email=True)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["job"]["status"], "countered")
        self.assertEqual(r.data["job"]["counter_price"], "800.00")
        self.assertTrue(r.data["email"]["sent"])
        self.assertEqual(len(mail.outbox), 1)
        # cannot assign while the vendor has not answered
        self.assertEqual(self.admin_says(status="assigned").status_code, 400)
        # vendor sees the offer and the history; the open count includes it
        row = self.vend.get("/api/vendor/quotes/").data
        self.assertEqual(row["counts"]["waiting"], 1)
        q = row["results"][0]
        self.assertEqual((q["status"], q["counter_price"], q["counter_note"]), ("countered", "800.00", "please"))
        # vendor sends a different price -> back to "quoted"
        self.assertEqual(self.vendor_says(action="quote", price="900").status_code, 200)
        self.job.refresh_from_db()
        self.assertEqual((self.job.status, str(self.job.quoted_price)), ("quoted", "900.00"))
        # admin counters again, vendor accepts
        self.assertEqual(self.admin_says(status="countered", counter_price="850", send_email=False).status_code, 200)
        r = self.vendor_says(action="accept_counter", note="ok")
        self.assertEqual(r.status_code, 200)
        self.assertEqual((r.data["quote"]["status"], r.data["quote"]["quoted_price"]), ("quoted", "850.00"))
        self.assertEqual([(s["by"], s["kind"], s["price"]) for s in r.data["quote"]["negotiation"]],
                         [("vendor", "quote", "1000.00"), ("admin", "counter", "800.00"), ("vendor", "quote", "900.00"),
                          ("admin", "counter", "850.00"), ("vendor", "accept", "850.00")])
        # admin assigns at the agreed price
        r = self.admin_says(status="assigned", send_email=False)
        self.assertEqual(r.status_code, 200)
        self.job.refresh_from_db()
        self.assertEqual((self.job.status, str(self.job.vendor_price)), ("assigned", "850.00"))

    def test_guards(self):
        # no counter before the vendor has priced it
        self.assertEqual(self.admin_says(status="countered", counter_price="500").status_code, 400)
        self.vendor_says(action="quote", price="1000")
        self.assertEqual(self.vendor_says(action="accept_counter").status_code, 400)  # nothing to accept yet
        self.admin_says(status="countered", counter_price="500", send_email=False)
        # a counter offer can be closed (no deal) and the vendor can decline it
        self.assertEqual(self.vendor_says(action="decline", note="too low").status_code, 200)
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "declined")
