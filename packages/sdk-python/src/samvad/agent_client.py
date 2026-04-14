# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import asyncio
import json
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator

import httpx

from .keys import Keypair, load_or_generate_keypair
from .signing import canonical_json, content_digest, sign_request
from .types import AgentCard, MessageEnvelope


class AgentClient:
    def __init__(self, *, keypair: Keypair, card: AgentCard | None = None) -> None:
        self._kp = keypair
        self._card = card

    @classmethod
    def prepare(
        cls,
        *,
        keys_dir: str = ".samvad/client-keys/",
        kid: str = "client",
    ) -> "AgentClient":
        kp = load_or_generate_keypair(Path(keys_dir), kid)
        return cls(keypair=kp)

    @classmethod
    async def from_url(
        cls,
        url: str,
        *,
        keys_dir: str = ".samvad/client-keys/",
        kid: str = "client",
    ) -> "AgentClient":
        client = cls.prepare(keys_dir=keys_dir, kid=kid)
        await client.connect(url)
        return client

    async def connect(self, url: str) -> None:
        card_url = url.rstrip("/") + "/.well-known/agent.json"
        async with httpx.AsyncClient() as h:
            resp = await h.get(card_url, timeout=10)
            resp.raise_for_status()
            self._card = AgentCard.model_validate(resp.json())

    @property
    def public_key_b64(self) -> str:
        return self._kp.public_key_b64

    @property
    def kid(self) -> str:
        return self._kp.kid

    def _build_envelope(
        self,
        skill: str,
        payload: dict[str, Any],
        mode: str = "sync",
        callback_url: str | None = None,
    ) -> dict[str, Any]:
        agent_id = f"agent://client-{self._kp.kid}"
        target_id = self._card.id if self._card else "agent://unknown"
        env: dict[str, Any] = {
            "from": agent_id,
            "to": target_id,
            "skill": skill,
            "mode": mode,
            "nonce": str(uuid.uuid4()),
            "timestamp": _iso_now(),
            "traceId": str(uuid.uuid4()),
            "spanId": str(uuid.uuid4()),
            "payload": payload,
        }
        if callback_url:
            env["callbackUrl"] = callback_url
        return env

    def _sign_envelope(
        self, envelope: dict[str, Any], method: str, path: str
    ) -> tuple[bytes, dict[str, str]]:
        raw_body = canonical_json(envelope).encode("utf-8")
        digest = content_digest(raw_body)
        base_headers = {
            "content-type": "application/json",
            "content-digest": digest,
        }
        sig = sign_request(method, path, base_headers, self._kp.private_key_b64, self._kp.kid)
        return raw_body, {**base_headers, **sig}

    async def call(self, skill: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self._card is None:
            raise RuntimeError("call connect() or from_url() first")
        base_url = self._card.url.rstrip("/")
        env = self._build_envelope(skill, payload, mode="sync")
        raw_body, headers = self._sign_envelope(env, "POST", "/agent/message")
        async with httpx.AsyncClient() as h:
            resp = await h.post(
                f"{base_url}/agent/message",
                content=raw_body,
                headers=headers,
                timeout=30,
            )
            resp.raise_for_status()
            return resp.json()

    async def task(
        self, skill: str, payload: dict[str, Any], *, callback_url: str | None = None
    ) -> str:
        if self._card is None:
            raise RuntimeError("call connect() or from_url() first")
        base_url = self._card.url.rstrip("/")
        env = self._build_envelope(skill, payload, mode="async", callback_url=callback_url)
        raw_body, headers = self._sign_envelope(env, "POST", "/agent/task")
        async with httpx.AsyncClient() as h:
            resp = await h.post(f"{base_url}/agent/task", content=raw_body, headers=headers, timeout=30)
            resp.raise_for_status()
            return resp.json()["taskId"]

    async def task_and_poll(
        self,
        skill: str,
        payload: dict[str, Any],
        *,
        interval: float = 0.5,
        timeout: float = 60.0,
    ) -> dict[str, Any]:
        if self._card is None:
            raise RuntimeError("call connect() or from_url() first")
        task_id = await self.task(skill, payload)
        base_url = self._card.url.rstrip("/")
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            await asyncio.sleep(interval)
            async with httpx.AsyncClient() as h:
                resp = await h.get(f"{base_url}/agent/task/{task_id}", timeout=10)
                resp.raise_for_status()
                record = resp.json()
                if record.get("status") in ("done", "failed"):
                    return record
        raise TimeoutError(f"task {task_id} did not complete within {timeout}s")

    async def stream(
        self, skill: str, payload: dict[str, Any]
    ) -> AsyncIterator[dict[str, Any]]:
        if self._card is None:
            raise RuntimeError("call connect() or from_url() first")
        base_url = self._card.url.rstrip("/")
        env = self._build_envelope(skill, payload, mode="stream")
        raw_body, headers = self._sign_envelope(env, "POST", "/agent/stream")
        async with httpx.AsyncClient() as h:
            async with h.stream("POST", f"{base_url}/agent/stream",
                                content=raw_body, headers=headers, timeout=60) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        yield json.loads(line[6:])


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
