# SPDX-License-Identifier: Apache-2.0
import asyncio
from pydantic import BaseModel
from samvad import Agent, SkillContext


class EchoIn(BaseModel):
    text: str


class EchoOut(BaseModel):
    echoed: str


async def echo(p: EchoIn, ctx: SkillContext) -> EchoOut:
    return EchoOut(echoed=p.text)


agent = (
    Agent(
        name="basic-agent-py",
        description="Minimal Python SAMVAD agent",
        url="http://localhost:3003",
        specializations=["demo"],
        models=[],
    )
    .skill(
        name="echo",
        description="Echoes input text",
        input_schema=EchoIn,
        output_schema=EchoOut,
        modes=["sync"],
        trust="public",
        handler=echo,
    )
)


app = agent.build_app()


if __name__ == "__main__":
    asyncio.run(agent.serve(host="0.0.0.0", port=3003))
