# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import time

import pytest

from samvad.task_store import TaskStore


@pytest.fixture
def store():
    return TaskStore(retention_seconds=3600)


def test_create_returns_pending(store):
    task = store.create_task()
    assert task.task_id
    assert task.status == "pending"
    assert task.progress is None
    assert task.result is None


def test_create_with_explicit_task_id(store):
    task = store.create_task("my-task-id")
    assert task.task_id == "my-task-id"


def test_get_returns_task(store):
    task = store.create_task()
    fetched = store.get_task(task.task_id)
    assert fetched is not None
    assert fetched.task_id == task.task_id


def test_get_unknown_returns_none(store):
    assert store.get_task("does-not-exist") is None


def test_set_running(store):
    task = store.create_task()
    store.set_running(task.task_id, 0.1)
    updated = store.get_task(task.task_id)
    assert updated is not None
    assert updated.status == "running"
    assert updated.progress == pytest.approx(0.1)


def test_set_done(store):
    task = store.create_task()
    store.set_done(task.task_id, {"answer": 42})
    updated = store.get_task(task.task_id)
    assert updated is not None
    assert updated.status == "done"
    assert updated.result == {"answer": 42}
    assert updated.completed_at is not None


def test_set_failed(store):
    task = store.create_task()
    store.set_failed(task.task_id, {"code": "AGENT_UNAVAILABLE", "message": "crashed"})
    updated = store.get_task(task.task_id)
    assert updated is not None
    assert updated.status == "failed"
    assert updated.error is not None
    assert updated.error.code == "AGENT_UNAVAILABLE"


def test_get_after_ttl_returns_none():
    # Use a very short retention to simulate TTL expiry
    store = TaskStore(retention_seconds=0)
    task = store.create_task()
    # Even without sleeping, a retention of 0 means the task is immediately expired
    result = store.get_task(task.task_id)
    assert result is None


def test_update_task(store):
    task = store.create_task()
    updated = store.update_task(task.task_id, status="running", progress=0.5)
    assert updated is not None
    assert updated.status == "running"
    assert updated.progress == pytest.approx(0.5)


def test_sweep_removes_expired_tasks():
    store = TaskStore(retention_seconds=0)
    task = store.create_task()
    store.sweep()
    assert store.get_task(task.task_id) is None
