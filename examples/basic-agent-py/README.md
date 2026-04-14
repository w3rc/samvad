# basic-agent-py

Minimal Python agent demonstrating the SAMVAD SDK. It exposes a single `echo` skill that returns the input text unchanged. The agent runs on Starlette (no FastAPI dependency) and uses Ed25519 signing for all protocol messages.

## Setup

```bash
cd examples/basic-agent-py
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]" uvicorn
python main.py
```

The agent starts on port 3003.

## Verify the agent card

```bash
curl http://localhost:3003/.well-known/agent.json | jq .
```

## Calling the agent

The agent uses RFC 9421 HTTP signatures, so direct curl won't work for `/agent/message`. Use the TypeScript client instead:

```bash
cd examples/basic-agent-ts && npm start
# Then in another terminal, the TS agent calls the Python agent via AgentClient.
```

For direct testing without the TS client, see the integration tests in `packages/sdk-python/tests/test_integration.py`.
