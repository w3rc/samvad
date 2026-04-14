# SPDX-License-Identifier: Apache-2.0
from pathlib import Path
from samvad.keys import load_or_generate_keypair, sign_raw, verify_raw


def test_keypair_persists(tmp_path: Path):
    kp1 = load_or_generate_keypair(tmp_path, "kid-1")
    kp2 = load_or_generate_keypair(tmp_path, "kid-1")
    assert kp1.public_key_b64 == kp2.public_key_b64
    assert kp1.kid == "kid-1"


def test_keypair_different_kid(tmp_path: Path):
    a = load_or_generate_keypair(tmp_path, "a")
    b = load_or_generate_keypair(tmp_path, "b")
    assert a.public_key_b64 != b.public_key_b64


def test_sign_and_verify(tmp_path: Path):
    kp = load_or_generate_keypair(tmp_path, "k")
    sig = sign_raw(kp.private_key_b64, b"hello")
    assert verify_raw(kp.public_key_b64, b"hello", sig)
    assert not verify_raw(kp.public_key_b64, b"tampered", sig)
