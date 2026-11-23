"""Paper price per sheet used by the Bill Book and Notice formulas.

The admin types the prices in Settings > Paper Price (stored in PaperRate, one row). Until the
first save the old built-in values (pricing.code_prices.BILL_BOOK_PAPER_RATES) are used, so
nothing changes for an existing install. Reading never writes to the database.
"""
from decimal import Decimal, InvalidOperation

from pricing.code_prices import BILL_BOOK_PAPER_RATES

from .models import PaperRate

# (key, label, what it is used for) - the Settings screen and the validation both use this order
PAPER_FIELDS = (
    ("standard_original", "Original Paper Price (A4)"),
    ("low_original", "Low Original Paper Price (A4)"),
    ("duplicate", "Duplicate Paper Price (A4)"),
    ("legal_original", "Legal Original Paper Price"),
    ("legal_duplicate", "Legal Duplicate Paper Price"),
)
MAX_RATE = Decimal("1000")


def get_paper_rates():
    """{'standard_original': 0.42, 'low_original': 0.35, 'duplicate': 0.3, 'legal_original': 0.6, 'legal_duplicate': 0.4} as floats."""
    row = PaperRate.objects.order_by("id").first()
    return {
        key: float(getattr(row, key)) if row else float(BILL_BOOK_PAPER_RATES[key])
        for key, _ in PAPER_FIELDS
    }


def clean_rate(value, label):
    try:
        d = Decimal(str(value).strip())
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(f"{label} must be a number")
    if not d.is_finite():
        raise ValueError(f"{label} must be a number")
    if d <= 0:
        raise ValueError(f"{label} must be more than 0")
    if d > MAX_RATE:
        raise ValueError(f"{label} is too large")
    return d.quantize(Decimal("0.0001"))
