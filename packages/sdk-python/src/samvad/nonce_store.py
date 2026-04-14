# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import time
from abc import ABC, abstractmethod


class NonceStore(ABC):
    @abstractmethod
    async def check(self, sender: str, nonce: str, timestamp: int) -> bool:
        """Non-mutating check: returns True if nonce is fresh and timestamp is valid."""
        ...

    @abstractmethod
    async def commit(self, sender: str, nonce: str, timestamp: int) -> None:
        """Mark nonce as seen. Call only after all pipeline gates pass."""
        ...

    @abstractmethod
    async def check_and_add(self, sender: str, nonce: str, timestamp: int) -> bool:
        """Convenience: check then commit atomically. Legacy method."""
        ...


class InMemoryNonceStore(NonceStore):
    """
    In-memory nonce store with per-sender isolation.

    Note: per-sender keying (sender, nonce) is a deliberate improvement over the TS SDK
    which keys on nonce alone. Per-sender isolation prevents a compromised agent from
    exhausting nonce space for all other agents (cross-sender nonce DoS).

    Clock skew: futures timestamps are allowed up to clock_skew_seconds (default 60s) ahead,
    matching the TS SDK's CLOCK_SKEW_MS = 60_000 constant.
    Past timestamps are allowed up to window_seconds (default 300s) in the past.
    """

    def __init__(self, window_seconds: int = 300, clock_skew_seconds: int = 60) -> None:
        self.window = window_seconds
        self.clock_skew = clock_skew_seconds
        self._seen: dict[tuple[str, str], int] = {}

    async def check(self, sender: str, nonce: str, timestamp: int) -> bool:
        now = int(time.time())
        if now - timestamp > self.window:
            return False
        if timestamp - now > self.clock_skew:
            return False
        key = (sender, nonce)
        return key not in self._seen  # True = fresh, False = replay

    async def commit(self, sender: str, nonce: str, timestamp: int) -> None:
        self._sweep(int(time.time()))
        self._seen[(sender, nonce)] = timestamp

    async def check_and_add(self, sender: str, nonce: str, timestamp: int) -> bool:
        ok = await self.check(sender, nonce, timestamp)
        if ok:
            await self.commit(sender, nonce, timestamp)
        return ok

    def _sweep(self, now: int) -> None:
        cutoff = now - self.window
        stale = [k for k, ts in self._seen.items() if ts < cutoff]
        for k in stale:
            del self._seen[k]
