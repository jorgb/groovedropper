import enum
import uuid
import logging
import threading
from dataclasses import dataclass
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

MAX_COMPLETED_KEEP = 20


class JobStatus(enum.Enum):
    QUEUED   = "queued"
    RUNNING  = "running"
    DONE     = "done"
    FAILED   = "failed"
    CANCELED = "canceled"


class SampleBusyError(Exception):
    pass


@dataclass
class Job:
    job_id:    str
    job_type:  str          # "export" | "archive" | "cut"
    sample_id: int
    payload:   dict         # all data the callable needs; no DB reads inside job
    fn:        Any          # Callable — jobs_*.run
    status:    JobStatus = JobStatus.QUEUED
    result:    Any = None   # bytes for export jobs when DONE
    error:     Optional[str] = None
    progress:  str = ""


class JobQueue:
    def __init__(self):
        self._lock      = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._queue:     list = []   # pending + running (index 0 when running)
        self._completed: list = []   # ring buffer of finished jobs
        self._locked_samples: set = set()
        self._worker = threading.Thread(target=self._run, daemon=True, name='job-worker')
        self._worker.start()

    # ------------------------------------------------------------------
    # Worker
    # ------------------------------------------------------------------

    def _run(self) -> None:
        while True:
            with self._condition:
                while not self._queue:
                    self._condition.wait()
                job = self._queue[0]
                job.status = JobStatus.RUNNING

            result = None
            error  = None
            try:
                logger.info("Job %s (%s sample=%s) starting", job.job_id, job.job_type, job.sample_id)
                result = job.fn(job.payload)
            except Exception as exc:
                error = str(exc)
                logger.exception("Job %s (%s) failed", job.job_id, job.job_type)

            with self._lock:
                job.result = result
                job.status = JobStatus.DONE if error is None else JobStatus.FAILED
                job.error  = error
                self._queue.pop(0)
                self._completed.append(job)
                if len(self._completed) > MAX_COMPLETED_KEEP:
                    self._completed.pop(0)
            logger.info("Job %s (%s) → %s", job.job_id, job.job_type, job.status.value)

    # ------------------------------------------------------------------
    # Internal helpers (call only while self._lock is held)
    # ------------------------------------------------------------------

    def _is_busy_locked(self, sample_id: int) -> bool:
        if sample_id in self._locked_samples:
            return True
        return any(
            j.sample_id == sample_id
            and j.status in (JobStatus.QUEUED, JobStatus.RUNNING)
            for j in self._queue
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def enqueue(self, job_type: str, sample_id: int, payload: dict, fn: Callable) -> str:
        """Schedule a job. Raises SampleBusyError if sample already has a queued/running job."""
        with self._condition:
            if self._is_busy_locked(sample_id):
                raise SampleBusyError(f"Sample {sample_id} is busy")
            job_id = str(uuid.uuid4())
            job    = Job(job_id=job_id, job_type=job_type, sample_id=sample_id,
                         payload=payload, fn=fn)
            self._queue.append(job)
            self._condition.notify_all()
        return job_id

    def is_sample_busy(self, sample_id: int) -> bool:
        with self._lock:
            return self._is_busy_locked(sample_id)

    def get_job(self, job_id: str) -> Optional[Job]:
        with self._lock:
            for j in self._queue + self._completed:
                if j.job_id == job_id:
                    return j
        return None

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            for j in self._queue:
                if j.job_id == job_id and j.status == JobStatus.QUEUED:
                    j.status = JobStatus.CANCELED
                    self._queue.remove(j)
                    self._completed.append(j)
                    if len(self._completed) > MAX_COMPLETED_KEEP:
                        self._completed.pop(0)
                    return True
        return False

    def lock_sample(self, sample_id: int) -> None:
        with self._lock:
            self._locked_samples.add(sample_id)

    def unlock_sample(self, sample_id: int) -> None:
        with self._lock:
            self._locked_samples.discard(sample_id)

    def snapshot(self) -> list:
        with self._lock:
            return [_to_dict(j) for j in self._queue + self._completed]


def _to_dict(j: Job) -> dict:
    return {
        'job_id':       j.job_id,
        'job_type':     j.job_type,
        'sample_id':    j.sample_id,
        'status':       j.status.value,
        'progress':     j.progress,
        'error':        j.error,
        'result_ready': j.status == JobStatus.DONE and j.result is not None,
    }


job_queue = JobQueue()
