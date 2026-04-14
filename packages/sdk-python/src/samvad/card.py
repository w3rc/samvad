# SPDX-License-Identifier: Apache-2.0
from urllib.parse import urlparse

from .types import AgentCard, AgentCardAuth, AgentCardEndpoints, AgentCardModel, PublicKey, RateLimit, SkillDef


def build_agent_card(
    *,
    agent_id: str | None = None,
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
    if not agent_id:
        domain = urlparse(url).hostname or "unknown"
        agent_id = f"agent://{domain}"

    has_authenticated_skill = any(s.trust == "authenticated" for s in skills)
    auth_schemes = ["bearer", "none"] if has_authenticated_skill else ["none"]
    auth = AgentCardAuth(schemes=auth_schemes)

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
        auth=auth,
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
