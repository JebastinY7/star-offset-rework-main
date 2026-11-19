# Progress history lines for vendor jobs

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('star_admin', '0066_vendors'),
    ]

    operations = [
        migrations.CreateModel(
            name='VendorJobEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(max_length=12)),
                ('qty', models.PositiveIntegerField(blank=True, null=True)),
                ('remarks', models.CharField(blank=True, default='', max_length=500)),
                ('by_name', models.CharField(blank=True, default='', max_length=100)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('job', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='events', to='star_admin.vendorjob')),
            ],
            options={
                'ordering': ['created_at', 'id'],
            },
        ),
    ]
