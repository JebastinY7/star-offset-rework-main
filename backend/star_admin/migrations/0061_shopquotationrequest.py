import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('star_admin', '0060_shop'),
    ]

    operations = [
        migrations.CreateModel(
            name='ShopQuotationRequest',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('request_no', models.CharField(max_length=20, unique=True)),
                ('items_count', models.PositiveIntegerField(default=0)),
                ('total_amount', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('quoted', 'Quoted'), ('responded', 'Responded')], default='pending', max_length=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('shop', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='quotation_requests', to='star_admin.shop')),
            ],
            options={
                'ordering': ['-created_at', '-id'],
            },
        ),
    ]
