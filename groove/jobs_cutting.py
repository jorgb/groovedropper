import os
import re
import time
import logging
from groove import audio
from groove.queue import scan_queue

logger   = logging.getLogger(__name__)
_RETRY_S = 60


def _strip_suffix(base: str) -> str:
    if re.search(r'-\d{8}-\d{8}$', base):
        return re.sub(r'-\d{8}-(\d{8})$', r'-\1', base)
    return base


def _fmt(n: int) -> str:
    return f'{int(n):08d}'


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


def run(payload: dict) -> None:
    path             = payload['path']
    duration_samples = int(payload['duration_samples'])
    scan_folder_path = payload['scan_folder_path']
    base_dir         = os.path.dirname(path)
    orig_name        = os.path.basename(path)
    base             = _strip_suffix(os.path.splitext(orig_name)[0])

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
    for idx in regions_to_keep:
        start, end = regions[idx]
        name = f'{base}-{_fmt(start)}-{_fmt(end - 1)}.wav'
        logger.info("Cut: region %d (%d–%d) → %s", idx, start, end, name)
        audio.save_slice_wav(path, os.path.join(base_dir, name), start, end)

    _archive_original(path)
    scan_queue.push_folder(scan_folder_path)
