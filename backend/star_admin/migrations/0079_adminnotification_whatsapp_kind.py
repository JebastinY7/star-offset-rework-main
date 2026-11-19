from django.db import migrations, models


class Migration(migrations.Migration):
    """Staff bell gets a "whatsapp_message" kind (customer WhatsApp messages now show in the notification list)."""

    dependencies = [('star_admin', '0078_vendorjob_counter_offer')]

    operations = [
        migrations.AlterField(
            model_name='adminnotification',
            name='kind',
            field=models.CharField(choices=[('whatsapp_message', 'WhatsApp message'), ('shop_order', 'New shop order'), ('vendor_ready', 'Vendor job ready for pickup'), ('vendor_quote', 'Vendor price quote')], max_length=20),
        ),
    ]
