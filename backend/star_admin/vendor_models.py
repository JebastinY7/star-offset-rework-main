"""Vendors: outside printers who receive part of a shop order OR a manual (admin-created) order from Star Offset.

Add this line at the very END of star_admin/models.py so Django finds the models:
    from .vendor_models import Vendor, VendorJob  # noqa: E402,F401
"""
from django.contrib.auth.models import User
from django.db import models
from django.db.models import Count, F, Prefetch, Q
from django.utils import timezone

from .models import Order, OrderItem, ShopOrder, ShopOrderItem

# a job in one of these states holds its items (rejected / cancelled jobs free them again)
TAKEN_STATUSES = ["assigned", "accepted", "in_progress", "ready", "completed"]

# PRICE REQUESTS (quotes). Before work is given out, Star Offset can ask one or more vendors "what will you charge for this?".
# Each request is a VendorJob that has not started yet:
#   enquiry       Star Offset asked, the vendor has not answered
#   quoted        the vendor sent a price (quoted_price)           -> Star Offset assigns (job becomes "assigned"), counters with its own price, or marks it not suitable
#   countered     Star Offset answered a quote with its own price (counter_price) -> the vendor accepts it (back to "quoted" at that price),
#                 sends a new price (also "quoted"), or declines. Star Offset can only assign once the vendor is "quoted" (= agreed / priced).
#   declined      the vendor said it cannot do the work
#   not_selected  Star Offset did not take this quote (another vendor was chosen, or the price was not OK)
# A request does NOT hold its items, so several vendors can be asked about the same items at the same time.
QUOTE_OPEN = ["enquiry", "quoted", "countered"]
QUOTE_STATUSES = QUOTE_OPEN + ["declined", "not_selected"]


class Vendor(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="vendor_profile")
    name = models.CharField(max_length=150)
    owner_name = models.CharField(max_length=100)
    phone = models.CharField(max_length=10, unique=True)
    email = models.EmailField(unique=True)
    address = models.TextField(blank=True, default="")
    specialties = models.CharField(max_length=250, blank=True, default="")  # free text, e.g. "Flex, Offset, Binding"
    # the works (price-list categories, e.g. "Bill Book", "Visiting Card") this vendor does. The Assign work page shows only
    # the vendors whose works match the ticked items. Matched by name (see rate_key), so a work that exists in both the
    # offset and the digital price list is ONE work here.
    works = models.JSONField(default=list, blank=True)
    notes = models.TextField(blank=True, default="")  # admin only
    portal_access = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self):
        return self.name


class VendorJob(models.Model):
    """The part of one order that Star Offset gives to one vendor (one or more of its items).

    The order is EITHER a shop-portal order (order + items) OR a manual order made in Admin > Orders
    (manual_order + manual_items). Exactly one of the two is filled."""
    STATUS_CHOICES = [
        ("enquiry", "Quote requested"),   # Star Offset asked the vendor for a price
        ("quoted", "Quoted"),             # the vendor sent a price, waiting for Star Offset
        ("countered", "Counter offer"),   # Star Offset proposed its own price, waiting for the vendor
        ("declined", "Declined to quote"),  # the vendor cannot do this work
        ("not_selected", "Not selected"),   # Star Offset went with another vendor / price
        ("assigned", "New"),
        ("accepted", "Accepted"),
        ("in_progress", "In Production"),
        ("ready", "Ready"),
        ("completed", "Completed"),   # set by Star Offset after pickup / delivery
        ("rejected", "Rejected"),     # vendor declined - Star Offset reassigns
        ("cancelled", "Cancelled"),   # Star Offset withdrew the job
    ]

    order = models.ForeignKey(ShopOrder, on_delete=models.CASCADE, related_name="vendor_jobs", null=True, blank=True)
    items = models.ManyToManyField(ShopOrderItem, related_name="vendor_jobs", blank=True)
    manual_order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="vendor_jobs", null=True, blank=True)
    manual_items = models.ManyToManyField(OrderItem, related_name="vendor_jobs", blank=True)
    vendor = models.ForeignKey(Vendor, on_delete=models.CASCADE, related_name="jobs")
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="assigned")
    vendor_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)  # what Star Offset pays
    quoted_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)  # the vendor's price for the WHOLE job (price request)
    quoted_at = models.DateTimeField(null=True, blank=True)
    counter_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)  # Star Offset's counter offer for the WHOLE job
    counter_note = models.TextField(blank=True, default="")   # Star Offset -> vendor, sent with the counter offer
    countered_at = models.DateTimeField(null=True, blank=True)
    # every price move of the negotiation, oldest first: [{by: "vendor"|"admin", kind: "quote"|"counter"|"accept", price, note, at}]
    negotiation = models.JSONField(default=list, blank=True)
    due_date = models.DateField(null=True, blank=True)
    instructions = models.TextField(blank=True, default="")   # Star Offset -> vendor
    vendor_note = models.TextField(blank=True, default="")    # vendor -> Star Offset
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    @property
    def job_no(self):
        return f"JOB-{self.id:04d}"

    @property
    def is_manual(self):
        return self.manual_order_id is not None

    @property
    def source(self):
        return "manual" if self.is_manual else "shop"

    @property
    def order_ref_id(self):
        return self.manual_order_id if self.is_manual else self.order_id

    @property
    def order_no(self):
        return manual_order_no(self.manual_order_id) if self.is_manual else self.order.order_no

    @property
    def party_name(self):
        """Admin-side only: the shop / customer the work belongs to."""
        return self.manual_order.customer.name if self.is_manual else self.order.shop.name

    @property
    def order_note(self):
        """Order-level note shown to the vendor. Manual-order notes are internal, so they are not shared."""
        return "" if self.is_manual else (self.order.instructions or "")

    def log_price(self, by, kind, price, note=""):
        """Add one step to the negotiation history (call save() yourself)."""
        self.negotiation = list(self.negotiation or []) + [{"by": by, "kind": kind, "price": str(price), "note": note or "",
                                                           "at": timezone.now().isoformat()}]

    def lines(self):
        """The job's items in ONE shape for both kinds of order:
        [{id, service_name, qty, spec:[{label,value}], files:[...], manual}]"""
        if self.is_manual:
            return [manual_item_view(i) for i in self.manual_items.all()]
        return [{"id": i.id, "service_name": i.service_name, "qty": i.qty or 0, "spec": i.spec or [],
                 "files": i.files or [], "manual": False} for i in self.items.all()]

    def __str__(self):
        return f"{self.job_no} - {self.vendor.name}"


