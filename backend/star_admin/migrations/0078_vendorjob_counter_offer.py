from django.db import migrations, models


class Migration(migrations.Migration):
    """Price negotiation: Star Offset can answer a vendor's quote with a counter offer (status "countered"),
    and every price step is kept in VendorJob.negotiation."""

    dependencies = [('star_admin', '0077_push_subscription_livepresence')]

    operations = [
        migrations.AddField(
            model_name='vendorjob',
            name='counter_price',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='vendorjob',
            name='counter_note',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='vendorjob',
            name='countered_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='vendorjob',
            name='negotiation',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AlterField(
            model_name='vendorjob',
            name='status',
            field=models.CharField(choices=[('enquiry', 'Quote requested'), ('quoted', 'Quoted'), ('countered', 'Counter offer'), ('declined', 'Declined to quote'), ('not_selected', 'Not selected'), ('assigned', 'New'), ('accepted', 'Accepted'), ('in_progress', 'In Production'), ('ready', 'Ready'), ('completed', 'Completed'), ('rejected', 'Rejected'), ('cancelled', 'Cancelled')], default='assigned', max_length=12),
        ),
    ]
