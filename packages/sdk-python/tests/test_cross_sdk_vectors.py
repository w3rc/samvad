# SPDX-License-Identifier: Apache-2.0
"""
Cross-SDK wire-compatibility test.
Verifies that Python can verify RFC 9421 signatures produced by the TypeScript SDK.
"""
import json
from pathlib import Path

import pytest

from samvad.signing import verify_request

VECTORS_PATH = Path(__file__).resolve().parents[3] / "spec" / "test-vectors" / "vectors.json"


def test_vectors_file_exists():
    assert VECTORS_PATH.exists(), f"Vectors file not found: {VECTORS_PATH}"


def test_python_verifies_ts_signed_vectors():
    data = json.loads(VECTORS_PATH.read_text())
    pub = data["publicKeyB64"]
    cases = data["cases"]
    assert cases, "No test cases in vectors.json"

    for case in cases:
        headers = case["expectedResult"]  # content-digest, signature-input, signature
        ok = verify_request(
            method=case["method"],
            path=case["path"],
            headers=headers,
            public_key_b64=pub,
        )
        assert ok, (
            f"Python failed to verify TS-signed vector '{case['name']}'.\n"
            f"  method={case['method']} path={case['path']}\n"
            f"  headers={headers}\n"
            f"  public_key={pub[:20]}..."
        )


def _load_case_names() -> list[str]:
    if not VECTORS_PATH.exists():
        return []
    data = json.loads(VECTORS_PATH.read_text())
    return [c["name"] for c in data.get("cases", [])]


@pytest.mark.parametrize("case_name", _load_case_names())
def test_each_vector_by_name(case_name: str):
    data = json.loads(VECTORS_PATH.read_text())
    pub = data["publicKeyB64"]
    case = next(c for c in data["cases"] if c["name"] == case_name)
    headers = case["expectedResult"]
    assert verify_request(case["method"], case["path"], headers, pub), (
        f"Verification failed for {case_name}"
    )
