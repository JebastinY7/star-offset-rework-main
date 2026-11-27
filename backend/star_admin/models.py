from django.db import models
from django.contrib.auth.models import User
from pricing.models import Category, Size, Variant, DigitalProduct, DigitalGSM, DigitalCategory, DigitalLamination, DeliveryType

# Create your models here.
    
# Customers
class Customer(models.Model):
    Customer_code = models.CharField(max_length=10)
    name = models.CharField(max_length=100)
    phone = models.CharField(max_length=10, unique=True)
    category = models.CharField(max_length=50)
    is_member = models.BooleanField(default=False)
    member_id = models.CharField(max_length=50, unique=True, null=True, blank=True)
    password = models.CharField(max_length=255, null=True, blank=True)
    due_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    points = models.IntegerField(default=0)
    join_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

# Bills Table
class Bill(models.Model):
    bill_no = models.CharField(max_length=20)
    bill_number = models.PositiveIntegerField(unique=True, null=True)

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    gross_total = models.DecimalField(max_digits=10, decimal_places=2)
    discount = models.DecimalField(max_digits=10, decimal_places=2)
    points_used = models.DecimalField(max_digits=10, decimal_places=2)
    paid_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    due_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    current_due = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    old_due_paid = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    previous_due = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    extra_charge_total = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    payment_status = models.CharField(
        max_length=20,
        choices=[('paid', 'Paid'), ('partial', 'Partial'), ('due', 'Due')],
        default='paid'
    )
    payment_mode = models.CharField(
        max_length=10,
        choices=[('cash', 'Cash'), ('upi', 'UPI'), ('bank', 'Bank'), ('credit', 'Credit')],
        default='cash'
    )
    final_amount = models.DecimalField(max_digits=10, decimal_places=2)
    bill_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    
    order = models.ForeignKey("Order", on_delete=models.SET_NULL, null=True, blank=True)

    def __str__(self):
        return self.bill_no
    

# Bill Items Table
class BillItem(models.Model):
    bill = models.ForeignKey(Bill, on_delete=models.CASCADE)
    service_name = models.CharField(max_length=255)
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, null=True, blank=True)
    size = models.ForeignKey(Size, on_delete=models.SET_NULL, null=True, blank=True)
    variant = models.ForeignKey(Variant, on_delete=models.SET_NULL, null=True, blank=True)

    digital_category = models.ForeignKey(DigitalCategory, on_delete=models.SET_NULL, null=True, blank=True)
    digital_gsm = models.ForeignKey(DigitalGSM, on_delete=models.SET_NULL, null=True, blank=True)
    digital_product = models.ForeignKey(DigitalProduct, on_delete=models.SET_NULL, null=True, blank=True)
    digital_lamination = models.ForeignKey(DigitalLamination, on_delete=models.SET_NULL, null=True, blank=True)
    side = models.CharField(max_length=20, blank=True, null=True)
    side_name = models.CharField(max_length=50, blank=True, null=True)
    manual_name = models.CharField(max_length=255, blank=True, null=True)
    specifications = models.JSONField(default=dict, blank=True)

    delivery_type = models.ForeignKey(DeliveryType, on_delete=models.SET_NULL, null=True, blank=True)

    qty = models.IntegerField()
    job = models.PositiveIntegerField(default=1)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    discount = models.DecimalField(max_digits=10, decimal_places=2)
    extra_charge = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    extra_purpose = models.CharField(max_length=255, null=True, blank=True)
    total = models.DecimalField(max_digits=10, decimal_places=2)


# Points Transaction
class PointTransaction(models.Model):
    TYPE_CHOICES = (
        ('earn', 'Earn'),
        ('redeem', 'Redeem'),
    )
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    bill = models.ForeignKey(Bill, on_delete=models.SET_NULL, null=True, blank=True)
    points_added = models.IntegerField(default=0)
    points_used = models.IntegerField(default=0)
    type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    date = models.DateTimeField(auto_now_add=True)


