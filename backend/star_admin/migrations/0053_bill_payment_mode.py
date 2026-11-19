from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('star_admin', '0052_whatsappmessage_media_whatsappmessage_media_filename_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='bill',
            name='payment_mode',
            field=models.CharField(
                choices=[('cash', 'Cash'), ('upi', 'UPI'), ('bank', 'Bank'), ('credit', 'Credit')],
                default='cash',
                max_length=10,
            ),
        ),
    ]