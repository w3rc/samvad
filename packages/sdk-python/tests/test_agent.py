# SPDX-License-Identifier: Apache-2.0
"""Tests for Agent fluent API (agent.py)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel
from starlette.applications import Starlette

from samvad.agent import Agent
from samvad.types import RateLimit, SkillContext


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
# Tests
# ---------------------------------------------------------------------------

class TestAgentFluentAPI:
    def test_skill_returns_self(self, tmp_path: Path) -> None:
        agent = Agent(
            name="Test",
            url="http://localhost:3002",
            keys_dir=str(tmp_path / "keys"),
        )
        result = agent.skill(
            name="add",
            description="Adds two numbers",
            input_schema=AddIn,
            output_schema=AddOut,
            modes=["sync"],
            trust="public",
            handler=add_handler,
        )
        assert result is agent

    def test_trust_peer_returns_self(self, tmp_path: Path) -> None:
        agent = Agent(
            name="Test",
            url="http://localhost:3002",
            keys_dir=str(tmp_path / "keys"),
        )
        result = agent.trust_peer("agent://peer.example", "deadbeef==")
        assert result is agent

    def test_trust_peer_adds_to_known_peers(self, tmp_path: Path) -> None:
        agent = Agent(
            name="Test",
            url="http://localhost:3002",
            keys_dir=str(tmp_path / "keys"),
        )
        agent.trust_peer("agent://peer.example", "deadbeef==")
        assert agent._known_peers["agent://peer.example"] == "deadbeef=="

    def test_fluent_chain(self, tmp_path: Path) -> None:
        agent = (
            Agent(
                name="ChainTest",
                url="http://localhost:3002",
                keys_dir=str(tmp_path / "keys"),
            )
            .skill(
                name="add",
                description="Adds two numbers",
                input_schema=AddIn,
                output_schema=AddOut,
                modes=["sync"],
                trust="public",
                handler=add_handler,
            )
            .trust_peer("agent://peer.example", "somekey==")
        )
        assert isinstance(agent, Agent)

    def test_build_card_includes_skill_name(self, tmp_path: Path) -> None:
        agent = Agent(
            name="CardTest",
            url="http://localhost:3002",
            keys_dir=str(tmp_path / "keys"),
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
        card = agent.build_card()
        skill_names = [s.name for s in card.skills]
        assert "add" in skill_names

    def test_build_card_sets_agent_name(self, tmp_path: Path) -> None:
        agent = Agent(
            name="MyAgent",
            url="http://localhost:3002",
            keys_dir=str(tmp_path / "keys"),
        )
        card = agent.build_card()
        assert card.name == "MyAgent"

    def test_build_app_returns_starlette(self, tmp_path: Path) -> None:
        agent = Agent(
            name="AppTest",
            url="http://localhost:3002",
            keys_dir=str(tmp_path / "keys"),
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
        app = agent.build_app()
        assert isinstance(app, Starlette)

    def test_build_card_uses_custom_rate_limit(self, tmp_path: Path) -> None:
        rl = RateLimit(requestsPerMinute=10, requestsPerSender=5)
        agent = Agent(
            name="RLTest",
            url="http://localhost:3002",
            keys_dir=str(tmp_path / "keys"),
            rate_limit=rl,
        )
        card = agent.build_card()
        assert card.rate_limit.requests_per_minute == 10
        assert card.rate_limit.requests_per_sender == 5

    def test_keypair_is_stable_across_calls(self, tmp_path: Path) -> None:
        """_ensure_keypair() should return the same instance on repeated calls."""
        agent = Agent(
            name="StableKey",
            url="http://localhost:3002",
            keys_dir=str(tmp_path / "keys"),
        )
        kp1 = agent._ensure_keypair()
        kp2 = agent._ensure_keypair()
        assert kp1 is kp2
