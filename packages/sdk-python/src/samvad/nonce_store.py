# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import time
from abc import ABC, abstractmethod


class NonceStore(ABC):
    @abstractmethod
    async def check_and_add(self, sender: str, nonce: str, timestamp: int) -> bool: ...


class InMemoryNonceStore(NonceStore):
    def __init__(self, window_seconds: int = 300) -> None:
        self.window = window_seconds
        self._seen: dict[tuple[str, str], int] = {}

    async def check_and_add(self, sender: str, nonce: str, timestamp: int) -> bool:
        now = int(time.time())
        if abs(now - timestamp) > self.window:
            return False
        self._sweep(now)
        key = (sender, nonce)
        if key in self._seen:
            return False
        self._seen[key] = timestamp
        return True

    def _sweep(self, now: int) -> None:
        cutoff = now - self.window
        stale = [k for k, ts in self._seen.items() if ts < cutoff]
        for k in stale:
            del self._seen[k]
