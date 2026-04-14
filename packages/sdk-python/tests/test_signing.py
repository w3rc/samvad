# SPDX-License-Identifier: Apache-2.0
import json
from pathlib import Path

from samvad.keys import load_or_generate_keypair
from samvad.signing import (
    canonical_json,
    content_digest,
    sign_request,
    verify_request,
)


def test_canonical_json_sorts_recursively():
    obj = {"b": {"y": 2, "x": 1}, "a": [3, 2, 1]}
    out = canonical_json(obj)
    assert out == '{"a":[3,2,1],"b":{"x":1,"y":2}}'


def test_canonical_json_utf8_preserved():
    assert canonical_json({"k": "भारत"}) == '{"k":"भारत"}'


def test_content_digest_matches_format():
    body = b'{"hello":"world"}'
    d = content_digest(body)
    # sha-256=:<base64 sha256>:
    assert d.startswith("sha-256=:") and d.endswith(":")
    # Length check: "sha-256=:" (9) + 44-char base64 sha256 + ":" (1) = 54
    assert len(d) == 54


def test_sign_verify_roundtrip(tmp_path: Path):
    kp = load_or_generate_keypair(tmp_path, "k1")
    body = b'{"skill":"echo"}'
    headers = {
        "content-type": "application/json",
        "content-digest": content_digest(body),
        "samvad-agent": "agent://alice.example",
        "samvad-timestamp": "2026-04-14T00:00:00Z",
        "samvad-nonce": "abc",
    }
    sig_headers = sign_request(
        method="POST",
        path="/agent/message",
        headers=headers,
        private_key_b64=kp.private_key_b64,
        kid=kp.kid,
        created=1776470400,
    )
    merged = {**headers, **sig_headers}
    assert verify_request(
        method="POST",
        path="/agent/message",
        headers=merged,
        public_key_b64=kp.public_key_b64,
    )


def test_verify_rejects_tampered(tmp_path: Path):
    kp = load_or_generate_keypair(tmp_path, "k")
    headers = {
        "content-type": "application/json",
        "content-digest": content_digest(b"{}"),
        "samvad-agent": "agent://a",
        "samvad-timestamp": "2026-04-14T00:00:00Z",
        "samvad-nonce": "n",
    }
    sig = sign_request("POST", "/agent/message", headers, kp.private_key_b64, kp.kid, created=1)
    merged = {**headers, **sig}
    merged["samvad-nonce"] = "DIFFERENT"
    assert not verify_request("POST", "/agent/message", merged, kp.public_key_b64)


def test_verify_returns_false_on_missing_sig_headers(tmp_path: Path):
    kp = load_or_generate_keypair(tmp_path, "k")
    headers = {
        "content-type": "application/json",
        "content-digest": content_digest(b"{}"),
        "samvad-agent": "agent://a",
        "samvad-timestamp": "2026-04-14T00:00:00Z",
        "samvad-nonce": "n",
    }
    assert not verify_request("POST", "/agent/message", headers, kp.public_key_b64)
