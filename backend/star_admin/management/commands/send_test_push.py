"""python manage.py send_test_push <username>   -> sends one real Web Push to every browser that user subscribed and
prints the push service's answer for each one (so you can see WHY nothing arrived)."""
import json

from django.conf import settings
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

from star_admin.push import endpoint_allowed, push_enabled
from star_admin.push_models import PushSubscription


class Command(BaseCommand):
    help = "Send a test Web Push to one user and print the result per subscription."

    def add_arguments(self, parser):
        parser.add_argument("username")

    def handle(self, *args, **opts):
        from pywebpush import WebPushException, webpush

        if not push_enabled():
            raise CommandError("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set in the environment of THIS process.")
        user = User.objects.filter(username=opts["username"]).first()
        if not user:
            raise CommandError("No such user.")
        subs = list(PushSubscription.objects.filter(user=user))
        self.stdout.write(f"{len(subs)} subscription(s) for {user.username}")
        if not subs:
            self.stdout.write("-> the browser never subscribed: open the portal signed in, with notifications allowed, and watch the "
                              "browser console for 'Push sync failed'.")
        payload = json.dumps({"kind": "test", "title": "Test notification", "body": "Web Push is working.", "link": "/", "tag": "test"})
        for s in subs:
            host = s.endpoint.split("/")[2]
            try:
                r = webpush(subscription_info={"endpoint": s.endpoint, "keys": {"p256dh": s.p256dh, "auth": s.auth}}, data=payload,
                            vapid_private_key=settings.VAPID_PRIVATE_KEY, vapid_claims={"sub": settings.VAPID_CLAIM_SUB}, ttl=60, timeout=10)
                self.stdout.write(self.style.SUCCESS(f"OK  {host}  HTTP {r.status_code}  (allowed={endpoint_allowed(s.endpoint)})"))
            except WebPushException as e:
                code = getattr(getattr(e, "response", None), "status_code", None)
                body = getattr(getattr(e, "response", None), "text", "")[:200]
                self.stdout.write(self.style.ERROR(f"FAIL {host}  HTTP {code}  {body or e}"))
            except Exception as e:  # noqa: BLE001
                self.stdout.write(self.style.ERROR(f"FAIL {host}  {e}"))
