# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PrivateFormat,
    PublicFormat,
    NoEncryption,
)


@dataclass(frozen=True)
class Keypair:
    kid: str
    private_key_b64: str   # 32-byte raw Ed25519 seed, base64-encoded
    public_key_b64: str    # 32-byte raw Ed25519 public key, base64-encoded


def _b64e(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _b64d(s: str) -> bytes:
    return base64.b64decode(s)


def load_or_generate_keypair(keys_dir: Path | str, kid: str) -> Keypair:
    keys_dir = Path(keys_dir)
    keys_dir.mkdir(parents=True, exist_ok=True)
    priv_path = keys_dir / f"{kid}.key"
    pub_path = keys_dir / f"{kid}.pub"

    if priv_path.exists() and pub_path.exists():
        return Keypair(
            kid=kid,
            private_key_b64=priv_path.read_text().strip(),
            public_key_b64=pub_path.read_text().strip(),
        )

    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key()
    raw_priv = priv.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    raw_pub = pub.public_bytes(Encoding.Raw, PublicFormat.Raw)

    kp = Keypair(kid=kid, private_key_b64=_b64e(raw_priv), public_key_b64=_b64e(raw_pub))
    priv_path.write_text(kp.private_key_b64)
    pub_path.write_text(kp.public_key_b64)
    try:
        os.chmod(priv_path, 0o600)
    except OSError:
        pass
    return kp


def sign_raw(private_key_b64: str, message: bytes) -> bytes:
    priv = Ed25519PrivateKey.from_private_bytes(_b64d(private_key_b64))
    return priv.sign(message)


def verify_raw(public_key_b64: str, message: bytes, signature: bytes) -> bool:
    pub = Ed25519PublicKey.from_public_bytes(_b64d(public_key_b64))
    try:
        pub.verify(signature, message)
        return True
    except InvalidSignature:
        return False
