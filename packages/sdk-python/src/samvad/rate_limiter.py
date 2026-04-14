# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import time
from dataclasses import dataclass, field

from .errors import ErrorCode, SamvadError


@dataclass
class _SenderState:
    request_timestamps: list[float] = field(default_factory=list)
    daily_tokens: int = 0
    day_start: float = 0.0


def _utc_midnight() -> float:
    """Return the Unix timestamp (seconds) for the start of the current UTC day."""
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.timestamp()


class RateLimiter:
    """Sliding-window rate limiter with per-sender and global request limits,
    plus an optional daily token budget per sender."""

    def __init__(
        self,
        requests_per_minute: int,
        requests_per_sender: int,
        tokens_per_sender_per_day: int | None = None,
    ) -> None:
        self._requests_per_minute = requests_per_minute
        self._requests_per_sender = requests_per_sender
        self._tokens_per_sender_per_day = tokens_per_sender_per_day
        self._senders: dict[str, _SenderState] = {}
        self._global_timestamps: list[float] = []

    def _get_or_create(self, sender: str) -> _SenderState:
        if sender not in self._senders:
            self._senders[sender] = _SenderState(day_start=_utc_midnight())
        return self._senders[sender]

    def check_request(self, sender: str) -> bool:
        """Check per-sender and global rate limits. Returns True if allowed."""
        try:
            self._check(sender)
            return True
        except SamvadError:
            return False

    def charge_tokens(self, sender: str, tokens: int) -> bool:
        """Deduct tokens from the sender's daily budget. Returns True if allowed."""
        state = self._get_or_create(sender)
        self._reset_day_if_needed(state)
        if (
            self._tokens_per_sender_per_day is not None
            and state.daily_tokens + tokens > self._tokens_per_sender_per_day
        ):
            return False
        state.daily_tokens += tokens
        return True

    def check(self, sender: str) -> None:
        """Check rate limits, raising SamvadError on violation."""
        self._check(sender)

    def record_tokens(self, sender: str, tokens: int) -> None:
        """Record token usage for a sender (mirrors TS recordTokens)."""
        state = self._get_or_create(sender)
        self._reset_day_if_needed(state)
        state.daily_tokens += tokens

    def _reset_day_if_needed(self, state: _SenderState) -> None:
        today_start = _utc_midnight()
        if state.day_start < today_start:
            state.daily_tokens = 0
            state.day_start = today_start

    def _check(self, sender: str) -> None:
        state = self._get_or_create(sender)
        now = time.time()

        # Reset daily tokens at UTC midnight
        self._reset_day_if_needed(state)

        # Token budget check (before processing request)
        if (
            self._tokens_per_sender_per_day is not None
            and state.daily_tokens >= self._tokens_per_sender_per_day
        ):
            raise SamvadError(
                ErrorCode.TOKEN_BUDGET_EXCEEDED,
                f"Daily token budget of {self._tokens_per_sender_per_day} exceeded",
            )

        window_start = now - 60.0

        # Global rate limit (requests_per_minute across all senders)
        self._global_timestamps = [t for t in self._global_timestamps if t > window_start]
        if len(self._global_timestamps) >= self._requests_per_minute:
            raise SamvadError(
                ErrorCode.RATE_LIMITED,
                f"Global rate limit of {self._requests_per_minute} requests/minute exceeded",
            )

        # Per-sender rate limit (sliding window)
        state.request_timestamps = [t for t in state.request_timestamps if t > window_start]
        if len(state.request_timestamps) >= self._requests_per_sender:
            raise SamvadError(
                ErrorCode.RATE_LIMITED,
                f"Rate limit of {self._requests_per_sender} requests/minute exceeded",
            )

        self._global_timestamps.append(now)
        state.request_timestamps.append(now)
