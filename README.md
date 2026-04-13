# SAMVAD

**The secure wire protocol for agent-to-agent communication.**

Every team building multi-agent systems today hand-rolls auth, message signing, replay protection, and rate limiting. SAMVAD makes the secure path the fast path — a working, signed, rate-limited agent in 15 lines of TypeScript.

[![npm](https://img.shields.io/npm/v/@samvad-protocol/sdk)](https://www.npmjs.com/package/@samvad-protocol/sdk)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)
[![Spec](https://img.shields.io/badge/spec-v1.2-green)](./spec/protocol-v1.2.md)
[![Docs](https://img.shields.io/badge/docs-mintlify-brightgreen)](https://docs.samvadprotocol.com)

---

## Try it now — no code required

Two live agents are running on the SAMVAD network. Open the registry, click an agent, hit **Try it**:

**[samvadprotocol.vercel.app/registry →](https://samvadprotocol.vercel.app/registry)**

- **Scout** — give it any URL, get back a clean summary
- **Claw** — routes to a live OpenClaw instance via signed envelopes

---

## 15 lines to a working agent

```bash
npm install @samvad-protocol/sdk zod
```

```typescript
import { Agent } from '@samvad-protocol/sdk'
import { z } from 'zod'

const agent = new Agent({
  name: 'Hello Agent',
  url: 'http://localhost:3002',
  specializations: ['greetings'],
})

agent.skill('greet', {
  name: 'Greet',
  description: 'Returns a personalised greeting',
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
  modes: ['sync'],
  trust: 'public',
  handler: async ({ name }) => ({ greeting: `Hello, ${name}!` }),
})

await agent.serve({ port: 3002 })
```

Run it. The SDK generates an Ed25519 keypair, publishes an agent card at `/.well-known/agent.json`, and starts serving seven standard endpoints — all signed, all rate-limited, all replay-protected. Zero security code from you.

Call it from anywhere:

```typescript
import { AgentClient } from '@samvad-protocol/sdk'

const client = await AgentClient.from('http://localhost:3002')
const result = await client.call('greet', { name: 'Ada' })
// { greeting: 'Hello, Ada!' }
```

---

## What you get for free on every agent

| Layer | What the SDK does |
|---|---|
| **Identity** | Ed25519 keypair generated on first run, published in agent card |
| **Signatures** | RFC 9421 HTTP Message Signatures on every envelope — Ed25519 + SHA-256 body digest |
| **Replay protection** | 5-minute nonce window, UUID nonce + timestamp on every message |
| **Rate limiting** | Per-sender sliding-window request limits + daily token budget, declared in the card |
| **Input validation** | Zod schemas converted to JSON Schema; unknown fields dropped; validated before handler runs |
| **Injection scanning** | Regex first-pass scanner — runs only *after* signature verification (never scans untrusted input before auth) |
| **Delegation** | EdDSA JWT tokens with scope + depth enforcement; depth decremented each hop, `DELEGATION_EXCEEDED` at zero |
| **Observability** | OpenTelemetry-compatible `traceId`/`spanId`/`parentSpanId` on every envelope |

None of these require any code from you. Registering a skill and calling `agent.serve()` is all it takes.

---

## See it live

*Two agents debating — each claim sent as a signed SAMVAD envelope, challenged in real time by a Red Team agent on a separate port.*

![SAMVAD debate demo — Research Assistant and Red Team Agent exchanging signed envelopes claim by claim](examples/debate-demo/demo.gif)

```bash
git clone https://github.com/w3rc/samvad
cd samvad/examples/debate-demo
npm install
npm run demo:live "AI will replace software engineers"
```

---

## How SAMVAD is different

SAMVAD is a wire protocol — not an orchestration framework, not an LLM wrapper, not a competitor to LangChain or CrewAI. It is the transport layer those tools sit on top of.

| | SAMVAD | MCP (Anthropic) | A2A (Google) |
|---|---|---|---|
| **Model** | Agent-to-agent, peer-to-peer | Client-server (LLM → tool) | Agent-to-agent |
| **Identity** | Your domain (DNS + TLS) | None | Central registry |
| **Auth** | Ed25519 + signed envelopes | None on the wire | Enterprise IAM |
| **Discovery** | `/.well-known/agent.json` | No standard | Central registry |
| **Setup** | 15 lines | N/A | Enterprise infrastructure |

MCP was designed for connecting LLMs to tools — not for agents calling other agents. Google's A2A assumes central infrastructure and enterprise identity. SAMVAD is peer-to-peer: your domain is your identity, and any agent that can host a JSON file can be on the network.

---

## Core concepts

### Your domain is your identity

```
agent://myagent.com  →  https://myagent.com
```

No accounts, no API keys, no platform sign-up. A TLS certificate and an Ed25519 key are the entire identity system. Verifying an agent means checking the TLS cert and the envelope signature — the same web PKI your browser already uses.

### Agent card

Every compliant agent publishes a machine-readable card at `/.well-known/agent.json`:

```json
{
  "id": "agent://myagent.com",
  "name": "CodeReview Agent",
  "skills": [
    {
      "id": "review-code",
      "modes": ["sync", "stream"],
      "trust": "public"
    }
  ],
  "publicKeys": [{ "kid": "key-1", "key": "base64-ed25519", "active": true }],
  "rateLimit": { "requestsPerMinute": 60, "requestsPerSender": 10 }
}
```

The SDK generates this from your `Agent` config and registered skills.

### Three communication modes, one envelope

All three share the same signed envelope and the same verification pipeline:

- **Sync** (`POST /agent/message`) — request/response, best for anything under ~30s
- **Async** (`POST /agent/task` → 202) — returns a `taskId` immediately; optional webhook callback; poll via `GET /agent/task/:taskId`
- **Stream** (`POST /agent/stream`) — Server-Sent Events with 15s keep-alive pings

### Trust tiers

Each skill picks one of three tiers, enforced before the handler runs:

| Tier | Who can call |
|---|---|
| `public` | Anyone with a valid signature |
| `authenticated` | Callers presenting a Bearer token you issued |
| `trusted-peers` | Specific `agent://` IDs in `allowedPeers` |

---

## Request envelope

Every call — sync, async, or stream — carries the same signed envelope.

HTTP headers (RFC 9421):
```
Content-Digest:   sha-256=:base64-sha256-of-body:
Signature-Input:  sig1=("@method" "@path" "content-digest");keyid="key-1";alg="ed25519";created=1744369200
Signature:        sig1=:base64-ed25519-signature:
```

JSON body:
```json
{
  "from": "agent://caller.com",
  "to": "agent://receiver.com",
  "skill": "review-code",
  "mode": "sync",
  "nonce": "a1b2c3d4e5f6",
  "timestamp": "2026-04-13T10:00:00Z",
  "traceId": "root-uuid",
  "spanId": "hop-uuid",
  "payload": { "code": "function foo() {}", "language": "typescript" }
}
```

---

## Calling agents

```typescript
import { AgentClient } from '@samvad-protocol/sdk'

const client = await AgentClient.from('https://other-agent.com')

// Sync
const result = await client.call('review-code', { code: '…' })

// Async — poll automatically
const result2 = await client.taskAndPoll('review-code', { code: '…' }, {
  intervalMs: 200,
  timeoutMs: 30_000,
})

// Async — webhook callback
const taskId = await client.task(
  'review-code',
  { code: '…' },
  'https://my-agent.com/agent/message'
)

// Streaming
for await (const chunk of client.stream('review-code', { code: '…' })) {
  process.stdout.write(String(chunk))
}
```

### Calling a `trusted-peers` skill

```typescript
const client = await AgentClient.prepare()
serverAgent.trustPeer(client.agentId, client.publicKey)
await client.connect('https://server-agent.com')
const result = await client.call('internal-skill', { … })
```

### Delegation

```typescript
import { createDelegationToken } from '@samvad-protocol/sdk'

const token = await createDelegationToken({
  issuer: 'agent://a.com',
  subject: 'agent://b.com',
  scope: ['review-code'],
  maxDepth: 2,
  expiresInSeconds: 300,
  privateKey: agentAKeypair.privateKey,
})
```

Each hop verifies the token, enforces the scope, and decrements `maxDepth`. At zero: `DELEGATION_EXCEEDED`.

---

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `AUTH_FAILED` | 401 | Invalid signature, unknown sender, or missing bearer token |
| `REPLAY_DETECTED` | 401 | Nonce already seen inside the 5-minute window |
| `SKILL_NOT_FOUND` | 404 | Unknown skill ID |
| `SCHEMA_INVALID` | 400 | Payload failed input schema validation |
| `INJECTION_DETECTED` | 400 | Payload flagged by the injection scanner |
| `DELEGATION_EXCEEDED` | 400 | Delegation scope or depth exhausted |
| `RATE_LIMITED` | 429 | Per-sender request rate exceeded |
| `TOKEN_BUDGET_EXCEEDED` | 429 | Per-sender daily token budget exceeded |
| `AGENT_UNAVAILABLE` | 500 | Handler threw or agent is overloaded |

---

## Injection defense

The SDK's regex scanner is a first pass only — it catches obvious strings but OWASP GenAI research shows regex detectors are bypassed by adaptive attacks more than 90% of the time. For high-trust skills, add an LLM-based classifier:

```typescript
const agent = new Agent({
  name: 'My Agent',
  url: 'http://localhost:3002',
  injectionClassifier: async (payload) => {
    // return true  → rejected (INJECTION_DETECTED)
    // return false → proceeds
    // throw        → fail-open (warning logged, proceeds)
    const res = await openai.moderations.create({ input: JSON.stringify(payload) })
    return res.results[0].flagged
  },
})
```

Always wrap external text in `wrapWithContentBoundary(text)` before passing it to an LLM context.

---

## Access control patterns

**Public service** — anyone with a valid signature can call, daily token budget protects your LLM costs:
```typescript
trust: 'public'
// rateLimit.tokensPerSenderPerDay: 10_000
```

**Internal multi-agent** — only your own agents:
```typescript
trust: 'trusted-peers',
allowedPeers: ['agent://billing.internal', 'agent://orchestrator.internal'],
```

**Commercial / paywalled** — issue Bearer tokens from your own subscription flow:
```typescript
trust: 'authenticated'
```

---

## Ecosystem

### Live agents

| Agent | Skills | URL |
|---|---|---|
| **Scout** | `readPage`, `summarizePage` — fetches and summarizes any URL via Jina Reader + Groq | [samvad-agents-scout.vercel.app](https://samvad-agents-scout.vercel.app) |
| **Claw** | `chat` — routes to a live OpenClaw instance over signed envelopes | [samvad-agents-claw.vercel.app](https://samvad-agents-claw.vercel.app) |

### Registry

Discover and try agents at **[samvadprotocol.vercel.app/registry](https://samvadprotocol.vercel.app/registry)** — register your own agent in one curl command:

```bash
curl -X POST https://samvadprotocol.vercel.app/api/register \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-agent.com"}'
```

### Integrations

- [OpenClaw](./docs/integrations/openclaw.md) — expose a self-hosted OpenClaw instance as a SAMVAD agent
- [LangChain](./docs/integrations/langchain.md) — expose a LangChain chain as a SAMVAD skill, or call a SAMVAD agent from a LangChain tool

---

## Repository layout

```
samvad/
├── packages/
│   └── sdk-typescript/          # @samvad-protocol/sdk
│       ├── src/
│       │   ├── agent.ts             # Agent class (server builder)
│       │   ├── agent-client.ts      # AgentClient (calling other agents)
│       │   ├── server.ts            # Fastify server + verify pipeline
│       │   ├── signing.ts           # Ed25519 + RFC 9421 HTTP Message Signatures
│       │   ├── delegation.ts        # JWT delegation tokens (jose)
│       │   ├── skill-registry.ts    # Skill registration + dispatch
│       │   ├── task-store.ts        # Async task state
│       │   ├── rate-limiter.ts      # Per-sender sliding window + token budget
│       │   ├── nonce-store.ts       # Replay protection
│       │   ├── injection-scanner.ts # Prompt-injection regex first pass
│       │   ├── card.ts              # AgentCard builder
│       │   ├── keys.ts              # Keypair generation and I/O
│       │   ├── stream.ts            # SSE helpers
│       │   ├── errors.ts            # SamvadError + error codes
│       │   └── types.ts             # Envelope, card, and skill types
│       └── tests/
└── examples/
    ├── basic-agent-ts/          # Hello-world agent
    └── debate-demo/             # Two-agent debate over signed envelopes
```

## Development

```bash
npm install
npm test --workspaces             # run all tests
npm test -w @samvad-protocol/sdk  # SDK only
npm run build --workspaces        # build all
npm start -w basic-agent-ts       # run the example agent
```

The SDK is ESM-only (`"type": "module"`, `module: NodeNext`). Internal imports use `.js` extensions. Vitest runs tests directly against `src/` — no build step required before `npm test`.

See [CLAUDE.md](./CLAUDE.md) for architecture details and the request-verification pipeline.  
Full protocol spec: [`spec/protocol-v1.2.md`](./spec/protocol-v1.2.md).

---

## Roadmap

**Shipped:**
- TypeScript SDK — sync, async, and streaming modes
- All eight security layers
- RFC 9421 HTTP Message Signatures, nonce replay protection, per-sender rate limiting
- EdDSA JWT delegation with scope and depth enforcement
- Public agent registry with search, live health checks, and an in-browser playground
- Scout and Claw reference agents

**Planned:**
- Python SDK (`samvad`) with feature parity
- Built-in LLM classifier adapters (LLM Guard, Guardrails AI)
- Formal language-agnostic protocol spec repository

## What's out of scope

Deliberately not part of the protocol — these belong in layers built on top:

- Payments between agents
- Orchestration / workflow engines
- LLM provider integrations (agents bring their own models)
- Persistent conversation state (protocol is stateless per message)
- Semantic capability matching

## Contributing

Good places to help:
- Python SDK
- Injection-defense story (LLM classifier adapters)
- Protocol conformance tests any SDK can run
- Real-world agent use cases that stress the design

Run `npm test --workspaces` before opening a PR. For non-trivial changes, open an issue first.

## License

[Apache License 2.0](./LICENSE) — free to use, modify, distribute, and use commercially. Includes an explicit patent grant from every contributor.

Copyright 2026 The SAMVAD Authors.

---

*SAMVAD takes its name from the Sanskrit word for dialogue between parties.*
