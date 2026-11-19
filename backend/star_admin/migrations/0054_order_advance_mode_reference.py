from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('star_admin', '0053_bill_payment_mode'),
    ]

    operations = [
        migrations.AddField(
            model_name='order',
            name='advance_mode',
            field=models.CharField(
                choices=[('cash', 'Cash'), ('upi', 'UPI'), ('bank', 'Bank')],
                default='cash',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='order',
            name='advance_reference',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
    ]