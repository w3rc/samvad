# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .errors import ErrorCode, SamvadError
from .keys import Keypair
from .nonce_store import NonceStore
from .rate_limiter import RateLimiter
from .signing import content_digest
from .skill_registry import SkillRegistry
from .stream import sse_response
from .task_store import TaskStore
from .types import AgentCard, InjectionClassifier, SkillContext
from .verify_middleware import create_verify_middleware

logger = logging.getLogger(__name__)


@dataclass
class ServerConfig:
    card: AgentCard
    registry: SkillRegistry
    known_peers: dict[str, str]        # sender URI → public key b64
    nonce_store: NonceStore
    rate_limiter: RateLimiter
    task_store: TaskStore
    sign_keypair: Keypair              # server's own signing keypair
    injection_classifier: InjectionClassifier | None = None


def status_code_for(code: str) -> int:
    mapping = {
        "RATE_LIMITED": 429,
        "TOKEN_BUDGET_EXCEEDED": 429,
        "SKILL_NOT_FOUND": 404,
        "AUTH_FAILED": 401,
        "REPLAY_DETECTED": 401,
        "SCHEMA_INVALID": 400,
        "INJECTION_DETECTED": 400,
        "DELEGATION_EXCEEDED": 400,
        "AGENT_UNAVAILABLE": 503,
    }
    return mapping.get(code, 500)


def _verify_body_digest(headers: dict[str, str], raw_body: bytes) -> bool:
    """Check that the content-digest header matches the actual body."""
    lower = {k.lower(): v for k, v in headers.items()}
    declared = lower.get("content-digest")
    if not declared:
        return False  # no digest header — fail
    expected = content_digest(raw_body)
    return declared == expected


def _is_private_host(hostname: str) -> bool:
    """Return True for hostnames/IPs that should never receive outbound webhook calls."""
    h = hostname.lower().strip("[]")  # strip IPv6 brackets
    if h in ("localhost",) or h.endswith(".local") or h.endswith(".internal"):
        return True
    try:
        addr = ipaddress.ip_address(h)
        return (
            addr.is_loopback
            or addr.is_private
            or addr.is_link_local
        )
    except ValueError:
        return False


async def _run_task(
    task_id: str,
    envelope_dict: dict[str, Any],
    span_id: str,
    registry: SkillRegistry,
    task_store: TaskStore,
    callback_url: str | None,
) -> None:
    """Background coroutine: dispatch skill, update task record, optionally POST to callback."""
    from .types import MessageEnvelope
    envelope = MessageEnvelope.model_validate(envelope_dict)

    task_store.set_running(task_id, 0)
    ctx = SkillContext(
        sender=envelope.from_,
        trace_id=envelope.trace_id,
        span_id=span_id,
        delegation_token=envelope.delegation_token,
    )
    try:
        result = await registry.dispatch(envelope.skill, envelope.payload, ctx)
        task_store.set_done(task_id, result)
        if callback_url:
            response_payload = {
                "traceId": envelope.trace_id,
                "spanId": span_id,
                "status": "ok",
                "result": result,
            }
            try:
                async with httpx.AsyncClient() as client:
                    await client.post(
                        callback_url,
                        json=response_payload,
                        headers={"Content-Type": "application/json"},
                        timeout=10.0,
                    )
            except Exception:
                # Caller can poll /agent/task/:taskId as fallback
                pass
    except SamvadError as e:
        task_store.set_failed(task_id, e.to_dict())
    except Exception as e:
        task_store.set_failed(task_id, {
            "code": ErrorCode.AGENT_UNAVAILABLE.value,
            "message": str(e),
        })


