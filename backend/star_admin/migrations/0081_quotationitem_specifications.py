from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("star_admin", "0080_orderitem_specifications"),
    ]

    operations = [
        migrations.AddField(
            model_name="quotationitem",
            name="specifications",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
