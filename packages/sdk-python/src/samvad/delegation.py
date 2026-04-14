# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import base64
import time
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

from .errors import ErrorCode, SamvadError


def _private_key_from_b64(private_key_b64: str) -> Ed25519PrivateKey:
    """Convert a base64-encoded raw Ed25519 private key to a cryptography key object."""
    raw_bytes = base64.b64decode(private_key_b64)
    return Ed25519PrivateKey.from_private_bytes(raw_bytes)


def _public_pem_from_b64(public_key_b64: str) -> bytes:
    """Return PEM bytes for a base64-encoded raw Ed25519 public key."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    raw_bytes = base64.b64decode(public_key_b64)
    pub_key: Ed25519PublicKey = Ed25519PublicKey.from_public_bytes(raw_bytes)
    return pub_key.public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)


def issue_token(
    *,
    iss: str,
    sub: str,
    scope: list[str],
    max_depth: int,
    private_key_b64: str,
    kid: str,
    ttl_seconds: int = 900,
    act: dict[str, Any] | None = None,
) -> str:
    """Issue a signed EdDSA JWT delegation token."""
    now = int(time.time())
    payload: dict[str, Any] = {
        "iss": iss,
        "sub": sub,
        "iat": now,
        "exp": now + ttl_seconds,
        "scope": scope,
        "maxDepth": max_depth,
    }
    if act is not None:
        payload["act"] = act

    priv_key = _private_key_from_b64(private_key_b64)
    pem = priv_key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())

    token: str = jwt.encode(
        payload,
        pem,
        algorithm="EdDSA",
        headers={"kid": kid},
    )
    return token


def verify_token(token: str, *, issuer_public_key_b64: str) -> dict[str, Any]:
    """Verify a delegation JWT and return its claims.

    Raises:
        SamvadError(AUTH_FAILED): If the token is invalid or expired.
        SamvadError(DELEGATION_EXCEEDED): If maxDepth <= 0.
    """
    pub_pem = _public_pem_from_b64(issuer_public_key_b64)

    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            pub_pem,
            algorithms=["EdDSA"],
            options={"require": ["iss", "sub", "exp", "iat"]},
        )
    except jwt.PyJWTError as exc:
        raise SamvadError(
            ErrorCode.AUTH_FAILED, f"Invalid or expired delegation token: {exc}"
        ) from exc

    # Validate scope claim
    if not isinstance(payload.get("scope"), list) or not all(
        isinstance(s, str) for s in payload["scope"]
    ):
        raise SamvadError(ErrorCode.AUTH_FAILED, "Delegation token missing or invalid scope claim")

    # Validate maxDepth claim
    if not isinstance(payload.get("maxDepth"), int):
        raise SamvadError(
            ErrorCode.AUTH_FAILED, "Delegation token missing or invalid maxDepth claim"
        )

    max_depth: int = payload["maxDepth"]
    if max_depth <= 0:
        raise SamvadError(ErrorCode.DELEGATION_EXCEEDED, "Delegation depth limit reached")

    return payload


def chain_token(
    parent_token: str,
    *,
    new_sub: str,
    new_iss: str,
    private_key_b64: str,
    kid: str,
    issuer_public_key_b64: str,
) -> str:
    """Create a chained delegation token (RFC 8693 act claim).

    Verifies the parent token, decrements maxDepth, and wraps the parent
    payload as the `act` claim in the new token.

    Raises:
        SamvadError(DELEGATION_EXCEEDED): If the parent's maxDepth is already <= 0
            or would become <= 0 after decrement.
        SamvadError(AUTH_FAILED): If the parent token is invalid.
    """
    parent_claims = verify_token(parent_token, issuer_public_key_b64=issuer_public_key_b64)
    new_max_depth = parent_claims["maxDepth"] - 1
    if new_max_depth <= 0:
        raise SamvadError(
            ErrorCode.DELEGATION_EXCEEDED, "Delegation depth limit reached after chaining"
        )

    # Build act claim from parent payload
    act: dict[str, Any] = {"sub": parent_claims["sub"]}

    return issue_token(
        iss=new_iss,
        sub=new_sub,
        scope=parent_claims["scope"],
        max_depth=new_max_depth,
        private_key_b64=private_key_b64,
        kid=kid,
        act=act,
    )