# Settings Table
class Setting(models.Model):
    points_per_rupee = models.IntegerField(null=True, blank=True)
    max_redeem_percent = models.IntegerField(null=True, blank=True)
    membership_validity_days = models.IntegerField()
    renewal_fee = models.DecimalField(max_digits=10, decimal_places=2)
    shop_renewal_fee = models.DecimalField(max_digits=10, decimal_places=2)


# Offers
class OffersHistory(models.Model):
    STATUS_CHOICES = [
        ("draft", "Draft"),
        ("sending", "Sending"),
        ("sent", "Sent"),
        ("partial", "Partial"),
        ("failed", "Failed"),
    ]

    title = models.CharField(max_length=100)
    message = models.TextField()
    group = models.CharField(max_length=20)       # all / members / non_members / selected
    category = models.CharField(max_length=50)
    total_sent = models.IntegerField()            # delivered to WhatsApp successfully
    created_at = models.DateTimeField(auto_now_add=True)

    # added with the offers page rework
    failed = models.IntegerField(default=0)
    total_recipients = models.IntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="sent")
    valid_from = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    shop_number = models.CharField(max_length=20, blank=True, default="")
    customer_ids = models.JSONField(default=list, blank=True)  # only used when group == "selected"

    def __str__(self):
        return self.title

#Membership Renewal
class MembershipTransaction(models.Model):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)
    type = models.CharField(max_length=20)
    payment_method = models.CharField(
        max_length=20,
        choices=[
            ('cash', 'Cash'),
            ('upi', 'UPI'),
            ('card', 'Card')
        ],
        default='cash'
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    start_date = models.DateField()
    end_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

# Password Reset
class PasswordResetOTP(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    otp = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    attempts = models.IntegerField(default=0)

# models.py
class LoginAttempt(models.Model):
    email = models.CharField(max_length=255)
    attempts = models.IntegerField(default=0)
    last_attempt = models.DateTimeField(auto_now=True)

# Orders 
class Order(models.Model):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE)

    work_name = models.CharField(max_length=255)
    notes = models.TextField(blank=True, null=True)

    order_date = models.DateField()
    delivery_date = models.DateField()

    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    advance_paid = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    advance_mode = models.CharField(
        max_length=10,
        choices=[('cash', 'Cash'), ('upi', 'UPI'), ('bank', 'Bank')],
        default='cash'
    )
    advance_reference = models.CharField(max_length=100, blank=True, default='')
    due_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    is_billed = models.BooleanField(default=False)

    status = models.CharField(
        max_length=20,
        choices=[
            ('pending', 'Pending'),
            ('progress', 'In Progress'),
            ('completed', 'Completed'),
            ('delivered', 'Delivered'),
            ('cancelled', 'Cancelled')
        ],
        default='pending'
    )

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.customer.name} - {self.work_name}"
    

class OrderItem(models.Model):

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")

    billing_type = models.CharField(max_length=20,
        choices=[
            ("normal", "Normal"),
            ("digital", "Digital"),
        ],
        default="normal"
    )

    # NORMAL PRINT
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, null=True, blank=True)

    size = models.ForeignKey(Size, on_delete=models.SET_NULL, null=True, blank=True)

    variant = models.ForeignKey(Variant, on_delete=models.SET_NULL, null=True, blank=True)

    # DIGITAL PRINT
    digital_category = models.ForeignKey(DigitalCategory, on_delete=models.SET_NULL, null=True, blank=True)

    digital_gsm = models.ForeignKey(DigitalGSM, on_delete=models.SET_NULL, null=True, blank=True)

    digital_product = models.ForeignKey(DigitalProduct, on_delete=models.SET_NULL, null=True, blank=True)

    digital_lamination = models.ForeignKey(DigitalLamination, on_delete=models.SET_NULL, null=True, blank=True)

    delivery_type = models.ForeignKey(DeliveryType, on_delete=models.SET_NULL, null=True, blank=True)
    
    customer_type = models.CharField(max_length=20, blank=True, null=True)

    work_type = models.CharField(max_length=20, blank=True, null=True)
    specifications = models.JSONField(default=dict, blank=True)

    side = models.CharField(max_length=20, null=True, blank=True)

    side_name = models.CharField(max_length=50, null=True, blank=True)

    qty = models.IntegerField(default=1)
    job = models.PositiveIntegerField(default=1)

    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    total = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    def __str__(self):

        if self.billing_type == "digital":
            return f"{self.digital_category} - {self.digital_product}"

        return f"{self.category} - {self.variant}"

