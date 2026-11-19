from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    dependencies = [('star_admin', '0064_shoporder_payment_workflow')]
    operations = [
        migrations.CreateModel(name='ShopWallet', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('balance', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('updated_at', models.DateTimeField(auto_now=True)),
            ('shop', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='wallet', to='star_admin.shop')),
        ]),
        migrations.CreateModel(name='ShopWalletTransaction', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('kind', models.CharField(choices=[('credit', 'Credit'), ('debit', 'Debit'), ('refund', 'Refund'), ('adjustment', 'Adjustment')], max_length=12)),
            ('amount', models.DecimalField(decimal_places=2, max_digits=12)),
            ('status', models.CharField(choices=[('pending', 'Pending'), ('completed', 'Completed'), ('failed', 'Failed')], default='pending', max_length=12)),
            ('razorpay_order_id', models.CharField(blank=True, default=None, max_length=100, null=True, unique=True)),
            ('reference', models.CharField(blank=True, default='', max_length=120)),
            ('description', models.CharField(blank=True, default='', max_length=250)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('completed_at', models.DateTimeField(blank=True, null=True)),
            ('wallet', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='transactions', to='star_admin.shopwallet')),
        ], options={'ordering': ['-created_at', '-id']}),
    ]
