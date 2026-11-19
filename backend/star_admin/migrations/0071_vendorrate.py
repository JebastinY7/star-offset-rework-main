from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('star_admin', '0070_adminnotification'),
    ]

    operations = [
        migrations.CreateModel(
            name='VendorRate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('service_key', models.CharField(max_length=200)),
                ('service_name', models.CharField(max_length=200)),
                ('price', models.DecimalField(decimal_places=2, max_digits=10)),
                ('note', models.CharField(blank=True, default='', max_length=200)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('vendor', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='rates', to='star_admin.vendor')),
            ],
            options={'ordering': ['service_name', 'id']},
        ),
        migrations.AddConstraint(
            model_name='vendorrate',
            constraint=models.UniqueConstraint(fields=('vendor', 'service_key'), name='uniq_vendor_rate_item'),
        ),
    ]