"""Visiting-card rates shared by the ERP and Shop Portal.

Digital rates use the supplied per-card GSM/quantity table and digital lamination
surcharges. Offset rates use fixed 500/1000-card job prices; the Job count
multiplies that fixed job price. Digital and Offset base rates are intentionally
kept as separate branches so future rate changes do not require a schema change.
"""
from decimal import Decimal, ROUND_HALF_UP

GSM_OPTIONS = ("100 GSM", "130 GSM", "170 GSM", "220 GSM", "250 GSM", "300 GSM")
SIZE_OPTIONS = ("3.5 x 2",)
LAMINATION_OPTIONS = (
    "Without Lamination", "Single Side (Glossy)", "Double Side (Glossy)",
    "Single Side (3D)", "Double Side (3D)", "Single Side (Matt)", "Double Side (Matt)",
)
DIGITAL_LAMINATION_RATES = {
    "Without Lamination": Decimal("0"), "Single Side (Glossy)": Decimal("10"),
    "Double Side (Glossy)": Decimal("20"), "Single Side (3D)": Decimal("15"),
    "Double Side (3D)": Decimal("30"), "Single Side (Matt)": Decimal("12"),
    "Double Side (Matt)": Decimal("24"),
}

# Offset price is for one complete job of 500 or 1000 cards, not a per-card rate.
OFFSET_RATES = {
    "shop": {
        "single": {
            "Single Side (Glossy)": {500: Decimal("310"), 1000: Decimal("425")},
            "Single Side (Matt)": {500: Decimal("330"), 1000: Decimal("450")},
        },
        "double": {
            "Double Side (Glossy)": {500: Decimal("450"), 1000: Decimal("575")},
            "Double Side (Matt)": {500: Decimal("500"), 1000: Decimal("625")},
        },
    },
    "customer": {
        "single": {
            "Single Side (Glossy)": {500: Decimal("650"), 1000: Decimal("750")},
            "Single Side (Matt)": {500: Decimal("700"), 1000: Decimal("800")},
        },
        "double": {
            "Double Side (Glossy)": {500: Decimal("900"), 1000: Decimal("1050")},
            "Double Side (Matt)": {500: Decimal("950"), 1000: Decimal("1100")},
        },
    },
}

# Each cell is (single-side rate, double-side rate), per card.
SHOP_RATES = {
    "12 x 18": {
        "100 GSM": [(12,20),(11,19),(10.5,18.5),(10.25,18.25),(10,18),(9.5,17.5),(9,16)],
        "130 GSM": [(14,22),(13,21),(12,19),(11.5,18.5),(11,18),(10.5,17.5),(10,17)],
        "170 GSM": [(16,28),(16,26),(16,24),(15,22),(15,20),(14,20),(13,20)],
        "220 GSM": [(16,28),(16,26),(16,24),(15,22),(15,20),(14,20),(13,20)],
        "250 GSM": [(17,30),(17,27),(17,25),(16,23),(16,23),(15,23),(15,22)],
        "300 GSM": [(18,30),(18,28),(17,26),(17,24),(16,24),(16,24),(16,24)],
    },
    "13 x 19": {
        "100 GSM": [(14,22),(13,21),(12.5,20.5),(12.25,20.25),(12,20),(11.5,19.5),(11,18)],
        "130 GSM": [(16,24),(15,23),(14,21),(13.5,20.5),(13,20),(12.5,19.5),(12,19)],
        "170 GSM": [(18,30),(18,28),(18,26),(17,24),(17,22),(16,22),(15,22)],
        "220 GSM": [(18,30),(18,28),(18,26),(17,24),(17,22),(16,22),(15,22)],
        "250 GSM": [(19,32),(19,29),(19,27),(18,25),(18,25),(17,25),(17,24)],
        "300 GSM": [(20,32),(20,30),(19,28),(19,26),(18,26),(18,26),(18,26)],
    },
}
CUSTOMER_RATES = {
    "12 x 18": {
        "100 GSM": [(28,56),(26,52),(24,48),(22,44),(20,40),(18,36),(16,32)],
        "130 GSM": [(28,56),(26,52),(24,48),(22,44),(20,40),(18,36),(16,32)],
        "170 GSM": [(28,56),(26,52),(24,48),(22,44),(20,40),(18,36),(16,32)],
        "220 GSM": [(28,56),(26,52),(24,48),(22,44),(20,40),(18,36),(16,32)],
        "250 GSM": [(29,58),(27,54),(25,50),(23,46),(21,42),(19,38),(17,43)],
        "300 GSM": [(30,60),(28,56),(26,52),(24,48),(22,44),(20,40),(18,36)],
    },
    "13 x 19": {
        "100 GSM": [(30,58),(28,54),(26,50),(24,46),(22,42),(20,38),(18,34)],
        "130 GSM": [(30,58),(28,54),(26,50),(24,46),(22,42),(20,38),(18,34)],
        "170 GSM": [(30,58),(28,54),(26,50),(24,46),(22,42),(20,38),(18,34)],
        "220 GSM": [(30,58),(28,54),(26,50),(24,46),(22,42),(20,38),(18,34)],
        "250 GSM": [(31,60),(29,56),(27,52),(25,48),(23,44),(21,40),(19,45)],
        "300 GSM": [(32,62),(30,58),(28,54),(26,50),(24,46),(22,42),(20,38)],
    },
}


