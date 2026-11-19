"""Profit & Loss report and expense entries (admin only).

    GET  /api/reports/pnl/?date_from=&date_to=
         -> the whole statement: revenue, cost of sales, gross profit, operating expenses, net profit
    GET  /api/reports/pnl/export/?file=xlsx|pdf&date_from=&date_to=
         -> the same statement as an Excel or PDF file

    GET  /api/expenses/?date_from=&date_to=&category=&q=&page=   -> {count, next, previous, results, summary, categories}
    POST /api/expenses/                                          -> add an expense
    PUT/PATCH/DELETE /api/expenses/<id>/                         -> edit / remove one

How the numbers are defined (same period rules as the other reports):
    Printing sales  = sum of Bill.final_amount for bills dated inside the period (same as the Sales report)
    Other income    = membership fees (MembershipTransaction.amount) taken inside the period
    Cost of sales   = expenses entered under "Paper, ink and printing materials" + "Outsourced printing"
    Operating exp.  = expenses entered under rent, staff salaries, electricity / maintenance, other
    Gross profit    = revenue - cost of sales          Net profit = gross profit - operating expenses

Expenses are the only numbers typed in by hand - there is nothing else in the system that knows what the
shop spent on paper, rent or salaries. The URLs for this file must stay ABOVE "reports/<kind>/" in api_urls.py.
Kept in its own file so reports_api.py / api_views.py do not have to change (same pattern as membership_api.py).
"""
from decimal import Decimal, InvalidOperation
from io import BytesIO

from django.db.models import Count, Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .api_views import IsSuperuser
from .models import EXPENSE_CATEGORIES, Bill, Expense, MembershipTransaction
from .reports_api import ZERO, ReportPagination, _day, _dec, _period, _period_json

CATEGORY_KEYS = [k for k, _, _ in EXPENSE_CATEGORIES]
CATEGORY_LABEL = {k: label for k, label, _ in EXPENSE_CATEGORIES}
CATEGORY_GROUP = {k: group for k, _, group in EXPENSE_CATEGORIES}
MAX_AMOUNT = Decimal("99999999.99")       # DecimalField(max_digits=10, decimal_places=2)
CENT = Decimal("0.01")


def _pct(part, whole):
    return round(float(part / whole * 100), 1) if whole > 0 else None


# ------------------------------------------------------------ the statement
def _statement(start, end):
    sales = Bill.objects.filter(bill_date__range=(start, end)).aggregate(t=Sum("final_amount"))["t"]
    fees = (MembershipTransaction.objects.filter(created_at__date__range=(start, end))
            .aggregate(t=Sum("amount"))["t"])
    spent = {r["category"]: r for r in
             Expense.objects.filter(expense_date__range=(start, end)).order_by()
             .values("category").annotate(t=Sum("amount"), n=Count("id"))}

    def expense_lines(group):
        return [{"key": k, "label": label, "amount": _dec(spent[k]["t"]) if k in spent else ZERO,
                 "entries": spent[k]["n"] if k in spent else 0}
                for k, label, g in EXPENSE_CATEGORIES if g == group]

    revenue_lines = [
        {"key": "sales", "label": "Printing sales", "amount": _dec(sales), "note": "Bills in this period"},
        {"key": "other_income", "label": "Other income", "amount": _dec(fees), "note": "Membership fees"},
    ]
    cost_lines = expense_lines("cost_of_sales")
    opex_lines = expense_lines("operating")

    revenue = sum((l["amount"] for l in revenue_lines), ZERO)
    cost = sum((l["amount"] for l in cost_lines), ZERO)
    opex = sum((l["amount"] for l in opex_lines), ZERO)
    gross = revenue - cost
    net = gross - opex

    return {
        "summary": {
            "revenue": revenue, "total_expenses": cost + opex, "net_profit": net,
            "gross_profit": gross, "gross_margin": _pct(gross, revenue), "net_margin": _pct(net, revenue),
        },
        "revenue": {"lines": revenue_lines, "total": revenue},
        "cost_of_sales": {"lines": cost_lines, "total": cost},
        "gross_profit": gross,
        "operating_expenses": {"lines": opex_lines, "total": opex},
        "net_profit": net,
    }


@api_view(["GET"])
@permission_classes([IsSuperuser])
def pnl_report(request):
    start, end = _period(request.query_params)
    return Response({"period": _period_json(start, end), **_statement(start, end)})


