import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('star_admin', '0061_shopquotationrequest'),
    ]

    operations = [
        migrations.CreateModel(
            name='ShopQuotationRequestItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('kind', models.CharField(max_length=10)),
                ('service_name', models.CharField(max_length=200)),
                ('spec', models.JSONField(default=list)),
                ('params', models.JSONField(default=dict)),
                ('qty', models.PositiveIntegerField()),
                ('estimate', models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True)),
                ('request', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='star_admin.shopquotationrequest')),
            ],
            options={
                'ordering': ['id'],
            },
        ),
    ]
