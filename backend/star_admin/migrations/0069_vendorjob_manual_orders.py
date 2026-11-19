import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Lets a vendor job belong to a manual order (Admin > Orders) as well as to a shop-portal order."""

    dependencies = [
        ('star_admin', '0068_vendorjobevent_progress_date'),
    ]

    operations = [
        migrations.AlterField(
            model_name='vendorjob',
            name='order',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='vendor_jobs', to='star_admin.shoporder'),
        ),
        migrations.AlterField(
            model_name='vendorjob',
            name='items',
            field=models.ManyToManyField(blank=True, related_name='vendor_jobs', to='star_admin.shoporderitem'),
        ),
        migrations.AddField(
            model_name='vendorjob',
            name='manual_order',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='vendor_jobs', to='star_admin.order'),
        ),
        migrations.AddField(
            model_name='vendorjob',
            name='manual_items',
            field=models.ManyToManyField(blank=True, related_name='vendor_jobs', to='star_admin.orderitem'),
        ),
    ]