# Staff Activity
class StaffActivity(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    last_seen = models.DateTimeField(null=True, blank=True)

# Staff profile: mobile number + Manager/Staff role of a staff account.
# Admin is not stored here - an admin is a superuser (see user_role below).
class StaffProfile(models.Model):
    ROLE_CHOICES = [("manager", "Manager"), ("staff", "Staff")]

    user = models.OneToOneField(User, on_delete=models.CASCADE)
    phone = models.CharField(max_length=10, blank=True, default="")
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default="staff")


def user_role(user):
    """-> "admin" | "manager" | "staff" for a signed-in account."""
    if user.is_superuser:
        return "admin"
    profile = StaffProfile.objects.filter(user=user).first()
    return profile.role if profile else "staff"

# Quotation
class Quotation(models.Model):
    quotation_no = models.CharField(max_length=20, unique=True)
    customer_name = models.CharField(max_length=100)
    customer_phone = models.CharField(max_length=15)
    work_name = models.CharField(max_length=200)
    quotation_date = models.DateField()
    valid_until = models.DateField(null=True, blank=True)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    notes = models.TextField(blank=True, null=True)
    terms = models.TextField(blank=True, default="")
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    extra_charge = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # set when the quotation is converted into a bill (Billing page, ?quotation_id=)
    converted_bill = models.ForeignKey("Bill", on_delete=models.SET_NULL, null=True, blank=True, related_name="quotations")
    created_at = models.DateTimeField(auto_now_add=True)

class QuotationItem(models.Model):

    quotation = models.ForeignKey(Quotation, on_delete=models.CASCADE, related_name="items")
    manual_name = models.CharField(max_length=255, blank=True, null=True)
    billing_type = models.CharField(max_length=20,
        choices=[
            ("normal", "Normal"),
            ("digital", "Digital"),
        ],
        default="normal"
    )

    # NORMAL
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, null=True, blank=True)

    size = models.ForeignKey(Size, on_delete=models.SET_NULL, null=True, blank=True)

    variant = models.ForeignKey(Variant, on_delete=models.SET_NULL, null=True, blank=True)

    # DIGITAL
    digital_category = models.ForeignKey(DigitalCategory, on_delete=models.SET_NULL, null=True, blank=True)

    digital_gsm = models.ForeignKey(DigitalGSM, on_delete=models.SET_NULL, null=True, blank=True)

    digital_product = models.ForeignKey(DigitalProduct, on_delete=models.SET_NULL, null=True, blank=True)
    customer_type = models.CharField(max_length=20, blank=True)
    work_type = models.CharField(max_length=50, blank=True)
    specifications = models.JSONField(default=dict, blank=True)
    digital_lamination = models.ForeignKey(DigitalLamination, on_delete=models.SET_NULL, null=True, blank=True)

    customer_type = models.CharField(max_length=20, blank=True, null=True)

    side = models.CharField(max_length=20, blank=True, null=True)

    side_name = models.CharField(max_length=50, blank=True, null=True)

    qty = models.IntegerField(default=1)

    job = models.PositiveIntegerField(default=1)

    price = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    total = models.DecimalField(max_digits=10, decimal_places=2, default=0)

