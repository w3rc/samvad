# samvad — Python SDK

Python SDK for the [SAMVAD protocol](https://github.com/rupayan-samanta/samvad) (v1.2) — RFC 9421 HTTP signatures, Ed25519 keys, Pydantic v2, async-first.

## Install

```bash
pip install samvad
```

## Quick start

```python
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
        name="my-agent",
        description="My first SAMVAD agent",
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

# ASGI app (use with uvicorn, Starlette, etc.)
app = agent.build_app()

# Or run directly:
if __name__ == "__main__":
    asyncio.run(agent.serve(host="0.0.0.0", port=3003))
```

```bash
uvicorn main:app --port 3003
curl http://localhost:3003/.well-known/agent.json | jq .
```

## Calling another agent

```python
from samvad import AgentClient

async def main():
    client = await AgentClient.from_url("http://localhost:3002")
    result = await client.call("echo", {"text": "hello"})
    print(result)  # {"echoed": "hello"}
```

## Requirements

- Python 3.10+
- Dependencies: `cryptography`, `pydantic>=2.5`, `httpx`, `starlette`, `sse-starlette`, `pyjwt[crypto]`

## Links

- [Protocol spec](../../spec/protocol-v1.2.md)
- [Example agent](../../examples/basic-agent-py/)
- [TypeScript SDK](../sdk-typescript/)
