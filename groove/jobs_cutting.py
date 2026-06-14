import os
import time
import logging
from concurrent.futures import ThreadPoolExecutor

from groove import audio, db
from groove.jobs_util import fmt_offset, strip_suffix
from groove.util import get_sample_meta, SampleMeta

logger   = logging.getLogger(__name__)
_RETRY_S = 60


def _archive_original(path: str) -> None:
    bak      = path + '.bak'
    deadline = time.monotonic() + _RETRY_S
    while time.monotonic() < deadline:
        try:
            if os.path.exists(path):
                os.rename(path, bak)
                logger.info("Cut: archived %s → %s", path, bak)
            return
        except PermissionError:
            time.sleep(1.0)
    logger.warning("Cut: rename timed out after %ds: %s", _RETRY_S, path)


def _resolve_folder_id(scan_folder_path: str):
    conn = db.open_connection()
    try:
        return db.scan_get_folder_id(conn.cursor(), scan_folder_path)
    finally:
        conn.close()


def _insert_slice(cursor, conn, dest_path: str, name: str, meta: SampleMeta, folder_id) -> bool:
    """Insert one slice into the DB. Returns True if inserted, False if digest already existed."""
    if db.scan_check_digest_exists(cursor, meta.digest):
        logger.info("Cut: duplicate digest skipped: %s", dest_path)
        return False
    db.scan_insert_sample(
        cursor, dest_path, name, os.path.dirname(dest_path),
        meta.size, meta.digest, meta.mtime,
        meta.duration, meta.samplerate, meta.duration_samples,
        meta.waveform, folder_id,
    )
    conn.commit()
    logger.info("Cut: inserted %s", name)
    return True


def _apply_labels(cursor, conn, digest: str, label_ids: list) -> None:
    """Atomically attach each label to the newly inserted sample.

    Each label gets its own transaction: check existence → insert relation → commit.
    A label deleted from the UI between the cut start and this point is silently
    skipped; the sample is still indexed without it.
    """
    for label_id in label_ids:
        try:
            cursor.execute('SELECT 1 FROM labels WHERE id = ?', (label_id,))
            if cursor.fetchone() is not None:
                db.scan_insert_sample_label(cursor, digest, label_id)
            conn.commit()
        except Exception:
            conn.rollback()
            logger.warning("Cut: failed to apply label %d to %s", label_id, digest)


def run(payload: dict) -> None:
    path             = payload['path']
    duration_samples = int(payload['duration_samples'])
    scan_folder_path = payload['scan_folder_path']
    label_ids        = [int(lid) for lid in payload.get('label_ids', [])]
    base_dir         = os.path.dirname(path)
    orig_name        = os.path.basename(path)
    base             = strip_suffix(os.path.splitext(orig_name)[0])

    markers         = [int(m) for m in payload['markers']]
    regions_to_keep = [int(i) for i in payload.get('regions_to_keep', [])]
    boundaries      = [0] + markers + [duration_samples]
    regions         = [
        (boundaries[i], boundaries[i + 1])
        for i in range(len(boundaries) - 1)
    ]
    # Drop a zero/one-sample region at the very start (marker pinned at offset 0)
    if regions and regions[0][0] == 0 and regions[0][1] - regions[0][0] <= 1:
        regions         = regions[1:]
        regions_to_keep = [i - 1 for i in regions_to_keep if i > 0]

    folder_id = _resolve_folder_id(scan_folder_path)

    conn   = db.open_connection()
    cursor = conn.cursor()
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            pending_future = None
            pending_dest   = None
            pending_name   = None

            for idx in regions_to_keep:
                start, end = regions[idx]
                name      = f'{base}-{fmt_offset(start)}-{fmt_offset(end - 1)}.wav'
                dest_path = os.path.join(base_dir, name)
                logger.info("Cut: region %d (%d–%d) → %s", idx, start, end, name)
                audio.save_slice_wav(path, dest_path, start, end)

                # Submit metadata computation for this slice so it runs concurrently
                # while the next slice is being written to disk.
                new_future = executor.submit(get_sample_meta, dest_path)

                # Now that we've moved on to the next write, flush the previous slice.
                if pending_future is not None:
                    meta = pending_future.result()
                    inserted = _insert_slice(cursor, conn, pending_dest, pending_name,
                                             meta, folder_id)
                    if inserted and label_ids:
                        _apply_labels(cursor, conn, meta.digest, label_ids)

                pending_future = new_future
                pending_dest   = dest_path
                pending_name   = name

            # Flush the last slice (no subsequent write to overlap with).
            if pending_future is not None:
                meta = pending_future.result()
                inserted = _insert_slice(cursor, conn, pending_dest, pending_name,
                                         meta, folder_id)
                if inserted and label_ids:
                    _apply_labels(cursor, conn, meta.digest, label_ids)
    finally:
        conn.close()

    _archive_original(path)
