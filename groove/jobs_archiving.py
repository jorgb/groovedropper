import os
import time
import logging
from groove.queue import scan_queue

logger     = logging.getLogger(__name__)
_RETRY_S   = 60


def run(payload: dict) -> None:
    path             = payload['path']
    scan_folder_path = payload['scan_folder_path']
    bak              = path + '.bak'
    deadline         = time.monotonic() + _RETRY_S
    renamed          = False
    while time.monotonic() < deadline:
        try:
            if os.path.exists(path):
                os.rename(path, bak)
                logger.info("Archive: %s → %s", path, bak)
            renamed = True
            break
        except PermissionError:
            time.sleep(1.0)
    if not renamed:
        logger.warning("Archive: rename timed out after %ds: %s", _RETRY_S, path)
    scan_queue.push_folder(scan_folder_path)
