# SPDX-License-Identifier: Apache-2.0
import json

from samvad.errors import ErrorCode, SamvadError


def test_error_carries_code_and_message():
    err = SamvadError(ErrorCode.AUTH_FAILED, "bad sig")
    assert err.code == "AUTH_FAILED"
    assert str(err) == "bad sig"


def test_error_to_dict():
    err = SamvadError(ErrorCode.SKILL_NOT_FOUND, "nope")
    assert err.to_dict() == {"code": "SKILL_NOT_FOUND", "message": "nope"}
    assert json.dumps(err.to_dict())  # serializable


def test_error_codes_complete():
    expected = {
        "AUTH_FAILED", "SKILL_NOT_FOUND", "SCHEMA_INVALID", "RATE_LIMITED",
        "REPLAY_DETECTED", "INJECTION_DETECTED", "DELEGATION_EXCEEDED",
        "AGENT_UNAVAILABLE", "TOKEN_BUDGET_EXCEEDED",
    }
    actual = {c.value for c in ErrorCode}
    assert expected == actual
