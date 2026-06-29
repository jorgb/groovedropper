import os
import logging
from concurrent.futures import ThreadPoolExecutor

from groove import audio, db
from groove.jobs_util import (
    fmt_offset, strip_suffix,
    archive_original, resolve_folder_id, insert_sample, apply_labels,
)
from groove.util import get_sample_meta

logger = logging.getLogger(__name__)


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

    folder_id = resolve_folder_id(scan_folder_path)

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
                    inserted = insert_sample(cursor, conn, pending_dest, pending_name,
                                             meta, folder_id, scan_folder_path, label='Cut')
                    if inserted and label_ids:
                        apply_labels(cursor, conn, meta.digest, label_ids, label='Cut')

                pending_future = new_future
                pending_dest   = dest_path
                pending_name   = name

            # Flush the last slice (no subsequent write to overlap with).
            if pending_future is not None:
                meta = pending_future.result()
                inserted = insert_sample(cursor, conn, pending_dest, pending_name,
                                         meta, folder_id, scan_folder_path, label='Cut')
                if inserted and label_ids:
                    apply_labels(cursor, conn, meta.digest, label_ids, label='Cut')
    finally:
        conn.close()

    archive_original(path, label='Cut')
