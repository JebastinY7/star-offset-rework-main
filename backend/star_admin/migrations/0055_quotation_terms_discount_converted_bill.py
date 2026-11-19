from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('star_admin', '0054_order_advance_mode_reference'),
    ]

    operations = [
        migrations.AddField(
            model_name='quotation',
            name='terms',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='quotation',
            name='discount',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name='quotation',
            name='extra_charge',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=10),
        ),
        migrations.AddField(
            model_name='quotation',
            name='converted_bill',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='quotations', to='star_admin.bill'),
        ),
    ]
