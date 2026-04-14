# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import datetime
import inspect
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
        except Exception:
            return VerifyResult(
                ok=False,
                error=SamvadError(ErrorCode.SCHEMA_INVALID, "invalid request envelope"),
            )

        sender = envelope.from_
        skill_name = envelope.skill

        # --- Step 1: Nonce + timestamp (non-mutating check) ---
        try:
            ts_str = envelope.timestamp
            ts_dt = datetime.datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            ts_unix = int(ts_dt.timestamp())
        except Exception:
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.SCHEMA_INVALID, "invalid timestamp format"))

        nonce_fresh = await nonce_store.check(sender, envelope.nonce, ts_unix)
        if not nonce_fresh:
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.REPLAY_DETECTED, "replay or expired"))

        # --- Step 2: Rate limit ---
        if not rate_limiter.check_request(sender):
            await nonce_store.rollback(sender, envelope.nonce)
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.RATE_LIMITED, "rate limited"))

        # --- Step 3: Signature verify ---
        pub_key = known_peers.get(sender)
        if pub_key is None:
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.AUTH_FAILED, f"unknown peer: {sender}"))

        # Build headers dict for verification — include all lowercased headers
        if not verify_request(method, path, lower, pub_key):
            return VerifyResult(ok=False, error=SamvadError(ErrorCode.AUTH_FAILED, "signature verification failed"))

        # --- Step 3.5: Commit nonce (only after full authentication) ---
        await nonce_store.commit(sender, envelope.nonce, ts_unix)

        # --- Step 3.7: Delegation token verification (if present) ---
        if envelope.delegation_token is not None:
            import jwt as _jwt
            try:
                unverified = _jwt.decode(
                    envelope.delegation_token,
                    options={"verify_signature": False},
                )
                issuer = unverified.get("iss")
            except Exception:
                return VerifyResult(ok=False, error=SamvadError(ErrorCode.AUTH_FAILED, "invalid delegation token format"))

            issuer_pub_key = known_peers.get(issuer or "")
            if issuer_pub_key is None:
                return VerifyResult(ok=False, error=SamvadError(ErrorCode.AUTH_FAILED, f"delegation issuer unknown: {issuer}"))

            from .delegation import verify_token as _verify_token
            try:
                claims = _verify_token(envelope.delegation_token, issuer_public_key_b64=issuer_pub_key)
            except SamvadError as e:
                return VerifyResult(ok=False, error=e)

            if claims.get("sub") != sender:
                return VerifyResult(ok=False, error=SamvadError(ErrorCode.AUTH_FAILED, "delegation token sub does not match sender"))
            if skill_name not in claims.get("scope", []):
                return VerifyResult(ok=False, error=SamvadError(ErrorCode.AUTH_FAILED, f"skill '{skill_name}' not in delegation scope"))

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
        if trust == "authenticated":
            # The SDK only checks that a token is present. Validating the token's content
            # (expiry, claims, issuer) is the responsibility of the skill handler.
            if not (envelope.auth and envelope.auth.token):
                return VerifyResult(ok=False, error=SamvadError(ErrorCode.AUTH_FAILED, "Bearer token required"))
        if trust == "trusted-peers":
            allowed = skill.definition.allowed_peers or []
            if sender not in allowed:
                return VerifyResult(ok=False, error=SamvadError(ErrorCode.AUTH_FAILED, "not in trusted-peers list"))

        return VerifyResult(ok=True, envelope=envelope, skill=skill)

    return verify_incoming


async def _await_if_needed(result: Any) -> bool:
    if inspect.isawaitable(result):
        return await result
    return bool(result)
