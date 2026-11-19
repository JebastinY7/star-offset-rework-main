"""
ASGI config for starprinting project.

Serves normal HTTP through Django and WebSockets (live notifications) through Channels.
Run with:  daphne -b 0.0.0.0 -p $PORT starprinting.asgi:application
(``python manage.py runserver`` does the same automatically because ``daphne`` is in INSTALLED_APPS).

WebSocket logins use a short-lived signed ticket (see star_admin/realtime.py), not cookies.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'starprinting.settings')

django_asgi_app = get_asgi_application()  # must run before the imports below (loads the apps)

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402

from star_admin.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": URLRouter(websocket_urlpatterns),
})