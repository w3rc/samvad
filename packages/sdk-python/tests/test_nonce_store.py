# SPDX-License-Identifier: Apache-2.0
import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from samvad.nonce_store import InMemoryNonceStore, UpstashRedisNonceStore

# ── InMemoryNonceStore ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fresh_nonce_accepted():
    s = InMemoryNonceStore(window_seconds=300)
    assert await s.check_and_add("alice", "n1", int(time.time()))


@pytest.mark.asyncio
async def test_replay_rejected():
    s = InMemoryNonceStore(window_seconds=300)
    now = int(time.time())
    await s.check_and_add("alice", "n1", now)
    assert not await s.check_and_add("alice", "n1", now)


@pytest.mark.asyncio
async def test_stale_timestamp_rejected():
    s = InMemoryNonceStore(window_seconds=300)
    now = int(time.time())
    assert not await s.check_and_add("alice", "n1", now - 301)


@pytest.mark.asyncio
async def test_future_timestamp_rejected():
    s = InMemoryNonceStore(window_seconds=300)
    now = int(time.time())
    assert not await s.check_and_add("alice", "n1", now + 301)


@pytest.mark.asyncio
async def test_future_timestamp_within_skew_accepted():
    s = InMemoryNonceStore(window_seconds=300, clock_skew_seconds=60)
    now = int(time.time())
    # 30 seconds in the future is within the 60s skew window — should be accepted
    assert await s.check_and_add("alice", "n-skew", now + 30)


@pytest.mark.asyncio
async def test_future_timestamp_beyond_skew_rejected():
    s = InMemoryNonceStore(window_seconds=300, clock_skew_seconds=60)
    now = int(time.time())
    # 61 seconds in the future exceeds the 60s clock skew — should be rejected
    assert not await s.check_and_add("alice", "n-future", now + 61)


@pytest.mark.asyncio
async def test_different_senders_isolated():
    s = InMemoryNonceStore(window_seconds=300)
    now = int(time.time())
    assert await s.check_and_add("alice", "n1", now)
    assert await s.check_and_add("bob", "n1", now)


# ── UpstashRedisNonceStore ────────────────────────────────────────────────────

def _make_redis(set_return: str | None = "OK", delete_return: int = 1) -> MagicMock:
    redis = MagicMock()
    redis.set = AsyncMock(return_value=set_return)
    redis.delete = AsyncMock(return_value=delete_return)
    return redis


@pytest.mark.asyncio
async def test_redis_fresh_nonce_accepted():
    redis = _make_redis(set_return="OK")
    store = UpstashRedisNonceStore(redis)
    assert await store.check("alice", "n1", int(time.time()))


@pytest.mark.asyncio
async def test_redis_replay_rejected_when_set_returns_none():
    redis = _make_redis(set_return=None)
    store = UpstashRedisNonceStore(redis)
    assert not await store.check("alice", "n1", int(time.time()))


@pytest.mark.asyncio
async def test_redis_expired_timestamp_skips_redis():
    redis = _make_redis()
    store = UpstashRedisNonceStore(redis)
    old = int(time.time()) - 400
    assert not await store.check("alice", "n1", old)
    redis.set.assert_not_called()


@pytest.mark.asyncio
async def test_redis_far_future_timestamp_skips_redis():
    redis = _make_redis()
    store = UpstashRedisNonceStore(redis)
    future = int(time.time()) + 200
    assert not await store.check("alice", "n1", future)
    redis.set.assert_not_called()


@pytest.mark.asyncio
async def test_redis_check_uses_nx_and_positive_px():
    redis = _make_redis()
    store = UpstashRedisNonceStore(redis)
    await store.check("alice", "n1", int(time.time()))
    redis.set.assert_called_once()
    call_kwargs = {
        **dict(zip(["key", "value", "nx", "px"], redis.set.call_args.args, strict=False)),
        **redis.set.call_args.kwargs,
    }
    assert call_kwargs.get("nx") is True
    assert call_kwargs.get("px", 0) > 0


@pytest.mark.asyncio
async def test_redis_key_uses_prefix_and_sender():
    redis = _make_redis()
    store = UpstashRedisNonceStore(redis)
    await store.check("agent://alice.example.com", "abc123", int(time.time()))
    key_used = redis.set.call_args.args[0]
    assert key_used.startswith("samvad:nonce:")
    assert "abc123" in key_used


@pytest.mark.asyncio
async def test_redis_commit_overwrites_without_nx():
    redis = _make_redis()
    store = UpstashRedisNonceStore(redis)
    now = int(time.time())
    await store.commit("alice", "n1", now)
    call_kwargs = {
        **dict(zip(["key", "value", "nx", "px"], redis.set.call_args.args, strict=False)),
        **redis.set.call_args.kwargs,
    }
    # nx must be False (or absent) for commit — it's an overwrite
    assert not call_kwargs.get("nx", False)
    assert call_kwargs.get("px", 0) > 0


@pytest.mark.asyncio
async def test_redis_rollback_deletes_key():
    redis = _make_redis()
    store = UpstashRedisNonceStore(redis)
    await store.rollback("alice", "n1")
    redis.delete.assert_called_once()
    key_used = redis.delete.call_args.args[0]
    assert "alice" in key_used
    assert "n1" in key_used


@pytest.mark.asyncio
async def test_redis_check_and_add_calls_check_then_commit():
    redis = _make_redis(set_return="OK")
    store = UpstashRedisNonceStore(redis)
    result = await store.check_and_add("alice", "n1", int(time.time()))
    assert result is True
    # set called twice: once for check (NX), once for commit (overwrite)
    assert redis.set.call_count == 2


@pytest.mark.asyncio
async def test_redis_check_and_add_skips_commit_on_replay():
    redis = _make_redis(set_return=None)
    store = UpstashRedisNonceStore(redis)
    result = await store.check_and_add("alice", "n1", int(time.time()))
    assert result is False
    # set called once for check only — no commit since check failed
    assert redis.set.call_count == 1
