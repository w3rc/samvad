# SPDX-License-Identifier: Apache-2.0
from samvad.types import MessageEnvelope, AgentCard, SkillDef, PublicKey, RateLimit


def test_envelope_round_trip():
    env = MessageEnvelope(
        **{
            "from": "agent://alice.example",
            "to": "agent://bob.example",
            "skill": "echo",
            "mode": "sync",
            "nonce": "abc",
            "timestamp": "2026-04-14T00:00:00Z",
            "traceId": "t1",
            "spanId": "s1",
            "payload": {"text": "hi"},
        }
    )
    d = env.model_dump(by_alias=True, exclude_none=True)
    assert d["from"] == "agent://alice.example"
    assert d["traceId"] == "t1"


def test_skill_def_trust_tiers_validated():
    SkillDef(
        id="x", name="x", description="x",
        inputSchema={}, outputSchema={},
        modes=["sync"], trust="public",
    )