# ------------------------------------------------------------------ manual-order helpers
def manual_order_no(pk):
    """Same code the Orders screen shows: W098."""
    return f"W{int(pk):03d}"


def manual_item_view(i):
    """OrderItem (manual order line) -> the same shape as a shop order line."""
    if i.billing_type == "digital":
        service = i.digital_category.name if i.digital_category_id else "Digital print"
        parts = [("GSM", i.digital_gsm), ("Product", i.digital_product), ("Lamination", i.digital_lamination)]
    else:
        service = i.category.name if i.category_id else "Print job"
        parts = [("Size", i.size), ("Variant", i.variant)]
    spec = [{"label": label, "value": obj.name} for label, obj in parts if obj]
    if i.side_name:
        spec.append({"label": "Side", "value": i.side_name})
    if i.delivery_type_id:
        spec.append({"label": "Delivery", "value": i.delivery_type.name})
    return {"id": i.id, "service_name": service, "qty": i.qty or 0, "spec": spec, "files": [], "manual": True}


def manual_items_queryset():
    return OrderItem.objects.select_related("category", "size", "variant", "digital_category", "digital_gsm",
                                            "digital_product", "digital_lamination", "delivery_type").order_by("id")


def jobs_queryset(qs=None):
    """VendorJob rows with everything lines() / order_no / party_name need (no N+1)."""
    qs = VendorJob.objects.all() if qs is None else qs
    return (qs.select_related("vendor", "order", "order__shop", "manual_order", "manual_order__customer")
            .prefetch_related("items", Prefetch("manual_items", queryset=manual_items_queryset())))


# ------------------------------------------------------------------ "is this order already assigned?" for the order lists
def annotate_assign(qs, manual=False):
    """Adds n_items (lines in the order) and n_taken (lines held by a live job) so lists can filter in SQL."""
    taken = "vendor_jobs__manual_items" if manual else "vendor_jobs__items"
    return qs.annotate(n_items=Count("items", distinct=True),
                       n_taken=Count(taken, filter=Q(vendor_jobs__status__in=TAKEN_STATUSES), distinct=True))


def filter_assign(qs, value):
    """value: 'none' = nothing given out yet | 'open' = some lines still free | 'done' = every line is with a vendor."""
    if value == "none":
        return qs.filter(n_taken=0)
    if value == "open":
        return qs.filter(n_taken__lt=F("n_items"))
    if value == "done":
        return qs.filter(n_items__gt=0, n_taken__gte=F("n_items"))
    return qs


def assign_prefetch(manual=False):
    """Prefetch so assign_row() costs no queries in a list."""
    items = "manual_items" if manual else "items"
    return Prefetch("vendor_jobs", queryset=VendorJob.objects.select_related("vendor").prefetch_related(items))


def assign_row(order, manual=False):
    """{state: none|partial|all, total, assigned, vendors:[names], declined: bool} for one order."""
    jobs = list(order.vendor_jobs.all())
    live = [j for j in jobs if j.status in TAKEN_STATUSES]
    rel = "manual_items" if manual else "items"
    taken = {i.id for j in live for i in getattr(j, rel).all()}
    total = len(list(order.items.all()))
    state = "none" if not taken else ("all" if len(taken) >= total else "partial")
    vendors = []
    for j in live:
        if j.vendor.name not in vendors:
            vendors.append(j.vendor.name)
    quotes = {"waiting": sum(1 for j in jobs if j.status == "enquiry"), "received": sum(1 for j in jobs if j.status == "quoted"),
              "countered": sum(1 for j in jobs if j.status == "countered")}
    return {"state": state, "total": total, "assigned": len(taken), "vendors": vendors, "quotes": quotes,
            "declined": state != "all" and any(j.status == "rejected" for j in jobs)}


class VendorJobEvent(models.Model):
    """One line in a job's progress history (vendor moved the job on, or posted a progress update).
    The first line ("assigned") is not stored - the API builds it from VendorJob.created_at."""
    job = models.ForeignKey(VendorJob, on_delete=models.CASCADE, related_name="events")
    status = models.CharField(max_length=12)                      # job status after this update
    qty = models.PositiveIntegerField(null=True, blank=True)      # pieces finished in THIS update (optional)
    progress_date = models.DateField(null=True, blank=True)       # the day the work was done (defaults to the save day)
    remarks = models.CharField(max_length=500, blank=True, default="")
    by_name = models.CharField(max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"{self.job.job_no} - {self.status}"


# ------------------------------------------------------------------ helper
def rate_key(name):
    """'BILL  Book' -> 'bill book' (same item whatever the capitals / spaces). Used to match the same service on past jobs."""
    return " ".join(str(name or "").lower().split())