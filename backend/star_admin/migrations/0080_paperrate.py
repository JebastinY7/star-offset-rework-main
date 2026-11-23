from django.db import migrations, models


class Migration(migrations.Migration):
    """Paper price per sheet (Bill Book / Notice) is now editable in Settings > Paper Price."""

    dependencies = [('star_admin', '0079_adminnotification_whatsapp_kind')]

    operations = [
        migrations.CreateModel(
            name='PaperRate',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('standard_original', models.DecimalField(decimal_places=4, default=0.42, max_digits=8)),
                ('low_original', models.DecimalField(decimal_places=4, default=0.35, max_digits=8)),
                ('duplicate', models.DecimalField(decimal_places=4, default=0.3, max_digits=8)),
                ('legal_original', models.DecimalField(decimal_places=4, default=0.6, max_digits=8)),
                ('legal_duplicate', models.DecimalField(decimal_places=4, default=0.4, max_digits=8)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