# ------------------------------------------------------------------ exports
def _statement_rows(st):
    """The statement as a flat list of (kind, label, amount) - one list drives both Excel and PDF.
    kind: section | line | total | grand | blank"""
    rows = [("section", "REVENUE", None)]
    rows += [("line", l["label"], l["amount"]) for l in st["revenue"]["lines"]]
    rows += [("total", "Total Revenue", st["revenue"]["total"]), ("blank", "", None),
             ("section", "COST OF SALES", None)]
    rows += [("line", l["label"], l["amount"]) for l in st["cost_of_sales"]["lines"]]
    rows += [("total", "Total Cost of Sales", st["cost_of_sales"]["total"]), ("blank", "", None),
             ("grand", "GROSS PROFIT" if st["gross_profit"] >= 0 else "GROSS LOSS", st["gross_profit"]),
             ("blank", "", None), ("section", "OPERATING EXPENSES", None)]
    rows += [("line", l["label"], l["amount"]) for l in st["operating_expenses"]["lines"]]
    rows += [("total", "Total Operating Expenses", st["operating_expenses"]["total"]), ("blank", "", None),
             ("grand", "NET PROFIT" if st["net_profit"] >= 0 else "NET LOSS", st["net_profit"])]
    return rows


def _period_text(start, end):
    return f"From {start.strftime('%d-%m-%Y')} To {end.strftime('%d-%m-%Y')}"


