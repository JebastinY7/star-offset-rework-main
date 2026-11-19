"""Approved shop-only price lists transcribed from the client's supplied PDFs.

Customer pricing in pricing/code_prices.py is deliberately untouched. Add future
shop price lists here as separate data, then wire their calculators into the shop API.
"""
from decimal import Decimal

NOTICE_SHOP_RATES = {
    # size: per-paper rate, quantity slab -> print charge, master charge by side,
    # design charge by side. Source: notice.pdf, pages 1-2.
    "a4": {
        "paper": Decimal("0.45"),
        "print": [(100, Decimal("70")), (200, Decimal("90")), (300, Decimal("110")),
                  (400, Decimal("125")), (500, Decimal("140")), (1000, Decimal("160"))],
        "master": {"single": Decimal("25"), "double": Decimal("35")},
        "design": {"single": Decimal("90"), "double": Decimal("180")},
    },
    "a5": {
        "paper": Decimal("0.225"),
        "print": [(100, Decimal("35")), (200, Decimal("45")), (300, Decimal("55")),
                  (400, Decimal("62.5")), (500, Decimal("70")), (1000, Decimal("80"))],
        "master": {"single": Decimal("25"), "double": Decimal("35")},
        "design": {"single": Decimal("90"), "double": Decimal("180")},
    },
    "legal": {
        "paper": Decimal("0.6"),
        "print": [(100, Decimal("80")), (200, Decimal("100")), (300, Decimal("120")),
                  (400, Decimal("135")), (500, Decimal("150")), (1000, Decimal("170"))],
        "master": {"single": Decimal("25"), "double": Decimal("35")},
        "design": {"single": Decimal("90"), "double": Decimal("180")},
    },
}

# First-batch source inventory. These prices are recorded separately from customer
# pricing; categories with complex/underspecified options are not silently guessed.
SHOP_PRICE_LIST_SOURCES = {
    "photo_lamination": "photo_l.pdf",
    "online_internet_train_employment": "online.pdf",
    "dtp": "dtp.pdf",
    "executive_bond_color_xerox": "bond.pdf",
    "black_color_xerox": "xerox.pdf",
    "notice": "notice.pdf",
}


def _notice_size_key(size_name: str):
    name = (size_name or "").strip().casefold().replace(" ", "")
    if "legal" in name or "lgl" in name:
        return "legal"
    if name.startswith("a5"):
        return "a5"
    if name.startswith("a4"):
        return "a4"
    return None


def _notice_print_charge(qty: int, slabs):
    """Apply the highest matching quantity band repeatedly for quantities > 1,000.

    Example: 1,100 = 1,000-band charge + 100-band charge. Setup charges
    (master/design) are deliberately not part of this loop.
    """
    remaining = qty
    total = Decimal("0")
    bands = sorted(slabs, key=lambda item: item[0], reverse=True)
    while remaining > 0:
        for limit, charge in bands:
            if remaining >= limit:
                total += charge
                remaining -= limit
                break
        else:
            # Remaining quantity is below the first band limit; use the 1-100 rate.
            total += bands[-1][1]
            remaining = 0
    return total


def calculate_notice_shop_price(qty: int, size_name: str, variant_name: str):
    """Return shop price components for one Notice job, or None if unsupported."""
    if not isinstance(qty, int) or qty < 1:
        return None
    key = _notice_size_key(size_name)
    rates = NOTICE_SHOP_RATES.get(key)
    if not rates:
        return None
    variant = (variant_name or "").casefold()
    if "double" in variant or "2 side" in variant or "two side" in variant:
        side = "double"
    elif "single" in variant or "1 side" in variant or "one side" in variant:
        side = "single"
    else:
        return None

    paper = rates["paper"] * qty
    printing = _notice_print_charge(qty, rates["print"])
    if side == "double":
        printing *= 2
    # Master and design are setup charges: each is applied once for the whole job,
    # including when print charges are split into multiple quantity bands.
    master = rates["master"][side]
    design = rates["design"][side]
    total = paper + printing + master + design
    return {
        "paper": paper,
        "print": printing,
        "master": master,
        "design": design,
        "total": total,
    }
