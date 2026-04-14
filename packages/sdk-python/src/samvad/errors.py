# SPDX-License-Identifier: Apache-2.0
from enum import Enum


class ErrorCode(str, Enum):
    AUTH_FAILED = "AUTH_FAILED"
    SKILL_NOT_FOUND = "SKILL_NOT_FOUND"
    SCHEMA_INVALID = "SCHEMA_INVALID"
    RATE_LIMITED = "RATE_LIMITED"
    REPLAY_DETECTED = "REPLAY_DETECTED"
    INJECTION_DETECTED = "INJECTION_DETECTED"
    DELEGATION_EXCEEDED = "DELEGATION_EXCEEDED"
    AGENT_UNAVAILABLE = "AGENT_UNAVAILABLE"
    TOKEN_BUDGET_EXCEEDED = "TOKEN_BUDGET_EXCEEDED"


class SamvadError(Exception):
    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: str = code.value
        self.message = message

    def to_dict(self) -> dict[str, str]:
        return {"code": self.code, "message": self.message}
