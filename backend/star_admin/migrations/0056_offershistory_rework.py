from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('star_admin', '0055_quotation_terms_discount_converted_bill'),
    ]

    operations = [
        migrations.AddField(
            model_name='offershistory',
            name='failed',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='offershistory',
            name='total_recipients',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='offershistory',
            name='status',
            field=models.CharField(choices=[('draft', 'Draft'), ('sending', 'Sending'), ('sent', 'Sent'), ('partial', 'Partial'), ('failed', 'Failed')], default='sent', max_length=10),
        ),
        migrations.AddField(
            model_name='offershistory',
            name='valid_from',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='offershistory',
            name='valid_until',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='offershistory',
            name='shop_number',
            field=models.CharField(blank=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='offershistory',
            name='customer_ids',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