# Incoming / outgoing WhatsApp messages log
class WhatsappMessage(models.Model):
    DIRECTION_CHOICES = [
        ("in", "Incoming"),
        ("out", "Outgoing"),
    ]
 
    direction = models.CharField(max_length=3, choices=DIRECTION_CHOICES, default="in")
    phone = models.CharField(max_length=20, db_index=True)
    customer = models.ForeignKey(
        Customer, on_delete=models.SET_NULL, null=True, blank=True, related_name="whatsapp_messages"
    )
    message_type = models.CharField(max_length=30, blank=True)  # text, image, document, etc.
    body = models.TextField(blank=True)  # text body, or caption for media messages
    media = models.FileField(upload_to="whatsapp_media/%Y/%m/", blank=True, null=True)
    media_mime_type = models.CharField(max_length=100, blank=True)
    media_filename = models.CharField(max_length=255, blank=True)  # original filename for documents
    wa_message_id = models.CharField(max_length=100, blank=True, null=True, unique=True)
    is_read = models.BooleanField(default=False)
    raw_payload = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
 
    @property
    def is_image(self):
        return self.message_type == "image"
 
    @property
    def is_document(self):
        return self.message_type == "document"
 
    class Meta:
        ordering = ["-created_at"]
 
    def __str__(self):
        return f"{self.phone} ({self.direction}): {self.body[:30]}"

# Activity Log (Settings > Activity Log) - filled by star_admin/activity.py
class ActivityLog(models.Model):
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    username = models.CharField(max_length=150, blank=True)   # kept even after the account is deleted
    role = models.CharField(max_length=10, blank=True)         # admin / staff
    module = models.CharField(max_length=20, db_index=True)    # customer, bill, order, ...
    action = models.CharField(max_length=20, db_index=True)    # create, update, delete, login, ...
    target = models.CharField(max_length=200, blank=True)      # e.g. "B105 (Ravi Kumar)"
    description = models.CharField(max_length=300)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.username}: {self.description}"


# Expenses (money going out) - feeds the Profit & Loss report
# (key, label shown on the report, group: cost_of_sales | operating)
EXPENSE_CATEGORIES = [
    ("materials", "Paper, ink and printing materials", "cost_of_sales"),
    ("outsourced", "Outsourced printing", "cost_of_sales"),
    ("rent", "Rent", "operating"),
    ("salaries", "Staff salaries", "operating"),
    ("utilities", "Electricity and maintenance", "operating"),
    ("other", "Other expenses", "operating"),
]


class Expense(models.Model):
    expense_date = models.DateField(db_index=True)
    category = models.CharField(max_length=20, choices=[(k, label) for k, label, _ in EXPENSE_CATEGORIES])
    description = models.CharField(max_length=200, blank=True, default="")   # payee / note
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-expense_date", "-id"]

    def __str__(self):
        return f"{self.get_category_display()} {self.amount} ({self.expense_date})"


# External printing shops that get a login for the "Other Shop Portal" (Settings > Shop Management).
# Account status = user.is_active; portal_access is the separate "allow login to the portal" switch.
class Shop(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="shop_profile")
    name = models.CharField(max_length=150)
    owner_name = models.CharField(max_length=100)
    phone = models.CharField(max_length=10, unique=True)
    email = models.EmailField(unique=True)
    gst_number = models.CharField(max_length=15, blank=True, default="")
    shop_type = models.CharField(max_length=30, blank=True, default="")
    address = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")
    portal_access = models.BooleanField(default=True)
    # True while the shop is still using a temporary password the admin typed for it. The shop portal
    # makes the shop choose its own password before anything else (cleared when it does).
    must_change_password = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return self.name


# The logo a shop uploads for its Shop Portal sidebar. Kept in the database (not on disk) so it survives
# Railway deploys, and in its own table so the shop lists never load the image bytes.
class ShopLogo(models.Model):
    shop = models.OneToOneField(Shop, on_delete=models.CASCADE, related_name="logo")
    content_type = models.CharField(max_length=40)
    data = models.BinaryField()
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Logo of {self.shop_id}"


