# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import asyncio
import threading
import time
import uuid

from .types import TaskRecord, TaskRecordError

_TTL_SECONDS = 3600  # 1 hour


class TaskStore:
    """In-memory task store with a 1-hour TTL."""

    def __init__(self, retention_seconds: int = _TTL_SECONDS) -> None:
        self._retention = retention_seconds
        self._tasks: dict[str, TaskRecord] = {}
        self._lock = threading.Lock()

    def _is_expired(self, task: TaskRecord) -> bool:
        now = time.time()
        if task.status in ("done", "failed") and task.completed_at is not None:
            return (now - task.completed_at) > self._retention
        return (now - task.created_at) > self._retention

    def create_task(self, task_id: str | None = None) -> TaskRecord:
        """Create a new task in 'pending' state."""
        tid = task_id if task_id is not None else str(uuid.uuid4())
        task = TaskRecord(
            taskId=tid,
            status="pending",
            createdAt=int(time.time()),
        )
        with self._lock:
            self._tasks[tid] = task
        return task

    def get_task(self, task_id: str) -> TaskRecord | None:
        """Return the task record or None if not found / expired."""
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            if self._is_expired(task):
                del self._tasks[task_id]
                return None
            return task

    def update_task(self, task_id: str, **kwargs) -> TaskRecord | None:
        """Apply keyword updates to a task and return the updated record."""
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            if self._is_expired(task):
                del self._tasks[task_id]
                return None
            updated = task.model_copy(update=kwargs)
            self._tasks[task_id] = updated
            return updated

    def set_running(self, task_id: str, progress: float = 0.0) -> None:
        self.update_task(task_id, status="running", progress=progress)

    def set_done(self, task_id: str, result: dict) -> None:
        self.update_task(task_id, status="done", result=result, completed_at=int(time.time()))

    def set_failed(self, task_id: str, error: dict) -> None:
        err = TaskRecordError(**error)
        self.update_task(task_id, status="failed", error=err, completed_at=int(time.time()))

    def sweep(self) -> None:
        """Remove all expired tasks."""
        with self._lock:
            expired = [tid for tid, t in self._tasks.items() if self._is_expired(t)]
            for tid in expired:
                del self._tasks[tid]

    async def start_background_sweep(self, sweep_interval_seconds: int = 300) -> None:
        """Start background task to evict expired entries every N seconds."""
        async def _run() -> None:
            while True:
                await asyncio.sleep(sweep_interval_seconds)
                self.sweep()
        asyncio.create_task(_run())
