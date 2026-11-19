"""Settings > Activity Log API (admin only).

    GET /api/settings/activity/?q=&user=&module=&action=&date_from=&date_to=&page=
        -> {count, next, previous, results: [...], summary: {...}, filters: {users, modules}}

The rows are written by star_admin/activity.py. This file only reads them.
"""
from datetime import date

from django.utils import timezone
from django.utils.timezone import localtime
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q

from .activity import ACTION_LABELS, MODULE_LABELS
from .api_views import IsSuperuser
from .models import ActivityLog


class ActivityPagination(PageNumberPagination):
    page_size = 15
    page_size_query_param = "page_size"
    max_page_size = 100


def _row(a):
    return {
        "id": a.id,
        "username": a.username or "—",
        "role": a.role,
        "module": a.module,
        "module_label": MODULE_LABELS.get(a.module, a.module.title()),
        "action": a.action,
        "action_label": ACTION_LABELS.get(a.action, a.action.title()),
        "target": a.target,
        "description": a.description,
        "ip_address": a.ip_address,
        "created_at": localtime(a.created_at).isoformat(),
    }


def _day(value):
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


@api_view(["GET"])
@permission_classes([IsSuperuser])
def activity_log(request):
    p = request.query_params
    qs = ActivityLog.objects.all()

    q = (p.get("q") or "").strip()
    if q:
        qs = qs.filter(Q(description__icontains=q) | Q(target__icontains=q) | Q(username__icontains=q))
    if p.get("user"):
        qs = qs.filter(username=p["user"])
    if p.get("module") in MODULE_LABELS:
        qs = qs.filter(module=p["module"])
    if p.get("action") in ACTION_LABELS:
        qs = qs.filter(action=p["action"])
    start, end = _day(p.get("date_from")), _day(p.get("date_to"))
    if start:
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)

    pager = ActivityPagination()
    page = pager.paginate_queryset(qs, request)
    response = pager.get_paginated_response([_row(a) for a in page])

    # cards + dropdowns describe the whole log, not just the current filter
    today = ActivityLog.objects.filter(created_at__date=timezone.localdate())
    response.data["summary"] = {
        "today": today.exclude(action__in=["login", "logout", "login_failed"]).count(),
        "users_today": today.exclude(action="login_failed").order_by().values("username").distinct().count(),
        "failed_today": today.filter(action="login_failed").count(),
    }
    response.data["filters"] = {
        "users": [u for u in ActivityLog.objects.exclude(action="login_failed").order_by("username")
                  .values_list("username", flat=True).distinct() if u],
        "modules": [{"value": k, "label": v} for k, v in MODULE_LABELS.items()],
    }
    return response