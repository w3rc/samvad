# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from samvad.card import build_agent_card
from samvad.types import PublicKey, RateLimit, SkillDef


PUBLIC_KEYS = [PublicKey(kid="key-1", key="base64key", active=True)]
SKILLS = [
    SkillDef(
        id="greet",
        name="Greet",
        description="Greets someone",
        inputSchema={"type": "object", "properties": {"name": {"type": "string"}}},
        outputSchema={"type": "object", "properties": {"message": {"type": "string"}}},
        modes=["sync"],
        trust="public",
    )
]
RATE_LIMIT = RateLimit(requestsPerMinute=60, requestsPerSender=10)


def test_build_card_basic():
    card = build_agent_card(
        agent_id="agent://testagent.com",
        name="Test Agent",
        version="1.0.0",
        description="A test agent",
        url="https://testagent.com",
        specializations=["testing"],
        models=[{"provider": "anthropic", "model": "claude-opus-4-6"}],
        skills=SKILLS,
        public_keys=PUBLIC_KEYS,
        rate_limit=RATE_LIMIT,
        card_ttl=300,
    )
    assert card.id == "agent://testagent.com"
    assert card.protocol_version == "1.2"
    assert len(card.skills) == 1


def test_endpoints_auto_derived():
    card = build_agent_card(
        agent_id="agent://myagent.io",
        name="My Agent",
        version="0.1.0",
        description="desc",
        url="https://myagent.io",
        specializations=[],
        models=[],
        skills=[],
        public_keys=PUBLIC_KEYS,
        rate_limit=RATE_LIMIT,
    )
    assert card.endpoints.intro == "https://myagent.io/agent/intro"
    assert card.endpoints.message == "https://myagent.io/agent/message"
    assert card.endpoints.task == "https://myagent.io/agent/task"
    assert card.endpoints.task_status == "https://myagent.io/agent/task/{taskId}"
    assert card.endpoints.stream == "https://myagent.io/agent/stream"
    assert card.endpoints.health == "https://myagent.io/agent/health"


def test_protocol_version_is_1_2():
    card = build_agent_card(
        agent_id="agent://x.com",
        name="X",
        version="1.0.0",
        description="d",
        url="https://x.com",
        specializations=[],
        models=[],
        skills=[],
        public_keys=PUBLIC_KEYS,
        rate_limit=RATE_LIMIT,
    )
    assert card.protocol_version == "1.2"


def test_auth_scheme_set():
    card = build_agent_card(
        agent_id="agent://x.com",
        name="X",
        version="1.0.0",
        description="d",
        url="https://x.com",
        specializations=[],
        models=[],
        skills=[],
        public_keys=PUBLIC_KEYS,
        rate_limit=RATE_LIMIT,
    )
    assert "ed25519-rfc9421" in card.auth.schemes


def test_skills_passed_through():
    card = build_agent_card(
        agent_id="agent://x.com",
        name="X",
        version="1.0.0",
        description="d",
        url="https://x.com",
        specializations=[],
        models=[],
        skills=SKILLS,
        public_keys=PUBLIC_KEYS,
        rate_limit=RATE_LIMIT,
    )
    assert len(card.skills) == 1
    assert card.skills[0].id == "greet"


def test_rate_limit_included():
    card = build_agent_card(
        agent_id="agent://x.com",
        name="X",
        version="1.0.0",
        description="d",
        url="https://x.com",
        specializations=[],
        models=[],
        skills=[],
        public_keys=PUBLIC_KEYS,
        rate_limit=RATE_LIMIT,
    )
    assert card.rate_limit.requests_per_minute == 60
    assert card.rate_limit.requests_per_sender == 10


def test_trailing_slash_stripped_from_url():
    card = build_agent_card(
        agent_id="agent://x.com",
        name="X",
        version="1.0.0",
        description="d",
        url="https://x.com/",
        specializations=[],
        models=[],
        skills=[],
        public_keys=PUBLIC_KEYS,
        rate_limit=RATE_LIMIT,
    )
    assert card.endpoints.health == "https://x.com/agent/health"