# A quotation request a shop sends from the Shop Portal (cart -> submit). The dashboard counts these.
# items_count / total_amount are kept simple for now; the cart feature can add line items later.
class ShopQuotationRequest(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),      # sent, waiting for Star Offset
        ("quoted", "Quoted"),        # Star Offset has priced it
        ("responded", "Responded"),  # shop has replied to the quote
    ]

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="quotation_requests")
    request_no = models.CharField(max_length=20, unique=True)
    items_count = models.PositiveIntegerField(default=0)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return self.request_no


# One line of a ShopQuotationRequest. Names/spec are copied from the price tables at submit time,
# so the request still reads correctly if a price list is edited later.
class ShopQuotationRequestItem(models.Model):
    request = models.ForeignKey(ShopQuotationRequest, on_delete=models.CASCADE, related_name="items")
    kind = models.CharField(max_length=10)  # "normal" | "digital"
    service_name = models.CharField(max_length=200)
    spec = models.JSONField(default=list)  # [{"label": "Size", "value": "A4"}, ...]
    params = models.JSONField(default=dict)  # ids used for pricing, kept for the admin / re-pricing
    qty = models.PositiveIntegerField()
    estimate = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)  # None = needs a quote

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.service_name} x {self.qty}"


# An order a shop placed from the Shop Portal cart (Place Order).  The email to Star Offset carries the
# artwork files; here we keep what My Orders needs: what was ordered, the estimate and the status.
# Staff move the status along (Django admin for now).
class ShopOrder(models.Model):
    STATUS_CHOICES = [
        ("submitted", "Submitted"),
        ("awaiting_payment", "Awaiting Payment"),
        ("payment_confirmed", "Payment Confirmed"),
        ("in_production", "In Production"),
        ("ready", "Ready for Pickup"),
        ("completed", "Completed"),
        ("cancelled", "Cancelled"),
    ]

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="orders")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="submitted")
    items_count = models.PositiveIntegerField(default=0)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)  # original estimate
    final_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    payment_method = models.CharField(max_length=80, blank=True, default="")
    payment_reference = models.CharField(max_length=120, blank=True, default="")
    payment_confirmed_at = models.DateTimeField(null=True, blank=True)
    payment_confirmed_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name="confirmed_shop_orders")
    delivery_date = models.DateField(null=True, blank=True)
    instructions = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    @property
    def order_no(self):
        return f"ORD-{self.id:04d}"

    def __str__(self):
        return f"{self.order_no} - {self.shop.name}"


# One line of a ShopOrder.  Names/spec are copied from the price tables when the order is placed,
# so the order still reads correctly if a price list is edited later.
class ShopOrderItem(models.Model):
    order = models.ForeignKey(ShopOrder, on_delete=models.CASCADE, related_name="items")
    kind = models.CharField(max_length=10)  # "normal" | "digital"
    service_name = models.CharField(max_length=200)
    spec = models.JSONField(default=list)  # [{"label": "Size", "value": "A4"}, ...]
    params = models.JSONField(default=dict)
    qty = models.PositiveIntegerField()
    estimate = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)  # None = needs a quote
    files = models.JSONField(default=list)  # [{"name": "...", "size": 12345}, ...] - names only, files go by email

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"{self.service_name} x {self.qty}"

class ShopWallet(models.Model):
    shop = models.OneToOneField(Shop, on_delete=models.CASCADE, related_name="wallet")
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Wallet - {self.shop.name}: {self.balance}"


class ShopWalletTransaction(models.Model):
    KIND_CHOICES = [("credit", "Credit"), ("debit", "Debit"), ("refund", "Refund"), ("adjustment", "Adjustment")]
    STATUS_CHOICES = [("pending", "Pending"), ("completed", "Completed"), ("failed", "Failed")]
    wallet = models.ForeignKey(ShopWallet, on_delete=models.CASCADE, related_name="transactions")
    kind = models.CharField(max_length=12, choices=KIND_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="pending")
    razorpay_order_id = models.CharField(max_length=100, blank=True, default=None, unique=True, null=True)
    reference = models.CharField(max_length=120, blank=True, default="")
    description = models.CharField(max_length=250, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.kind} {self.amount} - {self.wallet.shop.name}"
