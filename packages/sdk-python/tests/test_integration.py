# SPDX-License-Identifier: Apache-2.0
"""
Integration test: full round-trip through the Python server pipeline via in-process ASGI.
Proves the complete verify pipeline (nonce, rate-limit, signature, injection, trust)
works end-to-end with a properly formed signed MessageEnvelope.
"""
import datetime
import uuid

import httpx
import pytest
from pydantic import BaseModel

from samvad import SkillContext
from samvad.card import build_agent_card
from samvad.keys import load_or_generate_keypair
from samvad.nonce_store import InMemoryNonceStore
from samvad.rate_limiter import RateLimiter
from samvad.server import ServerConfig, build_app
from samvad.signing import canonical_json, content_digest, sign_request
from samvad.skill_registry import SkillRegistry
from samvad.task_store import TaskStore
from samvad.types import PublicKey, RateLimit


class AnyIn(BaseModel):
    model_config = {"extra": "allow"}


class AnyOut(BaseModel):
    ok: bool = True


@pytest.mark.asyncio
async def test_full_round_trip_via_asgi(tmp_path):
    """Full pipeline: Agent server + signed envelope, in-process via ASGI transport."""
    # Build server keypair and client keypair
    server_kp = load_or_generate_keypair(tmp_path / "server", "server")
    client_kp = load_or_generate_keypair(tmp_path / "client", "client")
    sender_id = f"agent://client-{client_kp.kid}"

    # Register echo skill
    reg = SkillRegistry()

    async def echo_handler(p: AnyIn, ctx: SkillContext) -> AnyOut:
        return AnyOut(ok=True)

    reg.register(
        name="echo",
        description="echo skill",
        input_schema=AnyIn,
        output_schema=AnyOut,
        modes=["sync"],
        trust="public",
        handler=echo_handler,
    )

    # Build the AgentCard, advertising the server's public key
    card = build_agent_card(
        name="round-trip-server",
        version="0.1.0",
        description="Integration test server",
        url="http://testserver",
        specializations=[],
        models=[],
        skills=reg.to_skill_defs(),
        public_keys=[PublicKey(kid=server_kp.kid, key=server_kp.public_key_b64, active=True)],
        rate_limit=RateLimit(requestsPerMinute=100, requestsPerSender=100),
        card_ttl=300,
    )

    # ServerConfig: trust the client's key
    config = ServerConfig(
        card=card,
        registry=reg,
        known_peers={sender_id: client_kp.public_key_b64},
        nonce_store=InMemoryNonceStore(),
        rate_limiter=RateLimiter(requests_per_minute=100, requests_per_sender=100),
        task_store=TaskStore(),
        sign_keypair=server_kp,
    )
    app = build_app(config)

    # Build and sign a MessageEnvelope
    envelope = {
        "from": sender_id,
        "to": card.id,
        "skill": "echo",
        "mode": "sync",
        "nonce": str(uuid.uuid4()),
        "timestamp": datetime.datetime.now(datetime.timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
        "traceId": str(uuid.uuid4()),
        "spanId": str(uuid.uuid4()),
        "payload": {"text": "hello from integration test"},
    }
    raw_body = canonical_json(envelope).encode("utf-8")
    digest = content_digest(raw_body)
    base_headers = {"content-type": "application/json", "content-digest": digest}
    sig_headers = sign_request(
        "POST", "/agent/message", base_headers,
        client_kp.private_key_b64, client_kp.kid,
    )
    all_headers = {**base_headers, **sig_headers}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as http:
        resp = await http.post("/agent/message", content=raw_body, headers=all_headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "ok"
        assert data["result"]["ok"] is True


@pytest.mark.asyncio
async def test_replay_rejected(tmp_path):
    """Replaying the same nonce must be rejected with 401."""
    server_kp = load_or_generate_keypair(tmp_path / "server", "server")
    client_kp = load_or_generate_keypair(tmp_path / "client", "client")
    sender_id = f"agent://client-{client_kp.kid}"

    reg = SkillRegistry()

    async def echo_handler(p: AnyIn, ctx: SkillContext) -> AnyOut:
        return AnyOut(ok=True)

    reg.register(
        name="echo",
        description="",
        input_schema=AnyIn,
        output_schema=AnyOut,
        modes=["sync"],
        trust="public",
        handler=echo_handler,
    )

    card = build_agent_card(
        name="replay-test-server",
        version="0.1.0",
        description="",
        url="http://testserver",
        specializations=[],
        models=[],
        skills=reg.to_skill_defs(),
        public_keys=[PublicKey(kid=server_kp.kid, key=server_kp.public_key_b64, active=True)],
        rate_limit=RateLimit(requestsPerMinute=100, requestsPerSender=100),
        card_ttl=300,
    )
    config = ServerConfig(
        card=card,
        registry=reg,
        known_peers={sender_id: client_kp.public_key_b64},
        nonce_store=InMemoryNonceStore(),
        rate_limiter=RateLimiter(requests_per_minute=100, requests_per_sender=100),
        task_store=TaskStore(),
        sign_keypair=server_kp,
    )
    app = build_app(config)

    nonce = str(uuid.uuid4())
    envelope = {
        "from": sender_id,
        "to": card.id,
        "skill": "echo",
        "mode": "sync",
        "nonce": nonce,
        "timestamp": datetime.datetime.now(datetime.timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
        "traceId": str(uuid.uuid4()),
        "spanId": str(uuid.uuid4()),
        "payload": {},
    }
    raw_body = canonical_json(envelope).encode("utf-8")
    digest = content_digest(raw_body)
    base_headers = {"content-type": "application/json", "content-digest": digest}
    sig_headers = sign_request(
        "POST", "/agent/message", base_headers,
        client_kp.private_key_b64, client_kp.kid,
    )
    all_headers = {**base_headers, **sig_headers}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as http:
        # First request — must succeed
        resp1 = await http.post("/agent/message", content=raw_body, headers=all_headers)
        assert resp1.status_code == 200, resp1.text

        # Second request with same nonce — must be rejected
        resp2 = await http.post("/agent/message", content=raw_body, headers=all_headers)
        assert resp2.status_code == 401
        data = resp2.json()
        assert data["error"]["code"] == "REPLAY_DETECTED"


@pytest.mark.asyncio
async def test_unknown_peer_rejected(tmp_path):
    """A sender not in known_peers must be rejected with 401 AUTH_FAILED."""
    server_kp = load_or_generate_keypair(tmp_path / "server", "server")
    client_kp = load_or_generate_keypair(tmp_path / "client", "client")
    sender_id = f"agent://client-{client_kp.kid}"

    reg = SkillRegistry()

    async def echo_handler(p: AnyIn, ctx: SkillContext) -> AnyOut:
        return AnyOut(ok=True)

    reg.register(
        name="echo",
        description="",
        input_schema=AnyIn,
        output_schema=AnyOut,
        modes=["sync"],
        trust="public",
        handler=echo_handler,
    )

    card = build_agent_card(
        name="unknown-peer-server",
        version="0.1.0",
        description="",
        url="http://testserver",
        specializations=[],
        models=[],
        skills=reg.to_skill_defs(),
        public_keys=[PublicKey(kid=server_kp.kid, key=server_kp.public_key_b64, active=True)],
        rate_limit=RateLimit(requestsPerMinute=100, requestsPerSender=100),
        card_ttl=300,
    )
    # Empty known_peers — client is not trusted
    config = ServerConfig(
        card=card,
        registry=reg,
        known_peers={},
        nonce_store=InMemoryNonceStore(),
        rate_limiter=RateLimiter(requests_per_minute=100, requests_per_sender=100),
        task_store=TaskStore(),
        sign_keypair=server_kp,
    )
    app = build_app(config)

    envelope = {
        "from": sender_id,
        "to": card.id,
        "skill": "echo",
        "mode": "sync",
        "nonce": str(uuid.uuid4()),
        "timestamp": datetime.datetime.now(datetime.timezone.utc)
            .isoformat()
            .replace("+00:00", "Z"),
        "traceId": str(uuid.uuid4()),
        "spanId": str(uuid.uuid4()),
        "payload": {},
    }
    raw_body = canonical_json(envelope).encode("utf-8")
    digest = content_digest(raw_body)
    base_headers = {"content-type": "application/json", "content-digest": digest}
    sig_headers = sign_request(
        "POST", "/agent/message", base_headers,
        client_kp.private_key_b64, client_kp.kid,
    )
    all_headers = {**base_headers, **sig_headers}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as http:
        resp = await http.post("/agent/message", content=raw_body, headers=all_headers)
        assert resp.status_code == 401
        data = resp.json()
        assert data["error"]["code"] == "AUTH_FAILED"
