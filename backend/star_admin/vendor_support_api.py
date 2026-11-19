"""Contact Support for vendors (Vendor Portal).

    GET  /api/vendor/support/   -> {contact: {...}, topics: [...], jobs: [{id, order_no, status}, ...]}   (jobs = the vendor's latest, for the "related job" picker)
    POST /api/vendor/support/   {topic, message, job_id?}  -> emails Star Offset; replies go to the vendor's email

Star Offset's contact details are the same ones the shop portal shows (SUPPORT_PHONE, SUPPORT_WHATSAPP,
SUPPORT_EMAIL, SUPPORT_ADDRESS, SUPPORT_HOURS in the backend .env - see shop_support_api.py).
"""
import logging
import os

from django.conf import settings as django_settings
from django.core.cache import cache
from django.core.mail import EmailMessage
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .shop_support_api import DEFAULTS, _contact
from .vendor_models import QUOTE_STATUSES, VendorJob
from .vendor_portal_api import STATUS_LABEL, IsVendorUser

logger = logging.getLogger(__name__)

TOPICS = {
    "job": "Help with a job",
    "pricing": "Price request or payment",
    "artwork": "Artwork or files",
    "pickup": "Pickup or delivery",
    "account": "Account or login",
    "other": "Something else",
}
MESSAGE_MAX = 1500
MESSAGE_MIN = 10
HOURLY_LIMIT = 5  # messages per vendor per hour


@api_view(["GET", "POST"])
@permission_classes([IsVendorUser])
def vendor_support(request):
    vendor = request.user.vendor_profile
    contact = _contact()

    if request.method == "GET":
        recent = (VendorJob.objects.filter(vendor=vendor).exclude(status__in=QUOTE_STATUSES)
                  .order_by("-updated_at", "-id")[:20])
        return Response({
            "contact": contact,
            "topics": [{"value": k, "label": v} for k, v in TOPICS.items()],
            "jobs": [{"id": j.id, "order_no": j.order_no, "status": STATUS_LABEL.get(j.status, j.status)} for j in recent],
        })

    d = request.data
    topic = d.get("topic")
    message = str(d.get("message") or "").strip()
    if topic not in TOPICS:
        return Response({"error": "Choose what your message is about."}, status=400)
    if len(message) < MESSAGE_MIN:
        return Response({"error": f"Please write a little more (at least {MESSAGE_MIN} characters)."}, status=400)
    if len(message) > MESSAGE_MAX:
        return Response({"error": f"Your message can be at most {MESSAGE_MAX} characters."}, status=400)

    job = None
    if d.get("job_id") not in (None, ""):
        try:
            job = VendorJob.objects.filter(vendor=vendor, pk=int(d.get("job_id"))).first()
        except (TypeError, ValueError):
            job = None
        if job is None:
            return Response({"error": "That job was not found."}, status=400)

    # best-effort brake on spam (per vendor, per hour)
    limit_key = f"vendor-support:{vendor.pk}"
    sent = cache.get(limit_key, 0)
    if sent >= HOURLY_LIMIT:
        return Response({"error": "You have sent several messages in the last hour. Please wait a little, or call us."}, status=429)

    to_addr = os.getenv("SUPPORT_EMAIL") or os.getenv("ORDER_EMAIL") or DEFAULTS["email"]
    body = "\n".join([
        f"VENDOR SUPPORT MESSAGE - {TOPICS[topic]}", "",
        f"Vendor: {vendor.name} (VENDOR-{vendor.id:04d})",
        f"Contact person: {vendor.owner_name}",
        f"Phone: {vendor.phone}",
        f"Email: {vendor.email}",
        f"Related job: {job.order_no if job else 'None'}", "",
        message,
    ])
    msg = EmailMessage(f"Vendor support: {TOPICS[topic]} - {vendor.name}", body, getattr(django_settings, "DEFAULT_FROM_EMAIL", None),
                       [to_addr], reply_to=[vendor.email] if vendor.email else None)
    try:
        msg.send(fail_silently=False)
    except Exception:
        logger.exception("Could not send the vendor support message")
        return Response({"error": "Your message could not be sent. Please try again, or call us."}, status=502)

    cache.set(limit_key, sent + 1, 3600)
    return Response({"ok": True})