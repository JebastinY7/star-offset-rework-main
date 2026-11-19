from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('star_admin', '0067_vendorjobevent'),
    ]

    operations = [
        migrations.AddField(
            model_name='vendorjobevent',
            name='progress_date',
            field=models.DateField(blank=True, null=True),
        ),
    ]
