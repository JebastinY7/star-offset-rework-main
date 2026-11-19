from django.conf import settings
from django.db import migrations, models


def backfill(apps, schema_editor):
    """Notifications for work that is waiting right now, so the bell is not empty on day one."""
    Note = apps.get_model("star_admin", "AdminNotification")
    ShopOrder = apps.get_model("star_admin", "ShopOrder")
    VendorJob = apps.get_model("star_admin", "VendorJob")
    for o in ShopOrder.objects.filter(status="payment_confirmed").select_related("shop"):
        Note.objects.create(kind="shop_order", title="New shop order", link=f"/shop-orders/{o.id}",
                            message=f"{o.shop.name} placed ORD-{o.id:04d} - {o.items_count} item{'' if o.items_count == 1 else 's'}")
    for j in VendorJob.objects.filter(status="ready").select_related("vendor", "order", "manual_order"):
        ref = f"ORD-{j.order_id:04d}" if j.order_id else f"W{j.manual_order_id:03d}"
        Note.objects.create(kind="vendor_ready", title="Ready for pickup", link="/vendor-work?tab=jobs",
                            message=f"{j.vendor.name} marked JOB-{j.id:04d} ({ref}) ready for pickup")


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('star_admin', '0069_vendorjob_manual_orders'),
    ]

    operations = [
        migrations.CreateModel(
            name='AdminNotification',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(choices=[('shop_order', 'New shop order'), ('vendor_ready', 'Vendor job ready for pickup')], max_length=20)),
                ('title', models.CharField(max_length=120)),
                ('message', models.CharField(blank=True, default='', max_length=300)),
                ('link', models.CharField(blank=True, default='', max_length=200)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('read_by', models.ManyToManyField(blank=True, related_name='read_notifications', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at', '-id']},
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
