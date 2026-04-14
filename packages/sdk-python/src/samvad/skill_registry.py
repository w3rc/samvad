# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from .errors import ErrorCode, SamvadError
from .types import CommunicationMode, SkillContext, SkillDef, TrustTier

Handler = Callable[[BaseModel, SkillContext], Awaitable[BaseModel]]


@dataclass
class RegisteredSkill:
    definition: SkillDef
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    handler: Handler


class SkillRegistry:
    def __init__(self) -> None:
        self._skills: dict[str, RegisteredSkill] = {}

    def register(
        self,
        *,
        name: str,
        description: str,
        input_schema: type[BaseModel],
        output_schema: type[BaseModel],
        modes: list[CommunicationMode],
        trust: TrustTier,
        handler: Handler,
        allowed_peers: list[str] | None = None,
    ) -> None:
        definition = SkillDef(
            id=name,
            name=name,
            description=description,
            inputSchema=input_schema.model_json_schema(),
            outputSchema=output_schema.model_json_schema(),
            modes=list(modes),
            trust=trust,
            allowedPeers=allowed_peers,
        )
        self._skills[name] = RegisteredSkill(
            definition=definition,
            input_model=input_schema,
            output_model=output_schema,
            handler=handler,
        )

    def get(self, name: str) -> RegisteredSkill | None:
        return self._skills.get(name)

    def to_skill_defs(self) -> list[SkillDef]:
        return [s.definition for s in self._skills.values()]

    async def dispatch(
        self, name: str, payload: dict[str, Any], ctx: SkillContext
    ) -> dict[str, Any]:
        skill = self._skills.get(name)
        if skill is None:
            raise SamvadError(ErrorCode.SKILL_NOT_FOUND, f"skill '{name}' not found")
        try:
            parsed = skill.input_model.model_validate(payload, strict=True)
        except ValidationError as e:
            raise SamvadError(ErrorCode.SCHEMA_INVALID, str(e)) from e
        result = await skill.handler(parsed, ctx)
        return result.model_dump(by_alias=True, exclude_none=True)
