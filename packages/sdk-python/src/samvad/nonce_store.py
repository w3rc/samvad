# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import asyncio
import time
from abc import ABC, abstractmethod
from typing import Any, Protocol, runtime_checkable


class NonceStore(ABC):
    @abstractmethod
    async def check(self, sender: str, nonce: str, timestamp: int) -> bool:
        """Atomically validate and reserve the nonce slot. Returns True if fresh."""
        ...

    @abstractmethod
    async def commit(self, sender: str, nonce: str, timestamp: int) -> None:
        """Upgrade reserved slot to committed. Call only after all auth checks pass."""
        ...

    @abstractmethod
    async def rollback(self, sender: str, nonce: str) -> None:
        """Release a reserved slot if the caller fails before commit (e.g. rate-limited).
        Optional — reserved slots expire on sweep if not rolled back."""
        ...

    @abstractmethod
    async def check_and_add(self, sender: str, nonce: str, timestamp: int) -> bool:
        """Convenience: check then commit atomically. Legacy method."""
        ...


class InMemoryNonceStore(NonceStore):
    """
    In-memory nonce store with per-sender isolation and asyncio-safe atomic reservation.

    `check()` atomically validates freshness and reserves the nonce slot — preventing
    TOCTOU races between concurrent coroutines. `commit()` upgrades the reservation to
    a permanent entry. `rollback()` releases a reservation on auth failure before commit
    (used for rate-limited rejections so the client can retry with the same nonce).

    Clock skew: future timestamps allowed up to clock_skew_seconds (default 60s) ahead.
    Past timestamps allowed up to window_seconds (default 300s) in the past.
    """

    _RESERVED = "reserved"
    _COMMITTED = "committed"

    def __init__(self, window_seconds: int = 300, clock_skew_seconds: int = 60) -> None:
        self.window = window_seconds
        self.clock_skew = clock_skew_seconds
        self._lock: asyncio.Lock = asyncio.Lock()
        # Maps (sender, nonce) -> (state, timestamp) where state is _RESERVED or _COMMITTED
        self._seen: dict[tuple[str, str], tuple[str, int]] = {}

    async def check(self, sender: str, nonce: str, timestamp: int) -> bool:
        """Atomically validate and reserve the nonce slot. Returns True if fresh."""
        now = int(time.time())
        if now - timestamp > self.window:
            return False
        if timestamp - now > self.clock_skew:
            return False
        key = (sender, nonce)
        async with self._lock:
            if key in self._seen:
                return False  # already seen (reserved or committed) — replay
            self._seen[key] = (self._RESERVED, timestamp)
            return True

    async def commit(self, sender: str, nonce: str, timestamp: int) -> None:
        """Upgrade reserved slot to committed. Call only after all auth checks pass."""
        key = (sender, nonce)
        async with self._lock:
            self._sweep(int(time.time()))
            self._seen[key] = (self._COMMITTED, timestamp)

    async def rollback(self, sender: str, nonce: str) -> None:
        """Release a reserved (not yet committed) slot — allows the client to retry."""
        key = (sender, nonce)
        async with self._lock:
            entry = self._seen.get(key)
            if entry is not None and entry[0] == self._RESERVED:
                del self._seen[key]

    async def check_and_add(self, sender: str, nonce: str, timestamp: int) -> bool:
        """Convenience: check then commit atomically."""
        ok = await self.check(sender, nonce, timestamp)
        if ok:
            await self.commit(sender, nonce, timestamp)
        return ok

    def _sweep(self, now: int) -> None:
        cutoff = now - self.window
        stale = [k for k, (_, ts) in self._seen.items() if ts < cutoff]
        for k in stale:
            del self._seen[k]


@runtime_checkable
class UpstashRedisClient(Protocol):
    """
    Minimal async interface for the Upstash Redis client.

    Using a Protocol keeps this adapter dependency-free — the SDK does not need
    upstash-redis installed to import. Any object that satisfies this interface works.

    The official upstash-redis async client (upstash_redis.asyncio.Redis) satisfies
    this interface out of the box.
    """

    async def set(
        self,
        key: str,
        value: str,
        nx: bool = False,
        px: int | None = None,
        **kwargs: Any,
    ) -> str | None:
        """SET key value [NX] [PX ms]. Returns 'OK' on success or None if NX condition not met."""
        ...

    async def delete(self, *keys: str) -> int:
        """DEL key [key ...]. Returns number of keys deleted."""
        ...


class UpstashRedisNonceStore(NonceStore):
    """
    Upstash Redis nonce store for serverless and multi-replica deployments.

    Uses Redis SET NX PX for atomic check-and-reserve. The two-phase check/commit
    pattern maps to two Redis keys states: 'r' (reserved) and 'c' (committed).
    Rollback deletes the reserved key so the client can retry with the same nonce.

    Install the Upstash Redis async SDK before using this adapter:
        pip install upstash-redis

    Usage:
        from upstash_redis.asyncio import Redis
        from samvad import UpstashRedisNonceStore

        redis = Redis(url=os.environ['UPSTASH_REDIS_REST_URL'],
                      token=os.environ['UPSTASH_REDIS_REST_TOKEN'])
        agent = Agent(..., nonce_store=UpstashRedisNonceStore(redis))
    """

    _RESERVED = "r"
    _COMMITTED = "c"
    _PREFIX = "samvad:nonce:"

    def __init__(
        self,
        redis: UpstashRedisClient,
        window_seconds: int = 300,
        clock_skew_seconds: int = 60,
    ) -> None:
        self._redis = redis
        self._window = window_seconds
        self._clock_skew = clock_skew_seconds

    def _key(self, sender: str, nonce: str) -> str:
        return f"{self._PREFIX}{sender}:{nonce}"

    def _remaining_px(self, now: int, timestamp: int) -> int:
        """Milliseconds until this nonce's window expires. Always at least 1."""
        remaining_s = self._window - (now - timestamp)
        return max(remaining_s * 1000, 1)

    async def check(self, sender: str, nonce: str, timestamp: int) -> bool:
        """
        Validate timestamp and atomically reserve the nonce via SET NX PX.
        Returns True if fresh, False if expired or already seen (replay).
        """
        now = int(time.time())
        if now - timestamp > self._window:
            return False
        if timestamp - now > self._clock_skew:
            return False

        # Atomic check-and-reserve: returns 'OK' on success, None if key exists (replay)
        result = await self._redis.set(
            self._key(sender, nonce),
            self._RESERVED,
            nx=True,
            px=self._remaining_px(now, timestamp),
        )
        return result is not None

    async def commit(self, sender: str, nonce: str, timestamp: int) -> None:
        """
        Upgrade the reserved slot to committed. The key already exists so we
        overwrite without NX. TTL is recalculated from the original timestamp
        so the key expires at the same absolute time regardless of when commit runs.
        """
        now = int(time.time())
        await self._redis.set(
            self._key(sender, nonce),
            self._COMMITTED,
            px=self._remaining_px(now, timestamp),
        )

    async def rollback(self, sender: str, nonce: str) -> None:
        """
        Delete the reserved slot so the client can retry with the same nonce.
        Safe to call unconditionally — rollback only runs before commit (on
        rate-limit rejection), so the key value is always 'r' at this point.
        """
        await self._redis.delete(self._key(sender, nonce))

    async def check_and_add(self, sender: str, nonce: str, timestamp: int) -> bool:
        """Convenience: check then commit atomically."""
        ok = await self.check(sender, nonce, timestamp)
        if ok:
            await self.commit(sender, nonce, timestamp)
        return ok