def _export_xlsx(st, start, end):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    wb = Workbook()
    ws = wb.active
    ws.title = "Profit & Loss"
    ws.merge_cells("A1:B1")
    ws["A1"] = "STAR OFFSET PRINTING - PROFIT & LOSS STATEMENT"
    ws["A1"].font = Font(size=14, bold=True)
    ws["A1"].alignment = Alignment(horizontal="center")
    ws.merge_cells("A2:B2")
    ws["A2"] = _period_text(start, end)
    ws["A2"].alignment = Alignment(horizontal="center")
    ws.append([])
    ws.append(["Particulars", "Amount (Rs.)"])
    for c in ws[ws.max_row]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="111827")
        c.alignment = Alignment(horizontal="center")

    top = Border(top=Side(style="thin"))
    for kind, label, amount in _statement_rows(st):
        if kind == "blank":
            ws.append([])
            continue
        ws.append([("    " + label) if kind == "line" else label,
                   float(amount) if amount is not None else None])
        row = ws[ws.max_row]
        row[1].number_format = "#,##0.00;[Red]-#,##0.00"
        if kind == "section":
            for c in row:
                c.font = Font(bold=True)
                c.fill = PatternFill("solid", fgColor="F3F4F6")
        elif kind == "total":
            for c in row:
                c.font = Font(bold=True)
                c.border = top
        elif kind == "grand":
            for c in row:
                c.font = Font(bold=True, size=12)
                c.fill = PatternFill("solid", fgColor="FEF3C7")
                c.border = top

    ws.column_dimensions["A"].width = 44
    ws.column_dimensions["B"].width = 20
    out = BytesIO()
    wb.save(out)
    return out.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _export_pdf(st, start, end):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    def money(v):
        return ("-" if v < 0 else "") + "Rs. {:,.2f}".format(abs(float(v)))

    data, style = [["Particulars", "Amount"]], [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for kind, label, amount in _statement_rows(st):
        i = len(data)
        data.append([("    " + label) if kind == "line" else label, "" if amount is None else money(amount)])
        if kind == "section":
            style += [("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"), ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f3f4f6"))]
        elif kind == "total":
            style += [("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"), ("LINEABOVE", (0, i), (-1, i), 0.6, colors.HexColor("#9ca3af"))]
        elif kind == "grand":
            loss = amount < 0
            style += [("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"), ("FONTSIZE", (0, i), (-1, i), 11),
                      ("BACKGROUND", (0, i), (-1, i), colors.HexColor("#fee2e2" if loss else "#fef3c7")),
                      ("LINEABOVE", (0, i), (-1, i), 1, colors.HexColor("#111827"))]
        elif kind == "blank":
            style += [("TOPPADDING", (0, i), (-1, i), 1), ("BOTTOMPADDING", (0, i), (-1, i), 1)]

    styles = getSampleStyleSheet()
    out = BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=40, rightMargin=40, topMargin=40, bottomMargin=40)
    table = Table(data, colWidths=[330, 150])
    table.setStyle(TableStyle(style))
    doc.build([Paragraph("<b>STAR OFFSET PRINTING - PROFIT &amp; LOSS STATEMENT</b>", styles["Title"]),
               Paragraph(_period_text(start, end), styles["Normal"]), Spacer(1, 12), table])
    return out.getvalue(), "application/pdf"


@api_view(["GET"])
@permission_classes([IsSuperuser])
def pnl_export(request):
    start, end = _period(request.query_params)
    st = _statement(start, end)
    fmt = "pdf" if request.query_params.get("file") == "pdf" else "xlsx"
    content, mime = (_export_pdf if fmt == "pdf" else _export_xlsx)(st, start, end)
    response = HttpResponse(content, content_type=mime)
    response["Content-Disposition"] = f'attachment; filename="profit-loss-{start}-to-{end}.{fmt}"'
    return response


# ----------------------------------------------------------------- expenses
def _expense_json(e):
    return {"id": e.id, "date": e.expense_date, "category": e.category,
            "category_label": CATEGORY_LABEL.get(e.category, e.category),
            "group": CATEGORY_GROUP.get(e.category, "operating"),
            "description": e.description, "amount": e.amount}


def _clean_expense(data, partial=False):
    """Validate a posted expense. Returns (values, errors); with partial=True only the sent fields are checked."""
    values, errors = {}, {}

    if "expense_date" in data or not partial:
        raw = data.get("expense_date") or data.get("date")
        day = _day(raw) if raw else timezone.localdate()
        if day is None:
            errors["date"] = "Enter a valid date."
        else:
            values["expense_date"] = day

    if "category" in data or not partial:
        if data.get("category") not in CATEGORY_KEYS:
            errors["category"] = "Choose a category."
        else:
            values["category"] = data["category"]

    if "amount" in data or not partial:
        try:
            amount = Decimal(str(data.get("amount")).strip()).quantize(CENT)
            if not amount.is_finite() or amount <= 0 or amount > MAX_AMOUNT:
                raise InvalidOperation
            values["amount"] = amount
        except (InvalidOperation, ValueError, TypeError):
            errors["amount"] = "Enter an amount greater than 0."

    if "description" in data or not partial:
        text = str(data.get("description") or "").strip()
        if len(text) > 200:
            errors["description"] = "Keep it under 200 characters."
        else:
            values["description"] = text
    return values, errors


@api_view(["GET", "POST"])
@permission_classes([IsSuperuser])
def expenses(request):
    if request.method == "POST":
        values, errors = _clean_expense(request.data)
        if errors:
            return Response(errors, status=400)
        expense = Expense.objects.create(created_by=request.user, **values)
        return Response(_expense_json(expense), status=201)

    p = request.query_params
    start, end = _period(p)
    qs = Expense.objects.filter(expense_date__range=(start, end))
    if p.get("category") in CATEGORY_KEYS:
        qs = qs.filter(category=p["category"])
    q = (p.get("q") or "").strip()
    if q:
        qs = qs.filter(description__icontains=q)

    agg = qs.aggregate(total=Sum("amount"), count=Count("id"))
    pager = ReportPagination()
    page = pager.paginate_queryset(qs, request)
    response = pager.get_paginated_response([_expense_json(e) for e in page])
    response.data["summary"] = {"total": _dec(agg["total"]), "count": agg["count"] or 0}
    response.data["period"] = _period_json(start, end)
    response.data["categories"] = [{"key": k, "label": label, "group": g} for k, label, g in EXPENSE_CATEGORIES]
    return response


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsSuperuser])
def expense_detail(request, pk):
    expense = Expense.objects.filter(pk=pk).first()
    if expense is None:
        return Response({"detail": "Expense not found"}, status=404)
    if request.method == "GET":
        return Response(_expense_json(expense))
    if request.method == "DELETE":
        expense.delete()
        return Response(status=204)

    values, errors = _clean_expense(request.data, partial=request.method == "PATCH")
    if errors:
        return Response(errors, status=400)
    for field, value in values.items():
        setattr(expense, field, value)
    expense.save()
    return Response(_expense_json(expense))