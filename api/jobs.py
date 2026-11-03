import threading
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Callable, Literal

from pydantic import BaseModel

JobState = Literal["running", "done", "failed"]


class JobInfo(BaseModel):
    id: str
    state: JobState
    result: Any | None = None
    error: str | None = None


class JobStore:
    """In-process job runner. One worker: the ML steps are CPU/RAM heavy."""

    def __init__(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._jobs: dict[str, JobInfo] = {}
        self._lock = threading.Lock()

    def submit(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> str:
        job_id = uuid.uuid4().hex
        with self._lock:
            self._jobs[job_id] = JobInfo(id=job_id, state="running")

        def finish(future: Future) -> None:
            exc = future.exception()
            info = (
                JobInfo(id=job_id, state="failed", error=str(exc) or type(exc).__name__)
                if exc
                else JobInfo(id=job_id, state="done", result=future.result())
            )
            with self._lock:
                self._jobs[job_id] = info

        self._executor.submit(fn, *args, **kwargs).add_done_callback(finish)
        return job_id

    def status(self, job_id: str) -> JobInfo | None:
        with self._lock:
            return self._jobs.get(job_id)


_store = JobStore()


def get_job_store() -> JobStore:
    return _store
