from django.db import migrations, models


class Migration(migrations.Migration):
    """Vendor price list: a price can now be for one size / print type of a service (option_key),
    not only for the service as a whole (option_key = ''). Existing rows keep working: they become service prices."""

    dependencies = [
        ('star_admin', '0071_vendorrate'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='vendorrate',
            name='uniq_vendor_rate_item',
        ),
        migrations.AddField(
            model_name='vendorrate',
            name='option_key',
            field=models.CharField(blank=True, default='', max_length=300),
        ),
        migrations.AddField(
            model_name='vendorrate',
            name='option_name',
            field=models.CharField(blank=True, default='', max_length=250),
        ),
        migrations.AlterModelOptions(
            name='vendorrate',
            options={'ordering': ['service_name', 'option_name', 'id']},
        ),
        migrations.AddConstraint(
            model_name='vendorrate',
            constraint=models.UniqueConstraint(fields=('vendor', 'service_key', 'option_key'), name='uniq_vendor_rate_option'),
        ),
    ]
