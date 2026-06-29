from threading import Lock
from queue import Queue, Empty


class ScanQueue:
    def __init__(self):
        self._lock = Lock()
        self._folders = Queue()
        self._samples = Queue()
        self.total_folders = 0
        self.total_samples = 0
        self._current_folder = None
        self._started = False

    def start(self, folder_count):
        with self._lock:
            self.total_folders = folder_count
            self._started = True

    def push_folder(self, path):
        self._folders.put(path)

    def pop_folder(self, timeout=1.0):
        """Blocking get; raises Empty on timeout."""
        return self._folders.get(timeout=timeout)

    def folder_done(self):
        self._folders.task_done()

    def push_sample(self, wav_path, folder_id, folder_path):
        self._samples.put((wav_path, folder_id, folder_path))
        with self._lock:
            self.total_samples += 1

    def has_samples(self):
        return not self._samples.empty()

    def pop_sample(self):
        return self._samples.get()

    def sample_done(self):
        self._samples.task_done()

    def set_scanning_folder(self, path):
        with self._lock:
            self._current_folder = path

    def queued_folders(self):
        return self._folders.qsize()

    def queued_samples(self):
        return self._samples.qsize()

    def is_active(self):
        """True while folders are queued, samples are pending, or a folder is being processed."""
        with self._lock:
            return (
                self._folders.qsize() > 0
                or self._samples.qsize() > 0
                or self._current_folder is not None
            )

    def is_idle(self):
        """True once the initial scan has started and all queues are drained."""
        with self._lock:
            return self._started and self._folders.empty() and self._samples.empty()

    def reset(self):
        """Called when a folder finishes processing; clears the active-folder marker and totals."""
        with self._lock:
            self._current_folder = None
            self.total_samples = 0
            self.total_folders = 0

    def snapshot(self):
        """Atomic read of all stats fields, used by the /api/stats endpoint."""
        with self._lock:
            folders_q = self._folders.qsize()
            samples_q = self._samples.qsize()
            return {
                "total_folders": self.total_folders,
                "folders_queued": folders_q,
                "total_samples": self.total_samples,
                "samples_queued": samples_q,
                "is_active": folders_q > 0 or samples_q > 0 or self._current_folder is not None,
            }


scan_queue = ScanQueue()
