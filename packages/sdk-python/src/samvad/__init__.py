# SPDX-License-Identifier: Apache-2.0
from .agent import Agent
from .agent_client import AgentClient
from .delegation import chain_token, issue_token, verify_token
from .errors import ErrorCode, SamvadError
from .signing import canonical_json, content_digest, sign_request, verify_request
from .types import (
    AgentCard,
    MessageEnvelope,
    RateLimit,
    ResponseEnvelope,
    SkillContext,
    SkillDef,
    TaskRecord,
)
from .verify_middleware import VerifyResult, create_verify_middleware

__version__ = "0.1.0"

__all__ = [
    # Core
    "Agent",
    "AgentClient",
    # Errors
    "SamvadError",
    "ErrorCode",
    # Middleware
    "create_verify_middleware",
    "VerifyResult",
    # Types
    "SkillContext",
    "MessageEnvelope",
    "ResponseEnvelope",
    "AgentCard",
    "SkillDef",
    "RateLimit",
    "TaskRecord",
    # Delegation
    "issue_token",
    "verify_token",
    "chain_token",
    # Signing utilities
    "sign_request",
    "verify_request",
    "canonical_json",
    "content_digest",
    # Version
    "__version__",
]
