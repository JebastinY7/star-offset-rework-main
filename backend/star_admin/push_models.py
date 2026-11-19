"""Tables behind Web Push + the email fallback (see push.py).

PushSubscription  one browser / phone that agreed to receive notifications while the portal is closed
LivePresence      "this account has the portal open on screen right now" (so we do not email what it just saw)
"""
from django.contrib.auth.models import User
from django.db import models


class PushSubscription(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="push_subscriptions")
    endpoint = models.CharField(max_length=800, unique=True)  # the push service address of this browser
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    user_agent = models.CharField(max_length=300, blank=True, default="")
    failures = models.PositiveSmallIntegerField(default=0)  # sends in a row that failed (reset on success)
    created_at = models.DateTimeField(auto_now_add=True)
    last_success_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.user_id}: {self.endpoint[:60]}"


class LivePresence(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="live_presence")
    last_visible = models.DateTimeField()  # last time a visible portal tab of this account pinged the WebSocket

    def __str__(self):
        return f"{self.user_id} @ {self.last_visible:%H:%M:%S}"
