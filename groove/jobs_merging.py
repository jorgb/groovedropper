import os
import logging

import numpy as np
import soundfile as sf

from groove import db
from groove.audio_common import make_tmp_path
from groove.jobs_util import (
    fmt_offset, strip_suffix,
    archive_original, resolve_folder_id, insert_sample, apply_labels,
)
from groove.util import get_sample_meta

logger = logging.getLogger(__name__)

CROSSFADE_S   = 0.02   # seconds; linear fade applied at each internal join
USE_CROSSFADE = False  # set True to enable crossfading between regions


def _merge_and_crossfade(src_path: str, regions: list, dest_path: str) -> None:
    """Stream-merge kept regions into dest_path with linear crossfades at internal joins.

    At most two items are in memory at any time: a tiny tail buffer (fade_n frames)
    plus one region being read. Settled audio is written to disk immediately.
    Crossfade is NOT applied at the outer edges (start of first / end of last region).
    """
    tmp_path = make_tmp_path(dest_path)
    try:
        with sf.SoundFile(src_path) as src:
            sr       = src.samplerate
            channels = src.channels

            with sf.SoundFile(tmp_path, mode='w', samplerate=sr, channels=channels,
                              format='WAV', subtype='PCM_16') as dst:

                if not USE_CROSSFADE:
                    # no crossfading is simply concatenating
                    for start, end in regions:
                        src.seek(start)
                        dst.write(src.read(end - start))
                elif len(regions) == 1:
                    # one region is a simple partial copy
                    start, end = regions[0]
                    src.seek(start)
                    dst.write(src.read(end - start))
                else:
                    # crossfade logic, otherwise
                    fade_n   = int(CROSSFADE_S * sr)
                    ramp_out = np.linspace(1.0, 0.0, fade_n)
                    ramp_in  = np.linspace(0.0, 1.0, fade_n)

                    # First region: write all but the tail
                    start, end = regions[0]
                    src.seek(start)
                    data = src.read(end - start)
                    n    = min(fade_n, len(data))
                    tail = data[-n:].copy()
                    if n < len(data):
                        dst.write(data[:-n])
                    del data

                    for i in range(1, len(regions)):
                        start, end = regions[i]
                        src.seek(start)
                        curr    = src.read(end - start)
                        is_last = (i == len(regions) - 1)

                        xn = min(len(tail), fade_n, len(curr))
                        if xn > 0:
                            ro = ramp_out[-xn:]
                            ri = ramp_in[:xn]
                            if channels > 1:
                                ro = ro[:, np.newaxis]
                                ri = ri[:, np.newaxis]
                            dst.write(tail[-xn:] * ro + curr[:xn] * ri)
                        del tail

                        rest = curr[xn:]
                        if is_last:
                            dst.write(rest)
                        else:
                            n    = min(fade_n, len(rest))
                            tail = rest[-n:].copy() if n > 0 else np.zeros(
                                (0, channels) if channels > 1 else (0,))
                            if n < len(rest):
                                dst.write(rest[:-n])
                        del curr

        os.replace(tmp_path, dest_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


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
    all_regions     = [
        (boundaries[i], boundaries[i + 1])
        for i in range(len(boundaries) - 1)
    ]
    # Drop a zero/one-sample region at the very start (marker pinned at offset 0)
    if all_regions and all_regions[0][0] == 0 and all_regions[0][1] - all_regions[0][0] <= 1:
        all_regions     = all_regions[1:]
        regions_to_keep = [i - 1 for i in regions_to_keep if i > 0]

    kept_regions = [all_regions[i] for i in regions_to_keep if i < len(all_regions)]
    if not kept_regions:
        logger.warning("Merge: no regions to merge, aborting")
        return

    first_start = kept_regions[0][0]
    last_end    = kept_regions[-1][1]
    name      = f'{base}-{fmt_offset(first_start)}-{fmt_offset(last_end - 1)}.wav'
    dest_path = os.path.join(base_dir, name)

    logger.info("Merge: %d region(s) → %s", len(kept_regions), name)
    _merge_and_crossfade(path, kept_regions, dest_path)

    folder_id = resolve_folder_id(scan_folder_path)
    meta = get_sample_meta(dest_path)

    conn   = db.open_connection()
    cursor = conn.cursor()
    try:
        inserted = insert_sample(cursor, conn, dest_path, name, meta, folder_id, scan_folder_path, label='Merge')
        if inserted and label_ids:
            apply_labels(cursor, conn, meta.digest, label_ids, label='Merge')
    finally:
        conn.close()

    archive_original(path, label='Merge')
