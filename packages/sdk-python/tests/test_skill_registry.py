# SPDX-License-Identifier: Apache-2.0
import pytest
from pydantic import BaseModel

from samvad.skill_registry import SkillRegistry
from samvad.errors import ErrorCode, SamvadError
from samvad.types import SkillContext


class GreetInput(BaseModel):
    name: str


class GreetOutput(BaseModel):
    message: str


async def greet_handler(inp: GreetInput, ctx: SkillContext) -> GreetOutput:
    return GreetOutput(message=f"Hello, {inp.name}!")


def make_ctx() -> SkillContext:
    return SkillContext(sender="agent://a.com", trace_id="t", span_id="s")


def test_register_and_get_defs():
    registry = SkillRegistry()
    registry.register(
        name="greet",
        description="Greets someone",
        input_schema=GreetInput,
        output_schema=GreetOutput,
        modes=["sync"],
        trust="public",
        handler=greet_handler,
    )
    defs = registry.to_skill_defs()
    assert len(defs) == 1
    assert defs[0].id == "greet"


@pytest.mark.asyncio
async def test_dispatch_valid_call():
    registry = SkillRegistry()
    registry.register(
        name="greet",
        description="Greets someone",
        input_schema=GreetInput,
        output_schema=GreetOutput,
        modes=["sync"],
        trust="public",
        handler=greet_handler,
    )
    result = await registry.dispatch("greet", {"name": "World"}, make_ctx())
    assert result == {"message": "Hello, World!"}


@pytest.mark.asyncio
async def test_dispatch_unknown_skill_raises_skill_not_found():
    registry = SkillRegistry()
    with pytest.raises(SamvadError) as exc_info:
        await registry.dispatch("unknown", {}, make_ctx())
    assert exc_info.value.code == ErrorCode.SKILL_NOT_FOUND.value


@pytest.mark.asyncio
async def test_dispatch_invalid_schema_raises_schema_invalid():
    registry = SkillRegistry()
    registry.register(
        name="greet",
        description="Greets someone",
        input_schema=GreetInput,
        output_schema=GreetOutput,
        modes=["sync"],
        trust="public",
        handler=greet_handler,
    )
    with pytest.raises(SamvadError) as exc_info:
        await registry.dispatch("greet", {"name": 123}, make_ctx())
    assert exc_info.value.code == ErrorCode.SCHEMA_INVALID.value


def test_to_skill_defs_includes_input_schema():
    registry = SkillRegistry()
    registry.register(
        name="greet",
        description="Greets someone",
        input_schema=GreetInput,
        output_schema=GreetOutput,
        modes=["sync"],
        trust="public",
        handler=greet_handler,
    )
    defs = registry.to_skill_defs()
    assert "properties" in defs[0].input_schema
    assert "name" in defs[0].input_schema["properties"]


@pytest.mark.asyncio
async def test_schema_invalid_on_type_coercion():
    """Pydantic strict=True must reject int for str field (no silent coercion)."""
    reg = SkillRegistry()

    class StrictIn(BaseModel):
        text: str

    class StrictOut(BaseModel):
        result: str

    async def h(p: StrictIn, c: SkillContext) -> StrictOut:
        return StrictOut(result=p.text)

    reg.register(name="strict-skill", description="", input_schema=StrictIn,
                 output_schema=StrictOut, modes=["sync"], trust="public", handler=h)

    with pytest.raises(SamvadError) as exc:
        await reg.dispatch(
            "strict-skill",
            {"text": 123},  # int, not str — must be rejected
            SkillContext(sender="x", trace_id="t", span_id="s"),
        )
    assert exc.value.code == "SCHEMA_INVALID"


def test_get_registered_skill():
    registry = SkillRegistry()
    registry.register(
        name="greet",
        description="Greets someone",
        input_schema=GreetInput,
        output_schema=GreetOutput,
        modes=["sync"],
        trust="public",
        handler=greet_handler,
    )
    skill = registry.get("greet")
    assert skill is not None
    assert skill.definition.id == "greet"
    assert registry.get("nonexistent") is None
