"""Artwork files of shop orders.

The shop's files are e-mailed to Star Offset when the order is placed (shop_orders_api.py) AND a private copy is kept
here, so they can later be e-mailed to a vendor (vendors_admin_api.py) and downloaded by staff / the assigned vendor.

Files live in settings.ARTWORK_ROOT - NOT in MEDIA_ROOT, because /media/ is public.  They are only ever served
through the logged-in download views.  On Railway point ARTWORK_ROOT at a mounted Volume (e.g. /data/artwork),
otherwise the files disappear on every deploy.

Each ShopOrderItem.files entry is  {"name": "logo.pdf", "size": 12345, "path": "ORD-0004/item1/logo.pdf"}
(orders placed before this feature have no "path": their files exist only in the e-mail).
"""
import logging
import os

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.http import FileResponse, Http404
from django.utils.text import get_valid_filename

logger = logging.getLogger(__name__)


def _storage():
    return FileSystemStorage(location=str(settings.ARTWORK_ROOT))


def save_artwork(order_no, item_no, upload):
    """Keep a copy of one uploaded file; returns the dict stored in ShopOrderItem.files."""
    name = get_valid_filename(os.path.basename(upload.name)) or "file"
    upload.seek(0)
    path = _storage().save(f"{order_no}/item{item_no}/{name}", upload)
    upload.seek(0)  # the same upload is attached to the e-mail afterwards
    return {"name": upload.name, "size": upload.size, "path": path}


def delete_artwork(paths):
    """Best-effort cleanup; must never raise because it runs inside the order's error handler."""
    if not paths:
        return
    try:
        store = _storage()
    except Exception:  # noqa: BLE001 - cleanup only
        logger.warning("Could not open the artwork store to delete %s", paths)
        return
    for p in paths:
        try:
            store.delete(p)
        except Exception:  # noqa: BLE001 - cleanup only
            logger.warning("Could not delete artwork file %s", p)


def is_stored(f):
    return isinstance(f, dict) and bool(f.get("path"))


def file_of(item, idx):
    files = item.files or []
    if 0 <= idx < len(files) and is_stored(files[idx]):
        return files[idx]
    return None


def read_bytes(f):
    try:
        with _storage().open(f["path"], "rb") as fh:
            return fh.read()
    except Exception:  # noqa: BLE001 - missing file / bad path
        return None


def download(f):
    try:
        fh = _storage().open(f["path"], "rb")
    except Exception:  # noqa: BLE001
        raise Http404("File not found")
    return FileResponse(fh, as_attachment=True, filename=f.get("name") or "artwork")


def public_files(files):
    """What the browser may see of an item's files (never the server path)."""
    return [{"idx": n, "name": f.get("name"), "size": f.get("size"), "stored": is_stored(f)}
            for n, f in enumerate(files or []) if isinstance(f, dict)]


def job_files(job):
    """Every file of the items in a vendor job, with the ids needed to download it."""
    out = []
    for it in job.items.all():
        for idx, f in enumerate(it.files or []):
            if isinstance(f, dict):
                out.append({"item_id": it.id, "idx": idx, "name": f.get("name"), "size": f.get("size"), "stored": is_stored(f)})
    return out