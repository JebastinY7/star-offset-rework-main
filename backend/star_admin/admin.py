from django.contrib import admin

from .models import ShopOrder, ShopOrderItem


class ShopOrderItemInline(admin.TabularInline):
    model = ShopOrderItem
    extra = 0
    can_delete = False
    readonly_fields = ("kind", "service_name", "spec", "params", "qty", "estimate", "files")


# Shop orders: staff open an order and change its status; the shop sees it in My Orders.
@admin.register(ShopOrder)
class ShopOrderAdmin(admin.ModelAdmin):
    list_display = ("order_no", "shop", "items_count", "total_amount", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("shop__name", "id")
    list_editable = ("status",)
    readonly_fields = ("shop", "items_count", "total_amount", "delivery_date", "instructions", "created_at", "updated_at")
    inlines = [ShopOrderItemInline]