from django.db import migrations


def add_minimum_basic_designing_option(apps, schema_editor):
    Category = apps.get_model("pricing", "Category")
    Size = apps.get_model("pricing", "Size")
    Variant = apps.get_model("pricing", "Variant")

    category = Category.objects.filter(name__iexact="DESIGNING").first()
    if category is None:
        return

    size, _ = Size.objects.get_or_create(
        category=category,
        name="Minimum - Basic",
    )

    variants = [
        ("Single Color - Single Side", 0),
        ("Single Color - Double Side", 1),
        ("Multi Color - Single Side", 2),
        ("Multi Color - Double Side", 3),
    ]
    for name, display_order in variants:
        Variant.objects.get_or_create(
            size=size,
            name=name,
            defaults={"display_order": display_order},
        )


class Migration(migrations.Migration):

    dependencies = [
        ("pricing", "0017_deliverytype_digitalprice_delivery_type_and_more"),
    ]

    operations = [
        migrations.RunPython(
            add_minimum_basic_designing_option,
            migrations.RunPython.noop,
        ),
    ]
