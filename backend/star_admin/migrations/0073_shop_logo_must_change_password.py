from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """Shop Portal: force a password change after an admin-typed temporary password, and a per-shop logo."""

    dependencies = [('star_admin', '0072_vendorrate_option')]

    operations = [
        migrations.AddField(
            model_name='shop',
            name='must_change_password',
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name='ShopLogo',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('content_type', models.CharField(max_length=40)),
                ('data', models.BinaryField()),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('shop', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='logo', to='star_admin.shop')),
            ],
        ),
    ]
