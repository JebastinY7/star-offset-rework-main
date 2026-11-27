"""Printing prices for the Shop Portal (read-only, shop accounts only).

    GET /api/shop/services/                     -> {services: [{key, kind, id, name, description, from_price}]}
    GET /api/shop/services/<kind>/<id>/         -> options for the Specifications form
    GET /api/shop/price/?kind=...&...           -> {available, estimate, discount_percent}

kind is "normal" (Category > Size > Variant, price table + a few formulas) or "digital"
(Paper > Size > Finish, slab rate).  Prices are worked out HERE with the shop's own rates, so the
browser never receives customer / member rates.  The formulas are a 1:1 port of the admin app's
frontend/src/lib/pricing.js (normalGross, discountPercent, previewDigital) for a single job.
"""
import math
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Q
from django.http import Http404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from pricing.models import Category, DigitalCategory, DigitalLamination, DigitalPrice, PriceRule, Size, Variant
from pricing.code_prices import (
    BILL_BOOK_PRINT_COST_TABLES,
    BILL_BOOK_DESIGN_CHARGES, BILL_BOOK_BINDING_SLABS,
)
from pricing.code_prices import iter_price_rules, get_price_rule as get_code_price_rule, get_latest_price_rule, get_price_rules

from .paper_prices import get_paper_rates
from .shop_portal_api import IsShopUser
from .visiting_card_pricing import calculate_visiting_card_price

MAX_QTY = 1_000_000
FORMULA_CATEGORIES = ("print out", "bill book", "notice")  # priced by formula, not only by the table


# ----------------------------------------------------------------- small helpers
def pretty(name):
    """'BILL BOOK' -> 'Bill Book'. Short words with no vowel ('DTP') are codes and stay upper-case."""
    keep = lambda w: len(w) <= 3 and not any(c in "AEIOUaeiou" for c in w)  # noqa: E731
    return " ".join(w.upper() if keep(w) else w.capitalize() for w in (name or "").split())


def js_round(x):
    """JavaScript Math.round (half goes up) - Python's round() would go to the even number."""
    return math.floor(x + 0.5)


def round2(n):
    return js_round(n * 100) / 100


