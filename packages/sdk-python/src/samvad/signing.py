# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import base64
import hashlib
import json
import re
import time
from typing import Any

from .keys import sign_raw, verify_raw


# Covered components in EXACTLY this order — changing order breaks cross-SDK compat
# Must match the TS SDK: ("@method" "@path" "content-digest") only
COVERED_COMPONENTS: tuple[str, ...] = (
    '"@method"',
    '"@path"',
    '"content-digest"',
)


def _sort_recursive(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _sort_recursive(obj[k]) for k in sorted(obj.keys())}
    if isinstance(obj, list):
        return [_sort_recursive(x) for x in obj]
    return obj


def canonical_json(obj: Any) -> str:
    return json.dumps(
        _sort_recursive(obj),
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def content_digest(body: bytes) -> str:
    h = hashlib.sha256(body).digest()
    return f"sha-256=:{base64.b64encode(h).decode('ascii')}:"


def _build_signature_base(
    method: str,
    path: str,
    headers: dict[str, str],
    created: int,
    keyid: str,
) -> tuple[str, str]:
    """Return (signature-base, signature-input-params-string)."""
    lower = {k.lower(): v for k, v in headers.items()}
    lines: list[str] = []
    for comp in COVERED_COMPONENTS:
        name = comp.strip('"')
        if name == "@method":
            val = method.upper()
        elif name == "@path":
            val = path
        else:
            val = lower[name]
        lines.append(f"{comp}: {val}")

    # Param ordering must match TS: keyid first, then alg, then created
    params = f'({" ".join(COVERED_COMPONENTS)});keyid="{keyid}";alg="ed25519";created={created}'
    lines.append(f'"@signature-params": {params}')
    # Each line ends with \n (including the last) to match TS template-literal format
    base_str = "\n".join(lines) + "\n"
    return base_str, params


def sign_request(
    method: str,
    path: str,
    headers: dict[str, str],
    private_key_b64: str,
    kid: str,
    created: int | None = None,
) -> dict[str, str]:
    if created is None:
        created = int(time.time())
    base, params = _build_signature_base(method, path, headers, created, kid)
    sig = sign_raw(private_key_b64, base.encode("utf-8"))
    sig_b64 = base64.b64encode(sig).decode("ascii")
    return {
        "signature-input": f"sig1={params}",
        "signature": f"sig1=:{sig_b64}:",
    }


def _extract_param(params: str, key: str) -> str:
    # params: "(...);created=...;keyid="...";alg=..."
    # skip the (...) component list, then parse semicolon-separated k=v pairs
    if ";" not in params:
        raise KeyError(key)
    _, rest = params.split(";", 1)
    for part in rest.split(";"):
        part = part.strip()
        if part.startswith(f"{key}="):
            return part[len(key) + 1:]
    raise KeyError(key)


def verify_request(
    method: str,
    path: str,
    headers: dict[str, str],
    public_key_b64: str,
) -> bool:
    lower = {k.lower(): v for k, v in headers.items()}
    si = lower.get("signature-input")
    s = lower.get("signature")
    if not si or not s:
        return False

    try:
        label, params = si.split("=", 1)
        if label != "sig1":
            return False
        created_str = _extract_param(params, "created")
        keyid = _extract_param(params, "keyid").strip('"')
    except (KeyError, ValueError):
        return False

    try:
        base, _ = _build_signature_base(method, path, headers, int(created_str), keyid)
    except (KeyError, ValueError):
        return False

    try:
        sig_label, sig_value = s.split("=", 1)
        if sig_label != "sig1":
            return False
        m = re.match(r'^:([A-Za-z0-9+/]+=*):$', sig_value.strip())
        if not m:
            return False
        sig_b64 = m.group(1)
        signature = base64.b64decode(sig_b64)
    except (ValueError, Exception):
        return False

    return verify_raw(public_key_b64, base.encode("utf-8"), signature)
