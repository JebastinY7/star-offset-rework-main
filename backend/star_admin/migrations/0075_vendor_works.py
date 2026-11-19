from django.db import migrations, models


class Migration(migrations.Migration):
    """Vendors say which works they do (Vendor.works), so the Assign work page can show only the matching vendors."""

    dependencies = [('star_admin', '0074_vendor_quotes')]

    operations = [
        migrations.AddField(
            model_name='vendor',
            name='works',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