def custom_round(amount):
    """Round to the nearest rupee; exactly .50 rounds up."""
    return int(Decimal(str(amount)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


# Approved Designing shop rates from the client's Designing price sheet.
# Amounts are per design job/unit; quantity multiplies the selected rate.
DESIGNING_SHOP_RATES = {
    "minimum-basic": {
        "single-single": Decimal("30"),
        "single-double": Decimal("60"),
        "multi-single": Decimal("50"),
        "multi-double": Decimal("100"),
    },
    "minimum": {
        "single-single": Decimal("60"),
        "single-double": Decimal("120"),
        "multi-single": Decimal("100"),
        "multi-double": Decimal("250"),
    },
    "a4-notice": {
        "single-single": Decimal("90"),
        "single-double": Decimal("180"),
        "multi-single": Decimal("130"),
        "multi-double": Decimal("260"),
    },
    "visiting-card": {
        "single-single": Decimal("75"),
        "single-double": Decimal("150"),
        "multi-single": Decimal("75"),
        "multi-double": Decimal("150"),
    },
    "bit-notice": {
        "single-single": Decimal("75"),
        "single-double": Decimal("150"),
        "multi-single": Decimal("100"),
        "multi-double": Decimal("200"),
    },
}

DESIGNING_CHOICES = [
    {"id": "minimum-basic", "name": "Minimum - Basic"},
    {"id": "minimum", "name": "Minimum"},
    {"id": "a4-notice", "name": "A4 Notice"},
    {"id": "visiting-card", "name": "Visiting Card"},
    {"id": "bit-notice", "name": "Bit Notice"},
]
DESIGNING_VARIANTS = [
    {"id": "single-single", "name": "Single Color - Single Side"},
    {"id": "single-double", "name": "Single Color - Double Side"},
    {"id": "multi-single", "name": "Multi Color - Single Side"},
    {"id": "multi-double", "name": "Multi Color - Double Side"},
]


def _is_designing_category(category):
    return bool(category and category.name.strip().casefold() == "designing")


def _qty(p):
    try:
        q = int(p.get("qty", ""))
    except (TypeError, ValueError):
        return None
    return q if 1 <= q <= MAX_QTY else None


def _int(p, key):
    try:
        return int(p.get(key, ""))
    except (TypeError, ValueError):
        return None


def _is_formula(category_name):
    n = category_name.lower()
    return any(t in n for t in FORMULA_CATEGORIES)


# ----------------------------------------------------------------- formulas (port of pricing.js)
def _bill_book_print_cost(total_papers, is_legal, is_a5, is_a6):
    """Shop Bill Book printing charge, using the same slabs for every size.

    The A4 shop printing rates apply equally to A4, A5, A6 and Legal.
    Paper rates remain size-specific in _bill_book_price. Above 1,000 pages,
    charges repeat additively in 1,000-page blocks (e.g. 1,500 = 1,000 + 500).
    """
    if total_papers <= 0:
        return 0

    slabs = ((100, 100), (200, 125), (500, 150), (1000, 180))
    full_blocks, remainder = divmod(total_papers, 1000)
    total = full_blocks * slabs[-1][1]
    if remainder:
        for limit, cost in slabs:
            if remainder <= limit:
                total += cost
                break
    return total

def _bill_book_round_off(amount):
    rounded = js_round(amount)
    d = rounded % 10
    if d == 0 or d == 5:
        return rounded
    if 1 <= d <= 4:
        return rounded + (5 - d)
    return rounded + (10 - d)


def _bill_book_price(qty, job, variant, size):
    # Normalize the database values before applying size-specific paper rates.
    # A6 must use one-quarter of the configured A4 original and duplicate rates.
    variant = str(variant or "").strip().casefold()
    size = str(size or "").strip().casefold()
    size_key = "legal" if "legal" in size else "a6" if size == "a6" or size.startswith("a6 ") else "a5" if size == "a5" or size.startswith("a5 ") else "a4"

    total_books = qty
    total_papers = total_books * 100
    is_legal = size_key == "legal"
    is_a5 = size_key == "a5"
    is_a6 = size_key == "a6"

    rates = get_paper_rates()  # typed in Settings > Paper Price
    if size_key == "legal":
        original = rates["legal_original"]
        duplicate = rates["legal_duplicate"]
        design = BILL_BOOK_DESIGN_CHARGES["legal"]
    else:
        base_original = rates["low_original"] if "low" in variant else rates["standard_original"]
        base_duplicate = rates["duplicate"]
        size_divisor = 4 if size_key == "a6" else 2 if size_key == "a5" else 1
        original = base_original / size_divisor
        duplicate = base_duplicate / size_divisor
        design = BILL_BOOK_DESIGN_CHARGES[size_key]

    paper_rate = original + duplicate if ("dupl" in variant or "50p-30p" in variant or "70p-50p" in variant) else original
    paper_cost = js_round(total_papers * paper_rate * 100) / 100
    print_cost = _bill_book_print_cost(total_papers, is_legal, is_a5, is_a6)
    design_charge = design if total_books > 0 else 0

    binding_key = size_key
    binding = next(rate for limit, rate in BILL_BOOK_BINDING_SLABS[binding_key]
                   if limit is None or total_books <= limit)

    binding_cost = total_books * binding
    gross = js_round((paper_cost + print_cost + design_charge + binding_cost) * job * 100) / 100
    return _bill_book_round_off(gross)


def _notice_price(qty, job, size, variant):
    size, variant = size.lower(), variant.lower()
    is_legal = "legal" in size or "lgl" in size
    is_a5 = "a5" in size
    rates = get_paper_rates()  # Notice paper = the original paper price (A5 = half)
    paper_rate = rates["legal_original"] if is_legal else rates["standard_original"] / 2 if is_a5 else rates["standard_original"]
    paper_cost = js_round(qty * paper_rate * 100) / 100
    design = (200 if is_legal else 100 if is_a5 else 150) if qty > 0 else 0

    def slab(q):
        return 0 if q <= 0 else 150 if q <= 100 else 180 if q <= 200 else 200 if q < 500 else 250

    print_cost = (qty // 1000) * 250 + slab(qty % 1000)
    if "double" in variant:
        print_cost *= 2
        design *= 2
    return js_round((paper_cost + design + print_cost) * job * 100) / 100


def _printing_rate_card_total(category, size, variant, qty):
    """Calculate printing totals from the client's latest supplied rate cards.

    Each quantity band supplies a per-sheet rate for the whole job. The two
    values in a cell are single-side / double-side. A single value applies to
    either side where the rate card has no separate side price.
    Returns None only when this is not one of the rate-card printing services.
    Returns 0 when the service/size is recognised but that combination has no
    published rate, preventing an old database price from being used instead.
    """
    c = (category or "").casefold().replace("and", "&")
    s = (size or "").casefold().replace("×", "x").strip()
    v = (variant or "").casefold()

    if "color inkjet" in c or "colour inkjet" in c or "inkjet" in v:
        family = "inkjet"
    elif "color laser" in c or "colour laser" in c or "laser" in v:
        family = "laser"
    elif "executive bond" in c or "executive bond" in v:
        family = "bond"
    elif ("black & white" in c or "black and white" in c or "xerox black" in c
          or "black" in v or "b&w" in v):
        family = "black"
    elif "print out" in c:
        return None
    else:
        return None

    # Quantity bands are inclusive upper bounds; None means no upper bound.
    # Values are (single-side, double-side), in rupees per sheet.
    cards = {
        "black": {
            "a4": [(1, (3, 4)), (10, (3, 4)), (30, (2.00, 2.70)),
                   (50, (1.65, 2.50)), (125, (1.45, 2.25)),
                   (200, (1.20, 2.00)), (None, (0.90, 1.70))],
            "legal": [(1, (4, 6)), (10, (3, 5)), (30, (2.90, 4.20)),
                      (50, (2.70, 3.60)), (125, (2.50, 3.40)),
                      (200, (2.25, 3.20)), (None, (2.10, 2.80))],
            "a3": [(1, (8, 12)), (10, (7, 10)), (30, (4.50, 6.00)),
                   (50, (4.30, 5.80)), (125, (4.00, 5.50)),
                   (200, (3.75, 5.25)), (None, (3.40, 4.50))],
            "12x18": [(1, (35, 70)), (10, (33, 66)), (30, (20, 36)),
                      (50, (19, 34)), (125, (18, 32)),
                      (200, (17, 30)), (None, (16, 28))],
            "a4_sticker": [(1, (20, 20)), (10, (19, 19)), (30, (10, 10)),
                           (50, (9, 9)), (125, (8, 8)), (200, (7, 7)),
                           (None, (6, 6))],
            "a3_sticker": [(1, (60, 60)), (10, (55, 55)), (30, (30, 30)),
                           (50, (25, 25)), (125, (20, 20)), (200, (17, 17)),
                           (None, (15, 15))],
        },
        "bond": {
            "a4": [(1, (4, 6)), (10, (5, 6)), (30, (2.8, 3.5)),
                   (50, (2.6, 3.2)), (125, (2.4, 3.0)),
                   (200, (2.25, 2.8)), (None, (2.15, 2.6))],
            "a3": [(1, (5, 7)), (10, (6, 7)), (30, (6, 7.5)),
                   (50, (5.8, 7.2)), (125, (5.5, 6.75)),
                   (200, (5.25, 6.45)), (None, (4.9, 6.0))],
        },
        "inkjet": {
            "a4": [(1, (20, 40)), (10, (6, 10)), (30, (6, 10)),
                   (50, (5, 9)), (70, (5, 9)), (90, (4.5, 8.5)),
                   (100, (4.25, 8)), (None, (4, 7))],
            "legal": [(1, (15, 30)), (10, (8, 12)), (30, (8, 12)),
                      (50, (7, 11)), (70, (7, 11)), (90, (6.5, 10)),
                      (100, (6.25, 9.5)), (None, (6, 9.5))],
            "a4_sticker": [(1, (25, 25)), (10, (8, 8)), (30, (7, 7)),
                           (50, (6.25, 6.25)), (70, (6.25, 6.25)),
                           (90, (6, 6)), (100, (5.75, 5.75)),
                           (None, (5.5, 5.5))],
        },
        "laser": {
            "a4": [(1, (20, 40)), (10, (6, 11)), (30, (6, 10)),
                   (50, (5.5, 10)), (70, (5, 9)), (90, (4.75, 8.5)),
                   (100, (4.5, 8)), (None, (4.15, 7.5))],
            "legal": [(1, (35, 70)), (10, (12, 20)), (30, (11, 19)),
                      (50, (10.5, 18.5)), (70, (10.25, 18.25)),
                      (90, (10, 18)), (100, (9.5, 17.5)),
                      (None, (9, 16))],
            "a3": [(1, (35, 70)), (10, (14, 22)), (30, (13, 21)),
                   (50, (12, 19)), (70, (11.5, 18.5)),
                   (90, (11, 18)), (100, (10.5, 17.5)),
                   (None, (10, 17))],
            "12x18_170": [(1, (35, 70)), (10, (16, 28)), (30, (16, 26)),
                          (50, (16, 24)), (70, (15, 22)), (90, (15, 20)),
                          (100, (14, 20)), (None, (13, 20))],
            "12x18_220": [(1, (36, 70)), (10, (16, 28)), (30, (16, 26)),
                          (50, (16, 24)), (70, (15, 22)), (90, (15, 20)),
                          (100, (14, 20)), (None, (13, 20))],
            "12x18_250": [(1, (37, 70)), (10, (17, 30)), (30, (17, 27)),
                          (50, (17, 25)), (70, (16, 23)), (90, (16, 23)),
                          (100, (15, 23)), (None, (15, 22))],
            "12x18_300": [(1, (38, 70)), (10, (18, 30)), (30, (18, 28)),
                          (50, (17, 26)), (70, (17, 24)), (90, (16, 24)),
                          (100, (16, 24)), (None, (16, 24))],
            "12x18_sticker": [(1, (30, 30)), (10, (25, 25)), (30, (23, 23)),
                              (50, (20, 20)), (70, (16, 16)), (90, (16, 16)),
                              (100, (15, 15)), (None, (15, 15))],
        },
    }

    # Resolve the size row, checking sticker / GSM variants before generic sizes.
    if "12x18" in s or "12 x 18" in s:
        if "sticker" in s:
            size_key = "12x18_sticker"
        elif "300" in s:
            size_key = "12x18_300"
        elif "250" in s:
            size_key = "12x18_250"
        elif "220" in s:
            size_key = "12x18_220"
        elif "170" in s:
            size_key = "12x18_170"
        else:
            size_key = "12x18"
    elif "a4" in s and "stic" in s:
        size_key = "a4_sticker"
    elif "a3" in s and "stic" in s:
        size_key = "a3_sticker"
    elif "legal" in s or s.strip() == "lgl" or "lgl" in s:
        size_key = "legal"
    elif "a3" in s:
        size_key = "a3"
    elif "a4" in s:
        size_key = "a4"
    else:
        return 0

    family_rows = cards.get(family, {})
    rows = family_rows.get(size_key)
    if rows is None:
        return 0

    is_double = any(token in v for token in (
        "double", "duplex", "both side", "black d", "inkjet d", "laser d",
        "bond d", "d/s", "double side", "2 side", "both-side"
    ))
    side_index = 1 if is_double else 0

    for upper_limit, side_rates in rows:
        if upper_limit is None or qty <= upper_limit:
            rate = side_rates[side_index]
            return 0 if rate is None else float(rate) * qty
    return 0


def _normal_gross(category, size, variant, qty, db_price, job=1):
    rate_card_total = _printing_rate_card_total(category, size, variant, qty)
    if rate_card_total is not None:
        return rate_card_total * job
    has = lambda s, t: t in s  # noqa: E731 - mirrors the JS helper
    if any(has(category, t) for t in ("banner", "poster", "letter pad", "printing", "invitation")):
        return db_price * job
    if has(category, "notice"):
        return _notice_price(qty, job, size, variant)
    if has(category, "bill book"):
        return _bill_book_price(qty, job, variant, size)
    if has(category, "train ticket"):
        if has(size, "minimum"):
            return 50 + (qty - 1) * 20
        if has(size, "thakkal"):
            return 75 + (qty - 1) * 20
        if has(size, "premium"):
            return 100 + (qty - 1) * 20
        return 0
    if has(category, "online application"):
        if has(size, "patta") or has(size, "chitta") or has(size, "ec"):
            return 20 if qty <= 3 else 20 + (qty - 3) * 5
        return qty * db_price * job
    if has(category, "print out"):
        black_s, black_d = has(variant, "black s"), has(variant, "black d")
        ink_s, ink_d = has(variant, "color inkjet s"), has(variant, "color inkjet d")
        a4 = has(size, "a4") or has(size, "legal")
        regular = qty * db_price * job
        if has(size, "sticker"):
            return regular
        if black_s or black_d:
            if a4:
                if black_s:
                    if qty <= 10:
                        return 10 + (qty - 1) * 3
                    if qty <= 20:
                        return 37 + (qty - 10) * 3
                    return regular
                if qty <= 10:
                    return 10 + (qty - 1) * 4
                if qty <= 20:
                    return 46 + (qty - 10) * 4
                return regular
            if has(size, "a3"):
                if qty <= 9:
                    return (15 if black_s else 20) + (qty - 1) * 7
                return regular
            return regular
        if ink_s or ink_d:
            if a4:
                if qty <= 10:
                    return (15 if ink_s else 25) + (qty - 1) * 10
                return regular
            return regular
        return regular
    return qty * db_price * job


def _shop_discount_percent(category, qty, rule_shop_discount):
    """Shop Portal uses the configured shop rate directly; no shop discount applies."""
    return 0


# ----------------------------------------------------------------- /services/
def _normal_services():
    """Categories with code-managed price rules -> service cards."""
    categories = {c.name.strip().casefold(): c for c in Category.objects.all()}
    sizes, lowest = {}, {}
    for rule in iter_price_rules():
        cat_key = rule.category_name.strip().casefold()
        category = categories.get(cat_key)
        if not category:
            continue
        size = Size.objects.filter(category=category, name__iexact=rule.size_name).first()
        if not size:
            continue
        sizes.setdefault(category.id, set()).add(size.id)
        if rule.price and rule.price > 0:
            # Xerox/Print rules are already final shop rates; applying the
            # stored generic shop discount here would understate the card price.
            if "xerox" in category.name.casefold():
                shop_price = float(rule.price)
            else:
                shop_price = float(rule.price)
            lowest[category.id] = min(lowest.get(category.id, shop_price), shop_price)
    out = []
    for cid, size_ids in sizes.items():
        category = Category.objects.filter(pk=cid).first()
        if not category:
            continue
        name = category.name
        n = len(size_ids) + (1 if name.strip().casefold() == "designing" else 0)
        out.append({
            "key": f"normal-{cid}", "kind": "normal", "id": cid, "name": pretty(name),
            "description": f"{n} size option{'s' if n != 1 else ''}",
            "from_price": None if _is_formula(name) or cid not in lowest else custom_round(lowest[cid]),
        })
    return out

def _digital_services():
    cats = {c.id: c.name for c in DigitalCategory.objects.all()}
    papers, lowest = {}, {}
    rows = (DigitalPrice.objects.filter(lamination__isnull=False)
            .values_list("lamination__product__gsm__category_id", "lamination__product__gsm_id", "shop_rate"))
    for cid, gid, rate in rows:
        papers.setdefault(cid, set()).add(gid)
        if rate and rate > 0:
            lowest[cid] = min(lowest.get(cid, rate), rate)
    out = []
    for cid, gsm_ids in papers.items():
        name = cats.get(cid)
        if not name:
            continue
        n = len(gsm_ids)
        out.append({
            "key": f"digital-{cid}", "kind": "digital", "id": cid, "name": pretty(name),
            "description": f"{n} paper type{'s' if n != 1 else ''}",
            "from_price": custom_round(float(lowest[cid])) if cid in lowest else None,
        })
    return out


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_services(request):
    services = _digital_services() + _normal_services()
    services.sort(key=lambda s: s["name"].lower())
    return Response({"services": services})


# ----------------------------------------------------------------- /services/<kind>/<id>/
def _side_label(value):
    return dict(DigitalPrice.SIDE_CHOICES).get(value, "Standard")


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_service_detail(request, kind, pk):
    if kind == "normal":
        cat = Category.objects.filter(pk=pk).first()
        if not cat:
            raise Http404
        if _is_designing_category(cat):
            return Response({
                "kind": "normal", "id": cat.id, "name": pretty(cat.name),
                "sizes": [
                    {"id": item["id"], "name": item["name"],
                     "variants": DESIGNING_VARIANTS}
                    for item in DESIGNING_CHOICES
                ],
            })
        configured = get_price_rules(category_name=cat.name)
        if not configured:
            raise Http404
        sizes = {}
        is_bill_book = "bill book" in cat.name.casefold()
        for rule in configured:
            size = Size.objects.filter(category=cat, name__iexact=rule.size_name).first()
            if not size:
                continue
            s = sizes.setdefault(size.id, {"id": size.id, "name": size.name, "variants": {}})
            if rule.variant_name:
                original_variant_name = rule.variant_name.strip()
                if is_bill_book:
                    normalized = original_variant_name.casefold()
                    # Only show the two duplicate-print options requested for the Shop Portal.
                    # Keep the database variant ID/name underneath so order pricing still resolves
                    # against the existing configured rule.
                    # A4/A5/A5/2 use 50p-30p; LEGAL uses 70p-50p.
                    # Both should map to the same two customer-facing choices.
                    has_duplicate_paper = "50p-30p" in normalized or "70p-50p" in normalized
                    is_regular_duplicate = has_duplicate_paper and "low" not in normalized and "print" in normalized
                    is_low_duplicate = has_duplicate_paper and "low" in normalized and "print" in normalized
                    if not (is_regular_duplicate or is_low_duplicate):
                        continue
                variant = Variant.objects.filter(size=size, name__iexact=original_variant_name).first()
                if variant:
                    display_name = variant.name
                    if is_bill_book:
                        display_name = "Dupl. Low Print" if "low" in original_variant_name.casefold() else "Dupl. Print"
                    s["variants"][variant.id] = {"id": variant.id, "name": display_name, "order": variant.display_order}
        size_list = []
        for s in sorted(sizes.values(), key=lambda s: s["name"].lower()):
            variants = sorted(s["variants"].values(), key=lambda v: (v["order"], v["name"].lower()))
            size_list.append({"id": s["id"], "name": s["name"],
                              "variants": [{"id": v["id"], "name": v["name"]} for v in variants]})
        if not size_list:
            raise Http404
        return Response({"kind": "normal", "id": cat.id, "name": pretty(cat.name), "sizes": size_list})

    if kind == "digital":
        cat = DigitalCategory.objects.filter(pk=pk).first()
        rows = (DigitalPrice.objects.filter(lamination__product__gsm__category_id=pk)
                .values_list("lamination__product__gsm_id", "lamination__product__gsm__name",
                             "lamination__product_id", "lamination__product__name",
                             "lamination_id", "lamination__name",
                             "side", "delivery_type_id", "delivery_type__name").distinct())
        if not cat or not rows:
            raise Http404
        papers = {}
        for gid, gname, pid, pname, lid, lname, side, did, dname in rows:
            g = papers.setdefault(gid, {"id": gid, "name": gname, "sizes": {}})
            p = g["sizes"].setdefault(pid, {"id": pid, "name": pname, "finishes": {}})
            f = p["finishes"].setdefault(lid, {"id": lid, "name": lname, "sides": {}, "deliveries": {}})
            f["sides"][side or ""] = {"value": side or "", "label": _side_label(side)}
            f["deliveries"][did] = {"id": did, "name": dname}
        data = []
        for g in sorted(papers.values(), key=lambda x: x["name"].lower()):
            sizes = []
            for p in sorted(g["sizes"].values(), key=lambda x: x["name"].lower()):
                finishes = [{"id": f["id"], "name": f["name"],
                             "sides": sorted(f["sides"].values(), key=lambda x: x["label"]),
                             "deliveries": sorted(f["deliveries"].values(), key=lambda x: x["name"].lower())}
                            for f in sorted(p["finishes"].values(), key=lambda x: x["name"].lower())]
                sizes.append({"id": p["id"], "name": p["name"], "finishes": finishes})
            data.append({"id": g["id"], "name": g["name"], "sizes": sizes})
        return Response({"kind": "digital", "id": cat.id, "name": pretty(cat.name), "papers": data})

    raise Http404


# ----------------------------------------------------------------- /price/
NO_PRICE = {"available": False, "estimate": None, "discount_percent": 0}


def estimate_for(p):
    """Shop price for one cart line. p = {kind, qty, ...ids}. Always returns the NO_PRICE shape or a price."""
    qty = _qty(p)
    if qty is None:
        return NO_PRICE

    if p.get("kind") == "digital":
        side = p.get("side") or ""
        row = (DigitalPrice.objects.filter(
            lamination_id=_int(p, "lamination_id"), delivery_type_id=_int(p, "delivery_id"),
            side=side or None, min_qty__lte=qty)
            .filter(Q(max_qty__gte=qty) | Q(max_qty__isnull=True)).order_by("-min_qty").first())
        if not row or row.shop_rate <= 0:
            return NO_PRICE
        # one slab rate for the whole job (not qty x rate), same as the admin billing screen
        return {"available": True, "estimate": custom_round(float(row.shop_rate)), "discount_percent": 0}

    if p.get("kind") == "normal":
        cid = _int(p, "service_id")
        category_obj = Category.objects.filter(pk=cid).first()
        if _is_designing_category(category_obj):
            size_key = str(p.get("size_id") or "")
            variant_key = str(p.get("variant_id") or "")
            rate = DESIGNING_SHOP_RATES.get(size_key, {}).get(variant_key)
            if rate is None:
                return NO_PRICE
            total = rate * Decimal(qty)
            return {"available": True, "estimate": custom_round(total), "discount_percent": 0,
                    "unit_rate": str(rate), "quantity": qty}

        sid, vid = _int(p, "size_id"), _int(p, "variant_id")
        category_obj = Category.objects.filter(pk=cid).first()
        size_obj = Size.objects.filter(pk=sid, category=category_obj).first() if category_obj else None
        variant_obj = Variant.objects.filter(pk=vid, size=size_obj).first() if size_obj else None
        if not category_obj or not size_obj or not variant_obj:
            return NO_PRICE
        category = category_obj.name.lower()
        size = size_obj.name.lower()
        variant = variant_obj.name.lower()
        rule = get_code_price_rule(category_obj.name, size_obj.name, variant_obj.name, qty)
        latest = rule or get_latest_price_rule(category_obj.name, size_obj.name, variant_obj.name)

        # Formula-priced services (especially Bill Book) must not depend on a
        # database PriceRule existing for every size/variant. A6 variants may
        # be valid dropdown entries without their own legacy PriceRule row.
        # Requiring `latest` here silently falls back to customer-side pricing
        # in the billing preview, which is why A6 showed the old ₹290 amount.
        formula_priced = _is_formula(category)
        if latest is None and not formula_priced:
            return NO_PRICE

        db_price = float(rule.price or 0) if rule else 0.0
        if db_price <= 0 and not formula_priced:
            return NO_PRICE

        gross = _normal_gross(category, size, variant, qty, db_price)
        if gross <= 0:
            return NO_PRICE
        pct = _shop_discount_percent(category, qty, float(latest.shop_discount or 0) if latest else 0)
        total = gross - gross * (pct / 100)
        return {"available": True, "estimate": custom_round(round2(total)), "discount_percent": pct}

    return NO_PRICE


def describe(p):
    """-> (service_name, [{label, value}, ...]) built from the database, or None when the
    combination does not exist.  Used when a request is submitted, so names are never taken from the browser."""
    if p.get("kind") == "normal":
        category = Category.objects.filter(pk=_int(p, "service_id")).first()
        if _is_designing_category(category):
            size_key = str(p.get("size_id") or "")
            variant_key = str(p.get("variant_id") or "")
            size_label = next((x["name"] for x in DESIGNING_CHOICES if x["id"] == size_key), None)
            variant_label = next((x["name"] for x in DESIGNING_VARIANTS if x["id"] == variant_key), None)
            if not size_label or not variant_label or variant_key not in DESIGNING_SHOP_RATES.get(size_key, {}):
                return None
            color_label, side_label = variant_label.split(" - ", 1)
            return pretty(category.name), [
                {"label": "Design", "value": size_label},
                {"label": "Color", "value": color_label},
                {"label": "Side", "value": side_label},
            ]
        size = Size.objects.filter(pk=_int(p, "size_id"), category=category).first() if category else None
        variant = Variant.objects.filter(pk=_int(p, "variant_id"), size=size).first() if size else None
        if not category or not size or not variant or not get_price_rules(category.name, size.name, variant.name):
            return None
        spec = [{"label": "Size", "value": size.name}, {"label": "Option", "value": variant.name}]
        return pretty(category.name), spec

    if p.get("kind") == "digital":
        lid, did, side = _int(p, "lamination_id"), _int(p, "delivery_id"), p.get("side") or ""
        rows = DigitalPrice.objects.filter(lamination_id=lid)
        if not rows.filter(delivery_type_id=did, side=side or None).exists():
            return None
        lam = DigitalLamination.objects.select_related("product__gsm__category").get(pk=lid)
        spec = [
            {"label": "Paper Type", "value": lam.product.gsm.name},
            {"label": "Size", "value": lam.product.name},
            {"label": "Printing", "value": _side_label(side or None)},
            {"label": "Finish", "value": lam.name},
        ]
        if rows.values("delivery_type_id").distinct().count() > 1:
            spec.append({"label": "Delivery", "value": rows.filter(delivery_type_id=did).first().delivery_type.name})
        return pretty(lam.product.gsm.category.name), spec

    return None


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_visiting_card_price(request):
    p = request.query_params
    try:
        result = calculate_visiting_card_price(
            gsm=p.get("gsm"), size=p.get("size"), qty=p.get("qty"),
            sides=p.get("sides", "single"), price_type="shop",
            method=p.get("method"), lamination=p.get("lamination", "Without Lamination"), jobs=p.get("jobs", 1),
        )
    except ValueError as exc:
        return Response({"available": False, "error": str(exc)}, status=400)
    return Response(result)


@api_view(["GET"])
@permission_classes([IsShopUser])
def shop_price(request):
    return Response(estimate_for(request.query_params))
