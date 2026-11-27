from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("star_admin", "0081_quotationitem_specifications"),
    ]

    operations = [
        migrations.AddField(
            model_name="billitem",
            name="specifications",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
