import os
import re
import time
import logging

from groove import db
from groove.util import SampleMeta

logger   = logging.getLogger(__name__)
_RETRY_S = 60


def strip_suffix(base: str) -> str:
    """Remove a trailing -XXXXXXXX-XXXXXXXX slice suffix, collapsing to -XXXXXXXX."""
    if re.search(r'-\d{8}-\d{8}$', base):
        return re.sub(r'-\d{8}-(\d{8})$', r'-\1', base)
    return base


def fmt_offset(n: int) -> str:
    return f'{int(n):08d}'


def archive_original(path: str, label: str = 'Job') -> None:
    bak      = path + '.bak'
    deadline = time.monotonic() + _RETRY_S
    while time.monotonic() < deadline:
        try:
            if os.path.exists(path):
                os.rename(path, bak)
                logger.info("%s: archived %s → %s", label, path, bak)
            return
        except PermissionError:
            time.sleep(1.0)
    logger.warning("%s: rename timed out after %ds: %s", label, _RETRY_S, path)


def resolve_folder_id(scan_folder_path: str):
    conn = db.open_connection()
    try:
        return db.scan_get_folder_id(conn.cursor(), scan_folder_path)
    finally:
        conn.close()


def insert_sample(cursor, conn, dest_path: str, name: str, meta: SampleMeta, folder_id, scan_folder_path: str, label: str = 'Job') -> bool:
    """Insert one sample into the DB. Returns True if inserted, False if digest already existed."""
    if db.scan_check_digest_exists(cursor, meta.digest):
        logger.info("%s: duplicate digest skipped: %s", label, dest_path)
        return False
    rel_path = os.path.relpath(dest_path, scan_folder_path)
    db.scan_insert_sample(
        cursor, rel_path, name,
        meta.size, meta.digest, meta.mtime,
        meta.duration, meta.samplerate, meta.duration_samples,
        meta.waveform, folder_id,
    )
    conn.commit()
    logger.info("%s: inserted %s", label, name)
    return True


def apply_labels(cursor, conn, digest: str, label_ids: list, label: str = 'Job') -> None:
    """Atomically attach each label to the newly inserted sample."""
    for label_id in label_ids:
        try:
            cursor.execute('SELECT 1 FROM labels WHERE id = ?', (label_id,))
            if cursor.fetchone() is not None:
                db.scan_insert_sample_label(cursor, digest, label_id)
            conn.commit()
        except Exception:
            conn.rollback()
            logger.warning("%s: failed to apply label %d to %s", label, label_id, digest)
