# SPDX-License-Identifier: Apache-2.0
import time
import pytest
from samvad.nonce_store import InMemoryNonceStore


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
