from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("star_admin", "0079_adminnotification_whatsapp_kind"),
    ]

    operations = [
        migrations.AddField(
            model_name="orderitem",
            name="specifications",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
