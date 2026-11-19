from django.apps import AppConfig


class StarAdminConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'star_admin'

    def ready(self):
        from . import activity  # noqa: F401  (connects the sign-in / sign-out log signals)
        from . import notification_models  # noqa: F401  (the top-bar bell)
        from . import push_models  # noqa: F401  (Web Push subscriptions + presence)
        from . import vendor_models  # noqa: F401  (registers Vendor / VendorJob at startup, so deletes cascade to jobs)
        from . import live_events  # noqa: F401  (WebSocket pushes: shop order / wallet / vendor job / WhatsApp)