# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from .errors import ErrorCode, SamvadError
from .injection_scanner import scan_object_for_injection
from .nonce_store import NonceStore
from .rate_limiter import RateLimiter
from .signing import verify_request
from .skill_registry import RegisteredSkill, SkillRegistry
from .types import InjectionClassifier, MessageEnvelope

logger = logging.getLogger(__name__)


@dataclass
class VerifyResult:
    ok: bool
    envelope: MessageEnvelope | None = None
    skill: RegisteredSkill | None = None
    error: SamvadError | None = None


def create_verify_middleware(
    *,
    registry: SkillRegistry,
    known_peers: dict[str, str],          # sender agent:// URI → public key b64
    nonce_store: NonceStore,
    rate_limiter: RateLimiter,
    injection_classifier: InjectionClassifier | None = None,
) -> Callable[[str, str, dict[str, str], bytes], Awaitable[VerifyResult]]:
    """
    Returns an async callable: verify_incoming(method, path, headers, raw_body) -> VerifyResult.

    Pipeline (security-critical order — do not reorder):
    1. Nonce + timestamp window  → REPLAY_DETECTED
    2. Rate limit                → RATE_LIMITED / TOKEN_BUDGET_EXCEEDED
    3. Signature verify          → AUTH_FAILED
    4. Injection scan            → INJECTION_DETECTED
    5. Trust tier                → AUTH_FAILED (permission denied)
    """

    async def verify_incoming(
        method: str,
        path: str,
        headers: dict[str, str],
        raw_body: bytes,
    ) -> VerifyResult:
        lower = {k.lower(): v for k, v in headers.items()}

        # --- Parse envelope from body ---
        try:
            body_dict: dict[str, Any] = json.loads(raw_body)
            envelope = MessageEnvelope.model_validate(body_dict)
        except Exception as e:
            return VerifyResult(
                ok=False,
                error=SamvadError(ErrorCode.SCHEMA_INVALID, f"invalid envelope: {e}"),
            )

        sender = envelope.from_
        skill_name = envelope.skill

        # --- Step 1: Nonce + timestamp ---
        import datetime
        try:
            ts_str = envelope.timestamp
            ts_dt = datetime.datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            ts_unix = int(ts_dt.timestamp())
        except Exception:
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.REPLAY_DETECTED, "invalid timestamp"))

        ok = await nonce_store.check_and_add(sender, envelope.nonce, ts_unix)
        if not ok:
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.REPLAY_DETECTED, "replay or expired"))

        # --- Step 2: Rate limit ---
        if not rate_limiter.check_request(sender):
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.RATE_LIMITED, "rate limited"))

        # --- Step 3: Signature verify ---
        pub_key = known_peers.get(sender)
        if pub_key is None:
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.AUTH_FAILED, f"unknown peer: {sender}"))

        # Build headers dict for verification — include all lowercased headers
        if not verify_request(method, path, lower, pub_key):
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.AUTH_FAILED, "signature verification failed"))

        # --- Step 4: Injection scan (only after auth — never on untrusted input pre-auth) ---
        payload = envelope.payload
        if scan_object_for_injection(payload):
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.INJECTION_DETECTED, "injection pattern detected"))

        if injection_classifier is not None:
            try:
                result = injection_classifier(payload)
                detected = await _await_if_needed(result)
                if detected:
                    return VerifyResult(ok=False, error=SamvadError(ErrorCode.INJECTION_DETECTED, "classifier detected injection"))
            except Exception:
                logger.warning("injection_classifier raised — fail-open, proceeding", exc_info=True)

        # --- Step 5: Trust tier ---
        skill = registry.get(skill_name)
        if skill is None:
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.SKILL_NOT_FOUND, f"unknown skill: {skill_name}"))

        trust = skill.definition.trust
        if trust == "trusted-peers":
            allowed = skill.definition.allowed_peers or []
            if sender not in allowed:
                return VerifyResult(ok=False, error=SamvadError(ErrorCode.AUTH_FAILED, "not in trusted-peers list"))
        # 'public' and 'authenticated' require valid signature (already verified in step 3)

        return VerifyResult(ok=True, envelope=envelope, skill=skill)

    return verify_incoming


async def _await_if_needed(result: Any) -> bool:
    if hasattr(result, "__await__"):
        return await result
    return bool(result)
