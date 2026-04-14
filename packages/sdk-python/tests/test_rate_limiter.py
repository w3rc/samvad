# SPDX-License-Identifier: Apache-2.0
import pytest

from samvad.errors import ErrorCode, SamvadError
from samvad.rate_limiter import RateLimiter


def test_allows_requests_within_limit():
    rl = RateLimiter(requests_per_minute=10, requests_per_sender=5)
    rl.check("agent://a.com")
    rl.check("agent://a.com")


def test_raises_rate_limited_when_per_sender_exceeded():
    rl = RateLimiter(requests_per_minute=100, requests_per_sender=2)
    rl.check("agent://a.com")
    rl.check("agent://a.com")
    with pytest.raises(SamvadError) as exc_info:
        rl.check("agent://a.com")
    assert exc_info.value.code == ErrorCode.RATE_LIMITED.value


def test_raises_token_budget_exceeded():
    rl = RateLimiter(
        requests_per_minute=100, requests_per_sender=100, tokens_per_sender_per_day=1000
    )
    rl.record_tokens("agent://a.com", 1001)
    with pytest.raises(SamvadError) as exc_info:
        rl.check("agent://a.com")
    assert exc_info.value.code == ErrorCode.TOKEN_BUDGET_EXCEEDED.value


def test_no_token_budget_enforced_when_not_configured():
    rl = RateLimiter(requests_per_minute=100, requests_per_sender=100)
    rl.record_tokens("agent://a.com", 999999)
    rl.check("agent://a.com")  # should not raise


def test_global_rate_limit_across_different_senders():
    rl = RateLimiter(requests_per_minute=3, requests_per_sender=100)
    rl.check("agent://a.com")
    rl.check("agent://b.com")
    rl.check("agent://c.com")
    with pytest.raises(SamvadError) as exc_info:
        rl.check("agent://d.com")
    assert exc_info.value.code == ErrorCode.RATE_LIMITED.value


def test_different_senders_are_isolated():
    """One sender hitting its limit does not affect another sender."""
    rl = RateLimiter(requests_per_minute=100, requests_per_sender=2)
    rl.check("agent://a.com")
    rl.check("agent://a.com")
    # agent://a.com is now at limit; agent://b.com should still be allowed
    rl.check("agent://b.com")
    with pytest.raises(SamvadError):
        rl.check("agent://a.com")


def test_check_request_returns_bool():
    rl = RateLimiter(requests_per_minute=2, requests_per_sender=2)
    assert rl.check_request("agent://a.com") is True
    assert rl.check_request("agent://a.com") is True
    assert rl.check_request("agent://a.com") is False  # per-sender exceeded
