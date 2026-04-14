# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import base64

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
    PublicFormat,
)

from samvad.delegation import chain_token, issue_token, verify_token
from samvad.errors import ErrorCode, SamvadError
from samvad.keys import Keypair


def _make_keypair(kid: str = "key-1") -> Keypair:
    """Generate a fresh in-memory keypair for tests."""
    priv = Ed25519PrivateKey.generate()
    raw_priv = priv.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    raw_pub = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return Keypair(
        kid=kid,
        private_key_b64=base64.b64encode(raw_priv).decode(),
        public_key_b64=base64.b64encode(raw_pub).decode(),
    )


@pytest.fixture
def keypair():
    return _make_keypair("key-1")


def test_issue_and_verify_roundtrip(keypair):
    token = issue_token(
        iss="agent://a.com",
        sub="agent://b.com",
        scope=["review-code"],
        max_depth=2,
        private_key_b64=keypair.private_key_b64,
        kid="key-1",
        ttl_seconds=3600,
    )
    assert isinstance(token, str)

    claims = verify_token(token, issuer_public_key_b64=keypair.public_key_b64)
    assert claims["iss"] == "agent://a.com"
    assert claims["sub"] == "agent://b.com"
    assert "review-code" in claims["scope"]
    assert claims["maxDepth"] == 2


def test_delegation_exceeded_when_max_depth_zero(keypair):
    token = issue_token(
        iss="agent://a.com",
        sub="agent://b.com",
        scope=["review-code"],
        max_depth=0,
        private_key_b64=keypair.private_key_b64,
        kid="key-1",
        ttl_seconds=3600,
    )
    with pytest.raises(SamvadError) as exc_info:
        verify_token(token, issuer_public_key_b64=keypair.public_key_b64)
    assert exc_info.value.code == ErrorCode.DELEGATION_EXCEEDED.value


def test_auth_failed_for_expired_token(keypair):
    token = issue_token(
        iss="agent://a.com",
        sub="agent://b.com",
        scope=["review-code"],
        max_depth=2,
        private_key_b64=keypair.private_key_b64,
        kid="key-1",
        ttl_seconds=-1,
    )
    with pytest.raises(SamvadError) as exc_info:
        verify_token(token, issuer_public_key_b64=keypair.public_key_b64)
    assert exc_info.value.code == ErrorCode.AUTH_FAILED.value


def test_auth_failed_for_wrong_key(keypair):
    other_kp = _make_keypair("key-2")
    token = issue_token(
        iss="agent://a.com",
        sub="agent://b.com",
        scope=["review-code"],
        max_depth=2,
        private_key_b64=keypair.private_key_b64,
        kid="key-1",
        ttl_seconds=3600,
    )
    with pytest.raises(SamvadError) as exc_info:
        verify_token(token, issuer_public_key_b64=other_kp.public_key_b64)
    assert exc_info.value.code == ErrorCode.AUTH_FAILED.value


def test_chain_token_decrements_max_depth(keypair):
    parent_token = issue_token(
        iss="agent://a.com",
        sub="agent://b.com",
        scope=["review-code"],
        max_depth=3,
        private_key_b64=keypair.private_key_b64,
        kid="key-1",
        ttl_seconds=3600,
    )

    # Use parent's public key to verify the chain; chain with same keypair for simplicity
    chained = chain_token(
        parent_token,
        new_sub="agent://c.com",
        new_iss="agent://b.com",
        private_key_b64=keypair.private_key_b64,
        kid="key-1",
        issuer_public_key_b64=keypair.public_key_b64,
    )

    # Verify chained token (signed with same keypair)
    claims = verify_token(chained, issuer_public_key_b64=keypair.public_key_b64)
    assert claims["maxDepth"] == 2  # 3 - 1
    assert claims["sub"] == "agent://c.com"
    assert "act" in claims
    assert claims["act"]["sub"] == "agent://b.com"


def test_chain_token_raises_when_depth_hits_zero(keypair):
    parent_token = issue_token(
        iss="agent://a.com",
        sub="agent://b.com",
        scope=["review-code"],
        max_depth=1,  # after decrement -> 0, should fail
        private_key_b64=keypair.private_key_b64,
        kid="key-1",
        ttl_seconds=3600,
    )

    with pytest.raises(SamvadError) as exc_info:
        chain_token(
            parent_token,
            new_sub="agent://c.com",
            new_iss="agent://b.com",
            private_key_b64=keypair.private_key_b64,
            kid="key-1",
            issuer_public_key_b64=keypair.public_key_b64,
        )
    assert exc_info.value.code == ErrorCode.DELEGATION_EXCEEDED.value
