"""Settings > Paper Price (admin only).

    GET   /api/settings/paper-prices/   -> {standard_original, low_original, duplicate, legal_original, legal_duplicate}
    PATCH /api/settings/paper-prices/   {any of the five keys}  -> the saved values

Prices are rupees per sheet. The Billing / Order / Quotation screens receive the saved values
inside /api/billing/price/ (paper_rates), and the Shop Portal formulas read them server-side.
"""
from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .api_views import IsSuperuser
from .models import PaperRate
from .paper_prices import PAPER_FIELDS, clean_rate, get_paper_rates


@api_view(["GET", "PATCH"])
@permission_classes([IsSuperuser])
def settings_paper_prices(request):
    if request.method == "PATCH":
        d = request.data
        values = {}
        try:
            for key, label in PAPER_FIELDS:
                if key in d:
                    values[key] = clean_rate(d.get(key), label)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        if values:
            with transaction.atomic():
                row = PaperRate.objects.select_for_update().order_by("id").first()
                if row is None:
                    # first save: start from the values currently in use, then apply the change
                    row = PaperRate(**{k: v for k, v in get_paper_rates().items()})
                for key, val in values.items():
                    setattr(row, key, val)
                row.save()
    return Response(get_paper_rates())
