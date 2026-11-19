"""Notification bell (staff / admin).

    GET  /api/admin/notifications/          {unread, results:[{id, kind, title, message, link, created_at, read}]}
                                            (latest 30 UNREAD ones - once a notification is opened it is gone from the list)
    POST /api/admin/notifications/read/     {id: 5}  or  {link: "/shop-orders/3"}  or  {all: true}   -> {unread}
        id    - marks that notification read AND every other unread one that points to the same page
        link  - marks every unread notification that opens that page (used when the page is viewed directly)
        all   - marks everything read
"""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .notification_models import AdminNotification
from .shop_orders_admin_api import IsStaffOrAdmin

LATEST = 30


def _unread_qs(user):
    return AdminNotification.objects.exclude(read_by=user)


def _unread(user):
    return _unread_qs(user).count()


@api_view(["GET"])
@permission_classes([IsStaffOrAdmin])
def admin_notifications(request):
    rows = list(_unread_qs(request.user)[:LATEST])
    return Response({
        "unread": _unread(request.user),
        "results": [{"id": n.id, "kind": n.kind, "title": n.title, "message": n.message, "link": n.link,
                     "created_at": n.created_at.isoformat(), "read": False} for n in rows],
    })


@api_view(["POST"])
@permission_classes([IsStaffOrAdmin])
def admin_notifications_read(request):
    user = request.user
    data = request.data
    if data.get("all") in (True, "true", "True", 1, "1"):
        user.read_notifications.add(*_unread_qs(user))
    elif data.get("id") is not None:
        n = AdminNotification.objects.filter(pk=data.get("id")).first()
        if n is None:
            return Response({"error": "Notification not found."}, status=404)
        n.read_by.add(user)
        if n.link:  # the page is being viewed, so the other notifications for it are seen too
            user.read_notifications.add(*_unread_qs(user).filter(link=n.link))
    elif data.get("link"):
        user.read_notifications.add(*_unread_qs(user).filter(link=str(data.get("link"))[:200]))
    else:
        return Response({"error": "Nothing to mark as read."}, status=400)
    return Response({"unread": _unread(user)})