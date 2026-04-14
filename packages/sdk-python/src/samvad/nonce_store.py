# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import asyncio
import time
from abc import ABC, abstractmethod


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
