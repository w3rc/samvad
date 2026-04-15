# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from .card import build_agent_card
from .keys import Keypair, load_or_generate_keypair
from .nonce_store import InMemoryNonceStore, NonceStore
from .rate_limiter import RateLimiter
from .server import ServerConfig, build_app
from .skill_registry import SkillRegistry
from .types import (
    AgentCard,
    CommunicationMode,
    InjectionClassifier,
    PublicKey,
    RateLimit,
    SkillContext,
    TrustTier,
)


class Agent:
    def __init__(
        self,
        *,
        name: str,
        description: str = "",
        url: str,
        version: str = "1.0.0",
        specializations: list[str] | None = None,
        models: list[dict[str, Any]] | None = None,
        keys_dir: str = ".samvad/keys/",
        rate_limit: RateLimit | None = None,
        injection_classifier: InjectionClassifier | None = None,
        card_ttl: int = 300,
        nonce_store: NonceStore | None = None,
    ) -> None:
        self._name = name
        self._description = description
        self._url = url
        self._version = version
        self._specializations = specializations or []
        self._models = models or []
        self._keys_dir = Path(keys_dir)
        self._rate_limit = rate_limit or RateLimit(requestsPerMinute=60, requestsPerSender=20)
        self._injection_classifier = injection_classifier
        self._card_ttl = card_ttl
        self._nonce_store = nonce_store
        self._registry = SkillRegistry()
        self._known_peers: dict[str, str] = {}  # agent:// URI → public key b64
        self._keypair: Keypair | None = None

    def skill(
        self,
        *,
        name: str,
        description: str,
        input_schema: type[BaseModel],
        output_schema: type[BaseModel],
        modes: list[CommunicationMode],
        trust: TrustTier,
        handler: Callable[[BaseModel, SkillContext], Awaitable[BaseModel]],
        allowed_peers: list[str] | None = None,
    ) -> Agent:
        self._registry.register(
            name=name,
            description=description,
            input_schema=input_schema,
            output_schema=output_schema,
            modes=modes,
            trust=trust,
            handler=handler,
            allowed_peers=allowed_peers,
        )
        return self

    def trust_peer(self, agent_id: str, public_key_b64: str) -> Agent:
        self._known_peers[agent_id] = public_key_b64
        return self

    def _ensure_keypair(self) -> Keypair:
        if self._keypair is None:
            self._keypair = load_or_generate_keypair(self._keys_dir, "agent")
        return self._keypair

    def build_card(self) -> AgentCard:
        kp = self._ensure_keypair()
        pub_key = PublicKey(kid=kp.kid, key=kp.public_key_b64, active=True)
        return build_agent_card(
            name=self._name,
            version=self._version,
            description=self._description,
            url=self._url,
            specializations=self._specializations,
            models=self._models,
            skills=self._registry.to_skill_defs(),
            public_keys=[pub_key],
            rate_limit=self._rate_limit,
            card_ttl=self._card_ttl,
        )

    def build_app(self) -> Any:  # returns Starlette
        from .task_store import TaskStore
        kp = self._ensure_keypair()
        card = self.build_card()
        config = ServerConfig(
            card=card,
            registry=self._registry,
            known_peers=self._known_peers,
            nonce_store=self._nonce_store or InMemoryNonceStore(),
            rate_limiter=RateLimiter(
                requests_per_minute=self._rate_limit.requests_per_minute,
                requests_per_sender=self._rate_limit.requests_per_sender,
                tokens_per_sender_per_day=self._rate_limit.tokens_per_sender_per_day,
            ),
            task_store=TaskStore(),
            sign_keypair=kp,
            injection_classifier=self._injection_classifier,
        )
        return build_app(config)

    async def serve(self, *, host: str = "0.0.0.0", port: int = 3002) -> None:
        import uvicorn
        app = self.build_app()
        server = uvicorn.Server(uvicorn.Config(app, host=host, port=port, log_level="info"))
        await server.serve()
