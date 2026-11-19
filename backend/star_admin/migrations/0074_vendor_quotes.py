from django.db import migrations, models


class Migration(migrations.Migration):
    """Vendor price requests (quotes): Star Offset asks vendors for a price before assigning work.

    * VendorJob gets quoted_price / quoted_at and four new statuses (enquiry, quoted, declined, not_selected)
    * the vendor Price List is removed (VendorRate) - vendors now quote per piece of work instead
    * the staff bell gets a "vendor_quote" kind
    """

    dependencies = [('star_admin', '0073_shop_logo_must_change_password')]

    operations = [
        migrations.DeleteModel(name='VendorRate'),
        migrations.AddField(
            model_name='vendorjob',
            name='quoted_price',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='vendorjob',
            name='quoted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name='vendorjob',
            name='status',
            field=models.CharField(choices=[('enquiry', 'Quote requested'), ('quoted', 'Quoted'), ('declined', 'Declined to quote'), ('not_selected', 'Not selected'), ('assigned', 'New'), ('accepted', 'Accepted'), ('in_progress', 'In Production'), ('ready', 'Ready'), ('completed', 'Completed'), ('rejected', 'Rejected'), ('cancelled', 'Cancelled')], default='assigned', max_length=12),
        ),
        migrations.AlterField(
            model_name='adminnotification',
            name='kind',
            field=models.CharField(choices=[('shop_order', 'New shop order'), ('vendor_ready', 'Vendor job ready for pickup'), ('vendor_quote', 'Vendor price quote')], max_length=20),
        ),
    ]