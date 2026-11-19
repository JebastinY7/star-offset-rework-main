from django.http import JsonResponse
from django.utils.timezone import now
from .models import StaffActivity

class StaffLastSeenMiddleware:

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated:
            activity, created = StaffActivity.objects.get_or_create(
                user=request.user
            )
            activity.last_seen = now()
            activity.save(update_fields=['last_seen'])
        return self.get_response(request)
    

class ShopFenceMiddleware:
    """Keep shop accounts on /api/shop/ and vendor accounts on /api/vendor/ (admin / staff are not fenced)."""

    # sign-in / sign-out / "who am I" must work whatever account the browser is currently signed in as
    # (browsers share cookies across localhost ports); each of these only acts on its own kind of account
    COMMON = (
        "/api/auth/csrf/",
        "/api/auth/login/",
        "/api/shop/me/",
        "/api/shop/auth/login/",
        "/api/shop/auth/logout/",
        "/api/vendor/me/",
        "/api/vendor/auth/login/",
        "/api/vendor/auth/logout/",
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = request.user
        path = request.path_info

        if (
            user.is_authenticated
            and not (user.is_staff or user.is_superuser)
            and path.startswith("/api/")
        ):
            # vendor accounts have a vendor_profile; everything else non-staff is a shop account
            own = "/api/vendor/" if hasattr(user, "vendor_profile") else "/api/shop/"
            if not path.startswith((own,) + self.COMMON):
                return JsonResponse({"error": "Not allowed."}, status=403)
        return self.get_response(request)

class SubdomainMiddleware:

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        host = request.get_host().split(":")[0]
        request.is_admin_subdomain = (
            host.startswith("admin.")
        )
        request.is_staff_subdomain = (
            host.startswith("staff.")
        )
        response = self.get_response(request)
        return response