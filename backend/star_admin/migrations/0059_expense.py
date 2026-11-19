import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('star_admin', '0058_staffprofile'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Expense',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('expense_date', models.DateField(db_index=True)),
                ('category', models.CharField(choices=[
                    ('materials', 'Paper, ink and printing materials'),
                    ('outsourced', 'Outsourced printing'),
                    ('rent', 'Rent'),
                    ('salaries', 'Staff salaries'),
                    ('utilities', 'Electricity and maintenance'),
                    ('other', 'Other expenses'),
                ], max_length=20)),
                ('description', models.CharField(blank=True, default='', max_length=200)),
                ('amount', models.DecimalField(decimal_places=2, max_digits=10)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-expense_date', '-id'],
            },
        ),
    ]