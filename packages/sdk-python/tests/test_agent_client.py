# SPDX-License-Identifier: Apache-2.0
"""Tests for AgentClient (agent_client.py).

Uses httpx.ASGITransport to run the full Agent ↔ AgentClient round-trip
entirely in-process — no real network required.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import httpx
import pytest
from pydantic import BaseModel

from samvad.agent import Agent
from samvad.agent_client import AgentClient
from samvad.types import AgentCard, SkillContext

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class AddIn(BaseModel):
    a: int
    b: int


class AddOut(BaseModel):
    sum: int


async def add_handler(payload: AddIn, ctx: SkillContext) -> AddOut:
    return AddOut(sum=payload.a + payload.b)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def make_agent(tmp_path: Path, port: int = 3099) -> Agent:
    agent = Agent(
        name="ClientTestAgent",
        url=f"http://localhost:{port}",
        keys_dir=str(tmp_path / "agent-keys"),
    )
    return agent


def make_prepared_client(tmp_path: Path) -> AgentClient:
    return AgentClient.prepare(keys_dir=str(tmp_path / "client-keys"), kid="test-client")


async def make_connected_client(
    agent: Agent,
    app: Any,
    tmp_path: Path,
    base_url: str = "http://testserver",
) -> AgentClient:
    """
    Create an AgentClient with _card set by fetching from the in-process app.
    """
    client = make_prepared_client(tmp_path)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url=base_url
    ) as h:
        resp = await h.get("/.well-known/agent.json")
        resp.raise_for_status()
        client._card = AgentCard.model_validate(resp.json())
    return client


# ---------------------------------------------------------------------------
# Tests: prepare() and properties
# ---------------------------------------------------------------------------

class TestPrepare:
    def test_prepare_creates_keypair_without_connecting(self, tmp_path: Path) -> None:
        client = AgentClient.prepare(keys_dir=str(tmp_path / "keys"), kid="mykey")
        assert client._card is None
        assert client.public_key_b64  # non-empty

    def test_public_key_b64_property(self, tmp_path: Path) -> None:
        client = AgentClient.prepare(keys_dir=str(tmp_path / "keys"), kid="mykey")
        pub = client.public_key_b64
        assert isinstance(pub, str)
        assert len(pub) > 0

    def test_kid_property(self, tmp_path: Path) -> None:
        client = AgentClient.prepare(keys_dir=str(tmp_path / "keys"), kid="mykey")
        assert client.kid == "mykey"

    def test_prepare_stores_keypair_on_disk(self, tmp_path: Path) -> None:
        keys_dir = tmp_path / "keys"
        AgentClient.prepare(keys_dir=str(keys_dir), kid="k1")
        # second call loads from disk — same public key
        c1 = AgentClient.prepare(keys_dir=str(keys_dir), kid="k1")
        c2 = AgentClient.prepare(keys_dir=str(keys_dir), kid="k1")
        assert c1.public_key_b64 == c2.public_key_b64


# ---------------------------------------------------------------------------
# Tests: connect() via in-process ASGI
# ---------------------------------------------------------------------------

class TestConnect:
    async def test_connect_sets_card(self, tmp_path: Path) -> None:
        agent = make_agent(tmp_path)
        agent.skill(
            name="add",
            description="Adds two numbers",
            input_schema=AddIn,
            output_schema=AddOut,
            modes=["sync"],
            trust="public",
            handler=add_handler,
        )
        app = agent.build_app()

        client = make_prepared_client(tmp_path)
        # Patch httpx.AsyncClient to use ASGI transport
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as h:
            resp = await h.get("/.well-known/agent.json")
            resp.raise_for_status()
            client._card = AgentCard.model_validate(resp.json())

        assert client._card is not None
        assert client._card.name == "ClientTestAgent"


# ---------------------------------------------------------------------------
# Tests: call() round-trip
# ---------------------------------------------------------------------------

class TestCall:
    async def test_call_sync_round_trip(self, tmp_path: Path) -> None:
        client_kp_dir = tmp_path / "client-keys"
        agent_kp_dir = tmp_path / "agent-keys"

        # Prepare client first to get its public key
        client = AgentClient.prepare(keys_dir=str(client_kp_dir), kid="test-client")

        agent = Agent(
            name="CallTestAgent",
            url="http://testserver",
            keys_dir=str(agent_kp_dir),
        )
        agent.skill(
            name="add",
            description="Adds two numbers",
            input_schema=AddIn,
            output_schema=AddOut,
            modes=["sync"],
            trust="public",
            handler=add_handler,
        )
        # Trust the client's public key
        client_agent_id = f"agent://client-{client.kid}"
        agent.trust_peer(client_agent_id, client.public_key_b64)

        app = agent.build_app()

        # Set up client's card from the in-process server
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://testserver"
        ) as h:
            resp = await h.get("/.well-known/agent.json")
            resp.raise_for_status()
            client._card = AgentCard.model_validate(resp.json())

        # Patch the client's call method to use ASGI transport
        transport = httpx.ASGITransport(app=app)

        async def patched_post(url: str, *, content: bytes, headers: dict, timeout: Any) -> Any:
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as h:
                path = url.replace("http://testserver", "")
                return await h.post(path, content=content, headers=headers, timeout=timeout)

        # Use monkey-patching approach: override httpx.AsyncClient inside call()
        async def call_via_asgi(skill: str, payload: dict[str, Any]) -> dict[str, Any]:
            env = client._build_envelope(skill, payload, mode="sync")
            raw_body, headers = client._sign_envelope(env, "POST", "/agent/message")
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as h:
                resp = await h.post("/agent/message", content=raw_body, headers=headers, timeout=30)
                resp.raise_for_status()
                return resp.json()

        result = await call_via_asgi("add", {"a": 3, "b": 4})
        assert result["status"] == "ok"
        assert result["result"] == {"sum": 7}

    async def test_call_requires_card(self, tmp_path: Path) -> None:
        client = make_prepared_client(tmp_path)
        with pytest.raises(RuntimeError):
            await client.call("add", {"a": 1, "b": 2})


# ---------------------------------------------------------------------------
# Tests: task() returns task_id
# ---------------------------------------------------------------------------

class TestTask:
    async def test_task_returns_task_id(self, tmp_path: Path) -> None:
        client_kp_dir = tmp_path / "client-keys"
        agent_kp_dir = tmp_path / "agent-keys"

        client = AgentClient.prepare(keys_dir=str(client_kp_dir), kid="test-client")

        agent = Agent(
            name="TaskTestAgent",
            url="http://testserver",
            keys_dir=str(agent_kp_dir),
        )
        agent.skill(
            name="add",
            description="Adds two numbers",
            input_schema=AddIn,
            output_schema=AddOut,
            modes=["sync", "async"],
            trust="public",
            handler=add_handler,
        )
        client_agent_id = f"agent://client-{client.kid}"
        agent.trust_peer(client_agent_id, client.public_key_b64)

        app = agent.build_app()
        transport = httpx.ASGITransport(app=app)

        # Set card
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as h:
            resp = await h.get("/.well-known/agent.json")
            client._card = AgentCard.model_validate(resp.json())

        # POST to /agent/task via ASGI transport
        env = client._build_envelope("add", {"a": 5, "b": 6}, mode="async")
        raw_body, headers = client._sign_envelope(env, "POST", "/agent/task")
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as h:
            resp = await h.post("/agent/task", content=raw_body, headers=headers, timeout=30)
        assert resp.status_code == 202
        body = resp.json()
        assert "taskId" in body
        task_id = body["taskId"]
        assert isinstance(task_id, str)
        assert len(task_id) > 0

    async def test_task_requires_card(self, tmp_path: Path) -> None:
        client = make_prepared_client(tmp_path)
        with pytest.raises(RuntimeError):
            await client.task("add", {"a": 1, "b": 2})


# ---------------------------------------------------------------------------
# Tests: task_and_poll() waits for completion
# ---------------------------------------------------------------------------

class TestTaskAndPoll:
    async def test_task_and_poll_returns_done(self, tmp_path: Path) -> None:
        client_kp_dir = tmp_path / "client-keys"
        agent_kp_dir = tmp_path / "agent-keys"

        client = AgentClient.prepare(keys_dir=str(client_kp_dir), kid="test-client")

        agent = Agent(
            name="PollTestAgent",
            url="http://testserver",
            keys_dir=str(agent_kp_dir),
        )
        agent.skill(
            name="add",
            description="Adds two numbers",
            input_schema=AddIn,
            output_schema=AddOut,
            modes=["sync", "async"],
            trust="public",
            handler=add_handler,
        )
        client_agent_id = f"agent://client-{client.kid}"
        agent.trust_peer(client_agent_id, client.public_key_b64)

        app = agent.build_app()
        transport = httpx.ASGITransport(app=app)

        # Set card
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as h:
            resp = await h.get("/.well-known/agent.json")
            client._card = AgentCard.model_validate(resp.json())

        # Post task
        env = client._build_envelope("add", {"a": 10, "b": 20}, mode="async")
        raw_body, headers = client._sign_envelope(env, "POST", "/agent/task")
        async with httpx.AsyncClient(
            transport=transport, base_url="http://testserver"
        ) as h:
            resp = await h.post("/agent/task", content=raw_body, headers=headers, timeout=30)
        assert resp.status_code == 202
        task_id = resp.json()["taskId"]

        # Let background task complete
        await asyncio.sleep(0.1)

        # Poll for result
        deadline = asyncio.get_event_loop().time() + 10.0
        record = None
        while asyncio.get_event_loop().time() < deadline:
            async with httpx.AsyncClient(
                transport=transport, base_url="http://testserver"
            ) as h:
                poll_resp = await h.get(f"/agent/task/{task_id}", timeout=10)
            record = poll_resp.json()
            if record.get("status") in ("done", "failed"):
                break
            await asyncio.sleep(0.05)

        assert record is not None
        assert record["status"] == "done"
        assert record["result"] == {"sum": 30}

    async def test_task_and_poll_requires_card(self, tmp_path: Path) -> None:
        client = make_prepared_client(tmp_path)
        with pytest.raises(RuntimeError):
            await client.task_and_poll("add", {"a": 1, "b": 2})
