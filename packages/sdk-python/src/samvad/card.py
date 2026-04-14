# SPDX-License-Identifier: Apache-2.0
from .types import AgentCard, AgentCardAuth, AgentCardEndpoints, AgentCardModel, PublicKey, RateLimit, SkillDef


def build_agent_card(
    *,
    agent_id: str,
    name: str,
    version: str,
    description: str,
    url: str,
    specializations: list[str],
    models: list[dict],
    skills: list[SkillDef],
    public_keys: list[PublicKey],
    rate_limit: RateLimit,
    card_ttl: int = 300,
) -> AgentCard:
    base = url.rstrip("/")
    return AgentCard(
        id=agent_id,
        name=name,
        version=version,
        description=description,
        url=url,
        protocolVersion="1.2",
        specializations=specializations,
        models=[AgentCardModel(**m) if isinstance(m, dict) else m for m in models],
        skills=skills,
        publicKeys=public_keys,
        auth=AgentCardAuth(schemes=["ed25519-rfc9421"]),
        rateLimit=rate_limit,
        cardTTL=card_ttl,
        endpoints=AgentCardEndpoints(
            intro=f"{base}/agent/intro",
            message=f"{base}/agent/message",
            task=f"{base}/agent/task",
            taskStatus=f"{base}/agent/task/{{taskId}}",
            stream=f"{base}/agent/stream",
            health=f"{base}/agent/health",
        ),
    )
