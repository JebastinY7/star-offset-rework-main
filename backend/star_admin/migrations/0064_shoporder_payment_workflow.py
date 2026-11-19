from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("star_admin", "0063_shoporder_shoporderitem"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="shoporder",
            name="status",
            field=models.CharField(
                choices=[
                    ("submitted", "Submitted"),
                    ("awaiting_payment", "Awaiting Payment"),
                    ("payment_confirmed", "Payment Confirmed"),
                    ("in_production", "In Production"),
                    ("ready", "Ready for Pickup"),
                    ("completed", "Completed"),
                    ("cancelled", "Cancelled"),
                ],
                default="submitted",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="shoporder",
            name="final_amount",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name="shoporder",
            name="payment_method",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
        migrations.AddField(
            model_name="shoporder",
            name="payment_reference",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="shoporder",
            name="payment_confirmed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="shoporder",
            name="payment_confirmed_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="confirmed_shop_orders", to=settings.AUTH_USER_MODEL),
        ),
    ]