def _normalise_size(value):
    return " ".join(str(value or "").lower().replace("×", "x").split())


def size_group(size):
    if _normalise_size(size) != "3.5 x 2":
        raise ValueError("Visiting Card size must be 3.5 x 2.")
    return "12 x 18"


def quantity_slab_index(qty):
    q = int(qty)
    if q <= 10: return 0, "2-10"
    if q <= 30: return 1, "11-30"
    if q <= 50: return 2, "31-50"
    if q <= 70: return 3, "51-70"
    if q <= 90: return 4, "71-90"
    if q <= 100: return 5, "91-100"
    return 6, "above 100"


def _side_key(sides):
    value = str(sides or "").strip().lower()
    if value in ("single", "single side", "s/d"):
        return "single", "Single side", 0
    if value in ("double", "double side", "d/d"):
        return "double", "Double side", 1
    raise ValueError("Select single-side or double-side printing.")


def calculate_visiting_card_price(*, gsm=None, size="3.5 x 2", qty, sides,
                                   price_type="customer", method=None,
                                   lamination="Without Lamination", jobs=1):
    try:
        quantity = int(qty)
        job_count = int(jobs or 1)
    except (TypeError, ValueError):
        raise ValueError("Enter a valid quantity and job count.")
    if job_count < 1 or job_count > 10000:
        raise ValueError("Job count must be between 1 and 10,000.")
    if quantity < 1 or quantity > 1_000_000:
        raise ValueError("Quantity must be between 1 and 1,000,000.")

    method_value = str(method or "").strip().lower()
    if method_value not in ("digital", "offset"):
        raise ValueError("Select a printing type: Digital or Offset.")
    side_value, side_name, side_index = _side_key(sides)
    lamination_value = str(lamination or "").strip()
    rate_type = "shop" if str(price_type).lower() == "shop" else "customer"

    if method_value == "offset":
        if quantity not in (500, 1000):
            raise ValueError("Offset quantity must be 500 or 1000 cards per job.")
        allowed = OFFSET_RATES[rate_type][side_value]
        if lamination_value not in allowed:
            raise ValueError("Select a lamination that matches the selected print variant.")
        one_job_price = allowed[lamination_value][quantity]
        total = (one_job_price * job_count).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        per_card = (one_job_price / Decimal(quantity)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
        return {
            "available": True, "rate_type": rate_type, "method": method_value,
            "gsm": "", "size": "3.5 x 2", "quantity": quantity,
            "quantity_slab": f"{quantity} cards per job", "sides": side_value,
            "side_name": side_name, "lamination": lamination_value,
            "jobs": job_count, "base_unit_price": str(per_card),
            "lamination_unit_price": "0.00", "unit_price": str(per_card),
            "rate": str(one_job_price), "job_price": str(one_job_price),
            "total": str(total), "estimate": str(total),
        }

    gsm_value = str(gsm or "").strip().upper().replace("GSM", "").strip() + " GSM"
    if gsm_value not in GSM_OPTIONS:
        raise ValueError("Select a valid GSM.")
    actual_size = _normalise_size(size)
    if actual_size != "3.5 x 2":
        raise ValueError("Select the visiting card size 3.5 x 2.")
    if lamination_value not in DIGITAL_LAMINATION_RATES:
        raise ValueError("Select a valid lamination option.")
    group = size_group(actual_size)
    table = SHOP_RATES if rate_type == "shop" else CUSTOMER_RATES
    slab_index, slab = quantity_slab_index(quantity)
    base_rate = Decimal(str(table[group][gsm_value][slab_index][side_index])).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    lamination_rate = DIGITAL_LAMINATION_RATES[lamination_value]
    unit_rate = (base_rate + lamination_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    total = (unit_rate * quantity * job_count).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {
        "available": True, "rate_type": rate_type, "method": method_value,
        "gsm": gsm_value, "size": "3.5 x 2", "size_group": group,
        "quantity": quantity, "quantity_slab": slab, "sides": side_value,
        "side_name": side_name, "lamination": lamination_value, "jobs": job_count,
        "base_unit_price": str(base_rate), "lamination_unit_price": str(lamination_rate),
        "unit_price": str(unit_rate), "rate": str(unit_rate),
        "job_price": str(unit_rate * quantity), "total": str(total), "estimate": str(total),
    }
