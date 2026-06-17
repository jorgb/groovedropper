import time
import logging

logger = logging.getLogger(__name__)


def run(payload: dict) -> bytes:
    logger.info("export_bytag: started (stub, sleeping 30 s)")
    time.sleep(30)
    logger.info("export_bytag: done")
    return b""