def build_app(config: ServerConfig) -> Starlette:
    verify = create_verify_middleware(
        registry=config.registry,
        known_peers=config.known_peers,
        nonce_store=config.nonce_store,
        rate_limiter=config.rate_limiter,
        injection_classifier=config.injection_classifier,
    )

    async def agent_card(request: Request) -> Response:
        return JSONResponse(
            config.card.model_dump(by_alias=True, exclude_none=True),
            headers={"Cache-Control": f"public, max-age={config.card.card_ttl}"},
        )

    async def health(request: Request) -> Response:
        return JSONResponse({"status": "ok"})

    async def intro(request: Request) -> Response:
        return JSONResponse({
            "protocol": "samvad",
            "version": "1.2",
            "agent": config.card.id,
            "capabilities": ["sync", "async", "stream"],
        })

    async def agent_message(request: Request) -> Response:
        raw_body = await request.body()
        headers = dict(request.headers)
        span_id = str(uuid.uuid4())

        if not _verify_body_digest(headers, raw_body):
            return JSONResponse(
                {"traceId": "", "spanId": span_id, "status": "error",
                 "error": {"code": ErrorCode.AUTH_FAILED.value, "message": "Content-Digest mismatch"}},
                status_code=401,
            )

        result = await verify("POST", "/agent/message", headers, raw_body)
        if not result.ok:
            err = result.error
            return JSONResponse(
                {"traceId": "", "spanId": span_id, "status": "error", "error": err.to_dict()},
                status_code=status_code_for(err.code),
            )

        envelope = result.envelope
        ctx = SkillContext(
            sender=envelope.from_,
            trace_id=envelope.trace_id,
            span_id=span_id,
            delegation_token=envelope.delegation_token,
        )
        try:
            output = await config.registry.dispatch(envelope.skill, envelope.payload, ctx)
            return JSONResponse({
                "traceId": envelope.trace_id,
                "spanId": span_id,
                "status": "ok",
                "result": output,
            })
        except SamvadError as e:
            return JSONResponse(
                {"traceId": envelope.trace_id, "spanId": span_id, "status": "error", "error": e.to_dict()},
                status_code=status_code_for(e.code),
            )
        except Exception as e:
            return JSONResponse(
                {
                    "traceId": envelope.trace_id,
                    "spanId": span_id,
                    "status": "error",
                    "error": {"code": ErrorCode.AGENT_UNAVAILABLE.value, "message": str(e)},
                },
                status_code=503,
            )

    async def agent_task(request: Request) -> Response:
        raw_body = await request.body()
        headers = dict(request.headers)
        span_id = str(uuid.uuid4())

        if not _verify_body_digest(headers, raw_body):
            return JSONResponse(
                {"traceId": "", "spanId": span_id, "status": "error",
                 "error": {"code": ErrorCode.AUTH_FAILED.value, "message": "Content-Digest mismatch"}},
                status_code=401,
            )

        # Parse body to extract callbackUrl before verification
        try:
            body_dict: dict[str, Any] = json.loads(raw_body)
        except Exception:
            return JSONResponse(
                {"traceId": "", "spanId": span_id, "status": "error",
                 "error": {"code": ErrorCode.SCHEMA_INVALID.value, "message": "invalid JSON body"}},
                status_code=400,
            )

        callback_url: str | None = body_dict.get("callbackUrl")

        # Validate callbackUrl before doing any work — prevents SSRF via internal URLs
        if callback_url is not None:
            try:
                from urllib.parse import urlparse
                parsed = urlparse(callback_url)
                if not parsed.scheme or not parsed.netloc:
                    raise ValueError("not a valid URL")
            except Exception:
                return JSONResponse(
                    {"traceId": "", "spanId": span_id, "status": "error",
                     "error": {"code": ErrorCode.SCHEMA_INVALID.value, "message": "callbackUrl is not a valid URL"}},
                    status_code=400,
                )
            if parsed.scheme != "https":
                return JSONResponse(
                    {"traceId": "", "spanId": span_id, "status": "error",
                     "error": {"code": ErrorCode.SCHEMA_INVALID.value, "message": "callbackUrl must use https"}},
                    status_code=400,
                )
            if _is_private_host(parsed.hostname or ""):
                return JSONResponse(
                    {"traceId": "", "spanId": span_id, "status": "error",
                     "error": {"code": ErrorCode.SCHEMA_INVALID.value,
                               "message": "callbackUrl must not target a private or loopback address"}},
                    status_code=400,
                )

        result = await verify("POST", "/agent/task", headers, raw_body)
        if not result.ok:
            err = result.error
            return JSONResponse(
                {"traceId": "", "spanId": span_id, "status": "error", "error": err.to_dict()},
                status_code=status_code_for(err.code),
            )

        task = config.task_store.create_task()

        # Dispatch background task — response returns 202 before handler runs
        asyncio.create_task(_run_task(
            task.task_id,
            body_dict,
            span_id,
            config.registry,
            config.task_store,
            callback_url,
        ))

        return JSONResponse({"taskId": task.task_id, "status": "accepted"}, status_code=202)

    async def agent_task_status(request: Request) -> Response:
        task_id = request.path_params["task_id"]
        task = config.task_store.get_task(task_id)
        if task is None:
            return JSONResponse({"error": "Task not found"}, status_code=404)
        return JSONResponse(task.model_dump(by_alias=True, exclude_none=True))

    async def agent_stream(request: Request) -> Response:
        raw_body = await request.body()
        headers = dict(request.headers)
        span_id = str(uuid.uuid4())

        result = await verify("POST", "/agent/stream", headers, raw_body)
        if not result.ok:
            err = result.error
            return JSONResponse(
                {"traceId": "", "spanId": span_id, "status": "error", "error": err.to_dict()},
                status_code=status_code_for(err.code),
            )

        envelope = result.envelope
        ctx = SkillContext(
            sender=envelope.from_,
            trace_id=envelope.trace_id,
            span_id=span_id,
            delegation_token=envelope.delegation_token,
        )

        async def event_generator():
            try:
                output = await config.registry.dispatch(envelope.skill, envelope.payload, ctx)
                yield {"done": True, "result": output, "traceId": envelope.trace_id, "spanId": span_id}
            except SamvadError as e:
                yield {"done": True, "error": e.to_dict(), "traceId": envelope.trace_id, "spanId": span_id}
            except Exception as e:
                yield {
                    "done": True,
                    "error": {"code": ErrorCode.AGENT_UNAVAILABLE.value, "message": str(e)},
                    "traceId": envelope.trace_id,
                    "spanId": span_id,
                }

        return sse_response(event_generator(), ping_seconds=15)

    routes = [
        Route("/.well-known/agent.json", agent_card, methods=["GET"]),
        Route("/agent/health", health, methods=["GET"]),
        Route("/agent/intro", intro, methods=["GET"]),
        Route("/agent/message", agent_message, methods=["POST"]),
        Route("/agent/task", agent_task, methods=["POST"]),
        Route("/agent/task/{task_id}", agent_task_status, methods=["GET"]),
        Route("/agent/stream", agent_stream, methods=["POST"]),
    ]

    return Starlette(routes=routes)
