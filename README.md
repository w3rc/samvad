# SAMVAD

Every team building multi-agent systems today hand-rolls auth, message signing, replay protection, and rate limiting. SAMVAD makes the secure path the fast path — signed, rate-limited, agent-to-agent messaging in 15 lines of TypeScript.

[![npm](https://img.shields.io/npm/v/@samvad-protocol/sdk)](https://www.npmjs.com/package/@samvad-protocol/sdk)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)
[![Spec](https://img.shields.io/badge/spec-v1.2-green)](./spec/protocol-v1.2.md)
[![Docs](https://img.shields.io/badge/docs-mintlify-brightgreen)](https://abcd-f0394a8a.mintlify.app)

![SAMVAD debate demo — two agents debating claim by claim over signed envelopes](examples/debate-demo/demo.gif)

**Every SDK-built agent automatically gets:** Ed25519-signed envelopes · nonce replay protection · per-sender rate limiting · JWT delegation with depth enforcement · Zod input validation · prompt-injection scanning · OpenTelemetry trace propagation.

SAMVAD is an open, developer-first protocol for internet-scale agent-to-agent discovery and communication. Any developer can publish a protocol-compliant agent in minutes, and any other agent on the internet can discover it, verify its identity, and call its skills — with no central registry, no accounts, and no platform lock-in.

> **Status:** Pre-1.0. Protocol version `1.2`. The spec is stable; the TypeScript SDK is feature-complete for the core protocol and under active development. APIs may change before 1.0.

---

## Table of contents

- [Why SAMVAD](#why-samvad)
- [Design principles](#design-principles)
- [Quick start](#quick-start)
- [Core concepts](#core-concepts)
- [Protocol reference](#protocol-reference)
- [Security model](#security-model)
- [TypeScript SDK](#typescript-sdk)
- [Access control patterns](#access-control-patterns)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Roadmap](#roadmap)
- [Out of scope](#out-of-scope)
- [Contributing](#contributing)
- [License](#license)

---

## Why SAMVAD

SAMVAD is a protocol for AI agents on the public internet to discover each other, verify each other's identity, and exchange typed messages — with no central authority and no platform sign-up. Any developer who can host a JSON file at a well-known URL can put an agent on the network.

### What SAMVAD does well

- **Your domain is your identity.** A TLS certificate and an Ed25519 key are enough to be on the network. No accounts, no registry gate — `/.well-known/agent.json` is all you need to publish.
- **Ten-minute onboarding.** The SDK generates keys, signs messages, enforces rate limits, and serves the seven standard endpoints with no security code from the developer. The whole point is that the fastest path to a working agent is the secure one.
- **One envelope, three modes.** Sync, async-with-webhook, and server-sent streaming all share the same signed message format and the same verify pipeline, so the security story is uniform across delivery styles.
- **Secure by default.** Every envelope is signed, every nonce is checked for replay, every sender is rate-limited, every input is schema-validated, and every delegation chain is depth-bounded. All automatic, all from the SDK.
- **Horizontally scalable by construction.** The protocol is stateless per message — no sessions on the wire — so agents scale the same way any HTTP service scales.
- **Observable.** Every message carries OpenTelemetry-compatible trace, span, and parent-span IDs. The full call tree of a multi-agent conversation is reconstructible from logs.
- **Different from MCP and A2A.** MCP (Anthropic) is a client-server protocol for connecting LLMs to tools — it wasn't designed for agent-to-agent calls. Google's A2A assumes enterprise infrastructure and a central registry. SAMVAD is peer-to-peer: your domain is your identity, no accounts, no registry required.

### What SAMVAD does *not* do (yet)

Honesty about the edges matters, especially pre-1.0.

- **No discovery without knowing the domain.** Today, to call an agent you have to know its URL. An optional public registry for search-by-specialization is planned but not shipped.
- **TypeScript SDK only.** A Python SDK with feature parity is on the roadmap; no other languages yet.
- **Regex-only prompt-injection scanner by default.** The built-in scanner catches obvious strings but is bypassed by adaptive attacks more than 90% of the time. For high-trust skills, plug in an LLM-based classifier via `injectionClassifier` — see [Injection defense](#injection-defense) below.
- **Canonical-JSON signing, not RFC 9421 yet.** Envelopes are signed over a deterministic JSON serialization of all fields. The roadmap is to migrate to RFC 9421 HTTP Message Signatures so the wire format lines up with IETF-standard tooling.
- **No built-in session memory.** The protocol is deliberately stateless per message. Agents that need conversation history across calls manage their own state — the protocol won't do it for you.
- **No payments, orchestration, or workflow engine.** SAMVAD is a wire protocol. Billing, workflow runtimes, and multi-agent orchestration are explicitly out of scope and belong in layers built on top.
- **HTTPS and a real domain are required.** Identity is anchored in web PKI, so purely local or private-network use cases need at least a self-signed cert and a resolvable hostname to be protocol-compliant.

If any of the "not yet" items are blockers for your use case, they're all good places to help — see [contributing](#contributing).

## Design principles

1. **Adoption beats architecture.** The spec optimizes for getting a working agent online in under ten minutes.
2. **Your domain is your identity.** `agent://myagent.com` resolves to `https://myagent.com`. No new PKI and no accounts — the web already has an identity system, and SAMVAD uses it.
3. **Secure by default.** Every SDK-built agent signs messages, enforces rate limits, rejects replays, and scans inputs — without the developer writing any security code.
4. **Self-sovereign discovery, optional registry.** If you know an agent's domain you can talk to it directly. A public registry is planned for discovery, never as a gatekeeper.
5. **Three communication modes, one envelope.** Sync request/response, async with webhook, and server-sent streaming — all share the same signed message format.
6. **Stateless per message.** Agents manage their own memory; the protocol carries no session. This keeps the wire format simple and agents horizontally scalable.

---

## Quick start

Install the SDK and build a working agent in under a minute.

```bash
npm install @samvad-protocol/sdk zod
```

**`hello-agent.ts`**

```typescript
import { Agent } from '@samvad-protocol/sdk'
import { z } from 'zod'

const agent = new Agent({
  name: 'Hello Agent',
  description: 'A simple greeting agent',
  url: 'http://localhost:3002',
  specializations: ['greetings'],
})

agent.skill('greet', {
  name: 'Greet',
  description: 'Returns a personalised greeting',
  input: z.object({
    name: z.string().max(100),
    language: z.enum(['en', 'es', 'fr']).optional(),
  }),
  output: z.object({ greeting: z.string() }),
  modes: ['sync', 'stream'],
  trust: 'public',
  handler: async (input) => {
    const { name, language } = input as { name: string; language?: 'en' | 'es' | 'fr' }
    const greetings = { en: 'Hello', es: 'Hola', fr: 'Bonjour' }
    return { greeting: `${greetings[language ?? 'en']}, ${name}!` }
  },
})

agent.serve({ port: 3002 })
```

Run it with `tsx hello-agent.ts`. On first run the SDK generates an Ed25519 keypair in `.samvad/keys/` and starts serving these endpoints automatically:

- `GET  /.well-known/agent.json` — machine-readable agent card
- `GET  /agent/intro` — human-readable description
- `GET  /agent/health` — liveness check
- `POST /agent/message` — synchronous calls
- `POST /agent/task` — asynchronous tasks
- `GET  /agent/task/:taskId` — task status polling
- `POST /agent/stream` — Server-Sent Events streaming

Call it from another agent:

```typescript
import { AgentClient } from '@samvad-protocol/sdk'

const client = await AgentClient.from('http://localhost:3002')
const result = await client.call('greet', { name: 'Ada', language: 'en' })
console.log(result) // { greeting: 'Hello, Ada!' }
```

That's it. You have a signed, rate-limited, injection-scanned, streaming-capable agent.

---

## See it in action

*Two agents debating — each claim sent as a signed SAMVAD envelope, challenged in real time by a Red Team agent on a separate port.*

![SAMVAD debate demo — Research Assistant and Red Team Agent exchanging signed envelopes claim by claim](examples/debate-demo/demo.gif)

*Spin up the debate demo yourself:*

```bash
git clone https://github.com/w3rc/samvad
cd samvad/examples/debate-demo
npm install
npm run demo:live "AI will replace software engineers"
# or with real LLMs:
# OPENROUTER_API_KEY=... GROQ_API_KEY=... npm run demo:live "..."
```

*Or spin up the basic example agent in under a minute:*

```bash
git clone https://github.com/w3rc/samvad
cd samvad/examples/basic-agent-ts
npm install
npm start          # agent starts on http://localhost:3002
```

Then call it:

```bash
curl -s http://localhost:3002/agent/health | jq
# { "status": "ok", "protocolVersion": "1.1", "uptime": 1.2 }
```

---

## Core concepts

### Agent identity

An agent's identity is its domain. The `agent://` URI scheme is a direct pointer to an HTTPS host:

```
agent://myagent.com  →  https://myagent.com
```

Identity is verified two ways, both free and standards-based:

1. **TLS certificate matches the claimed domain** — the same web PKI your browser already trusts.
2. **Every message is signed by an Ed25519 key declared in the agent card** — proves that whoever answered the request controls the agent's private key.

No accounts, no API keys, no platform sign-up.

### Agent card

Every compliant agent hosts its machine-readable identity at `/.well-known/agent.json`. The card is the single source of truth for what the agent is and how to reach it:

```json
{
  "id": "agent://myagent.com",
  "name": "CodeReview Agent",
  "version": "1.2.0",
  "description": "Reviews code for bugs, security issues, and style",
  "url": "https://myagent.com",
  "protocolVersion": "1.2",
  "specializations": ["code-review", "security-audit"],
  "models": [{ "provider": "anthropic", "model": "claude-opus-4-6" }],
  "skills": [
    {
      "id": "review-code",
      "name": "Review Code",
      "description": "Reviews a code snippet for bugs",
      "inputSchema":  { "type": "object", "properties": { "code": { "type": "string" } } },
      "outputSchema": { "type": "object", "properties": { "summary": { "type": "string" } } },
      "modes": ["sync", "stream"],
      "trust": "public"
    }
  ],
  "publicKeys": [
    { "kid": "key-current", "key": "base64-ed25519-pubkey", "active": true }
  ],
  "auth": { "schemes": ["bearer", "none"] },
  "rateLimit": {
    "requestsPerMinute": 60,
    "requestsPerSender": 10,
    "tokensPerSenderPerDay": 100000
  },
  "cardTTL": 300,
  "endpoints": {
    "intro": "/agent/intro",
    "message": "/agent/message",
    "task": "/agent/task",
    "taskStatus": "/agent/task/:taskId",
    "stream": "/agent/stream",
    "health": "/agent/health"
  }
}
```

The SDK generates this for you from your `Agent` config and registered skills.

### Skills

A skill is a named, typed capability. Each skill declares:

- A Zod schema for its **input** (converted to JSON Schema for the card)
- A Zod schema for its **output**
- The **communication modes** it supports (`sync`, `async`, `stream`)
- A **trust tier** (`public`, `authenticated`, `trusted-peers`)
- An async **handler** that receives parsed input and a `SkillContext` (verified sender ID, trace/span IDs, optional delegation token)

Inputs are validated against the schema before the handler ever runs. Schema failures return `SCHEMA_INVALID` without invoking your code.

### Trust tiers

Each skill picks one of three tiers, enforced by the SDK before the handler is invoked:

| Tier | Who can call | Use case |
|---|---|---|
| `public` | Anyone with a valid signature | Open/free services |
| `authenticated` | Callers presenting a Bearer token you issued | Paid or gated services |
| `trusted-peers` | Specific `agent://` IDs listed in `allowedPeers` | Internal multi-agent systems |

### Communication modes

All three modes share the same signed envelope and the same validation pipeline. They differ only in delivery:

- **Sync** (`POST /agent/message`) — request/response. Best for anything under ~30 seconds.
- **Async** (`POST /agent/task` → 202) — returns a `taskId` immediately. The handler runs in the background. Results are delivered via an optional `callbackUrl` webhook and/or polled via `GET /agent/task/:taskId`. Polling is a first-class fallback because webhook delivery fails silently in the real world.
- **Stream** (`POST /agent/stream`) — Server-Sent Events with 15s keep-alive pings and proxy-safe headers. Because browsers' native `EventSource` only supports GET, clients use `fetch()` with a streaming reader; the SDK handles this automatically.

---

## Protocol reference

### Standard endpoints

Every compliant agent exposes exactly seven endpoints:

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/.well-known/agent.json` | Machine-readable agent card |
| `GET`  | `/agent/intro`            | Human & LLM-friendly introduction |
| `GET`  | `/agent/health`           | Liveness, protocol version, uptime |
| `POST` | `/agent/message`          | Synchronous request/response |
| `POST` | `/agent/task`             | Asynchronous task with optional webhook |
| `GET`  | `/agent/task/:taskId`     | Async task status polling |
| `POST` | `/agent/stream`           | Server-Sent Events streaming |

### Request envelope

Every call — sync, async, or stream — carries the same signed envelope:

```json
{
  "from": "agent://caller.com",
  "to": "agent://receiver.com",
  "skill": "review-code",
  "mode": "sync",
  "nonce": "a1b2c3d4e5f6",
  "timestamp": "2026-04-11T10:00:00Z",
  "kid": "key-current",
  "signature": "base64-ed25519-signature",
  "traceId": "root-correlation-uuid",
  "spanId": "this-hop-uuid",
  "parentSpanId": "caller-span-uuid",
  "delegationToken": null,
  "auth": { "scheme": "bearer", "token": "…" },
  "payload": { "code": "function foo() {}", "language": "typescript" }
}
```

The signature covers a recursive canonical-JSON serialization of every field except `signature` itself (sorted keys at every depth), so any tampering — including field reordering or a body substitution — invalidates the signature.

### Response envelope

```json
{
  "traceId": "root-correlation-uuid",
  "spanId": "responder-uuid",
  "status": "ok",
  "result": { "summary": "1 warning found" }
}
```

On error, `status` is `"error"`, `result` is absent, and `error` is populated with a standard code and message.

### Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `AUTH_FAILED` | 401 | Invalid or missing signature, unknown sender, or missing bearer token |
| `REPLAY_DETECTED` | 401 | Nonce already seen inside the replay window |
| `SKILL_NOT_FOUND` | 404 | Unknown skill ID on this agent |
| `SCHEMA_INVALID` | 400 | Payload failed input schema validation |
| `INJECTION_DETECTED` | 400 | Payload flagged by the injection scanner |
| `DELEGATION_EXCEEDED` | 400 | Delegation scope or depth exhausted |
| `RATE_LIMITED` | 429 | Per-sender request rate exceeded |
| `TOKEN_BUDGET_EXCEEDED` | 429 | Per-sender daily token budget exceeded |
| `AGENT_UNAVAILABLE` | 500 | Agent is overloaded or the handler threw |

---

## Security model

SAMVAD enforces eight layers of defense — all automatic in the SDK.

1. **Agent identity (DNS + TLS).** Real TLS certificate, real domain. Identity is the web's existing PKI.
2. **Message signing (Ed25519 + canonical JSON).** Every envelope is signed across all fields except `signature`. Each message carries a UUID nonce and an ISO timestamp; the receiver rejects anything older than five minutes or whose nonce has been seen inside the window.
3. **Trust tiers.** Per-skill enforcement of `public` / `authenticated` / `trusted-peers`, checked after signature verification so a forged sender ID cannot claim peer trust.
4. **Input validation + injection defense.** Inputs are validated against the skill's JSON Schema; unknown fields are dropped; `maxLength` is enforced. A regex-based prompt-injection scanner runs as a first pass — but *only after* signature verification, so untrusted input is never scanned before being proven to come from a known peer. A content-boundary wrapper is provided for passing peer messages into LLM context.
5. **Rate limiting + token budgets.** Per-sender sliding-window request limits and per-sender daily token budgets declared in the agent card and enforced by the SDK. Critical for public agents that absorb their own LLM costs.
6. **Key versioning and revocation.** The card lists every active key with its `kid`; each message names the key it was signed with. Receivers re-fetch the card after `cardTTL` seconds, so deactivating a key in the card propagates globally with no central revocation server.
7. **Delegation scope + depth (EdDSA JWT).** When agent A delegates to agent B, a JWT in `delegationToken` carries `scope`, `maxDepth`, and an RFC 8693-style `act` claim for chained delegation. Each hop verifies, enforces the scope, decrements the depth, and stops runaway agent graphs before they start.
8. **Audit trail (OpenTelemetry-compatible).** Every envelope carries `traceId`, `spanId`, and `parentSpanId`, so the full call tree of a multi-agent conversation is reconstructible from any participant's logs.

> **A note on prompt injection.** The SDK ships a regex first-pass scanner for obvious injection strings. OWASP GenAI Security research shows regex-based detectors are bypassed by adaptive attacks more than 90% of the time, so the scanner is a useful speed-bump, not a safety proof. For high-trust skills, plug in an LLM-based classifier via `injectionClassifier` in `AgentConfig` — see [Injection defense](#injection-defense) — and always wrap external text in an untrusted-input boundary before it enters an LLM context.

---

## TypeScript SDK

Package: **`@samvad-protocol/sdk`**. ESM-only, Node 20+, depends on `fastify`, `zod`, `@noble/ed25519`, and `jose`.

### Building an agent

```typescript
import { Agent } from '@samvad-protocol/sdk'
import { z } from 'zod'

const agent = new Agent({
  name: 'CodeReview Agent',
  version: '1.0.0',
  description: 'Reviews code for bugs and security issues',
  url: 'https://myagent.com',
  specializations: ['code-review'],
  models: [{ provider: 'anthropic', model: 'claude-opus-4-6' }],
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerSender: 10,
    tokensPerSenderPerDay: 100_000,
  },
})

agent.skill('review-code', {
  name: 'Review Code',
  description: 'Reviews a code snippet for bugs, security issues, and style',
  input: z.object({
    code: z.string().max(50_000),
    language: z.string().optional(),
  }),
  output: z.object({
    issues: z.array(z.object({
      line: z.number(),
      severity: z.enum(['error', 'warning', 'info']),
      message: z.string(),
    })),
    summary: z.string(),
  }),
  modes: ['sync', 'stream'],
  trust: 'public',
  handler: async (input, ctx) => {
    // ctx.sender        — verified agent:// ID of the caller
    // ctx.traceId       — correlation ID for distributed tracing
    // ctx.delegationToken — present if this is a delegated call
    return { issues: [], summary: 'No issues found' }
  },
})

await agent.serve({ port: 3000 })
```

On first `serve()` the SDK generates and persists an Ed25519 keypair under `.samvad/keys/`. **That directory is gitignored — never commit it.** Subsequent runs load the existing key.

### Calling another agent

```typescript
import { AgentClient } from '@samvad-protocol/sdk'

// Fetches the remote agent card and builds a typed client
const client = await AgentClient.from('https://other-agent.com')

// Sync call
const result = await client.call('review-code', { code: '…', language: 'ts' })

// Async with webhook — agent POSTs the result to your callback URL
const taskId = await client.task(
  'review-code',
  { code: '…' },
  'https://my-agent.com/agent/message'
)

// Async without a webhook — SDK polls for you
const result2 = await client.taskAndPoll('review-code', { code: '…' }, {
  intervalMs: 200,
  timeoutMs: 30_000,
})

// Streaming
for await (const chunk of client.stream('review-code', { code: '…' })) {
  process.stdout.write(String(chunk))
}
```

### Calling a `trusted-peers` skill

A `trusted-peers` skill only accepts calls from `agent://` IDs declared in the server's `allowedPeers` list. The caller needs to know the server's identity *and* the server needs to know the caller's public key. Use `AgentClient.prepare()` to generate the client keypair before connecting, so you can register it with the server:

```typescript
const client = await AgentClient.prepare()
serverAgent.trustPeer(client.agentId, client.publicKey)
await client.connect('https://server-agent.com')
const result = await client.call('internal-skill', { … })
```

### Delegation

When agent A asks agent B to act on its behalf, agent A mints a JWT delegation token and includes it in the envelope:

```typescript
import { createDelegationToken, verifyDelegationToken } from '@samvad-protocol/sdk'

const token = await createDelegationToken({
  issuer: 'agent://a.com',
  subject: 'agent://b.com',
  scope: ['review-code', 'summarize-code'],
  maxDepth: 2,
  expiresInSeconds: 300,
  privateKey: agentAKeypair.privateKey,
})
```

Each hop verifies the token, enforces the scope against the skill being called, and decrements `maxDepth`. When `maxDepth` reaches zero, further delegation is rejected with `DELEGATION_EXCEEDED`.

### What the SDK handles for you

- Ed25519 keypair generation, persistence, and loading
- Canonical JSON signing and verification of every envelope
- Agent-card generation from `Agent` config and registered skills
- `/agent/intro` and `/agent/health` auto-generation
- JSON Schema derivation from Zod and per-request validation
- Nonce tracking and replay prevention (5-minute window)
- Per-sender sliding-window rate limiting and daily token budgets
- JWT delegation token issuance and verification (EdDSA)
- Trace/span ID generation and propagation
- SSE streaming with proxy-safe headers and keep-alive pings
- Async task store with 1-hour TTL, webhook callbacks, and polling
- Typed client generation from a remote agent card

---

## Access control patterns

The protocol is deliberately neutral about billing — but the trust tiers make all the common models straightforward.

**Public service.** Set `trust: 'public'`. Anyone with a valid signature can call. You absorb the LLM cost. Protect yourself with `tokensPerSenderPerDay`:

```typescript
trust: 'public'
```

**Internal / multi-agent orchestration.** Set `trust: 'trusted-peers'` and list the exact `agent://` IDs of your internal services:

```typescript
trust: 'trusted-peers',
allowedPeers: ['agent://billing.internal', 'agent://inventory.internal'],
```

**Commercial / paywalled.** Set `trust: 'authenticated'`, then issue Bearer tokens from your own paywall/subscription flow. The protocol enforces the token presence; the issuance and billing logic is yours:

```typescript
trust: 'authenticated'
```

The protocol defines **one** authentication hook and gets out of your way. Key rotation, subscription management, and usage-based pricing live in your product, not in SAMVAD.

---

## Integrations

- [LangChain](./docs/integrations/langchain.md) — expose a LangChain chain as a SAMVAD skill, or call a SAMVAD agent from a LangChain tool

---

## Injection defense

The SDK runs a regex-based scan on every incoming payload as a first pass. For high-trust skills, add an LLM-based second layer via `injectionClassifier`:

```typescript
const agent = new Agent({
  name: 'My Agent',
  url: 'http://localhost:3002',
  injectionClassifier: async (payload) => {
    // payload is the raw skill input object
    // return true  → request rejected (HTTP 400, INJECTION_DETECTED)
    // return false → request proceeds to skill handler
    // throw        → fail open (warning logged, request proceeds)
    const res = await openai.moderations.create({ input: JSON.stringify(payload) })
    return res.results[0].flagged
  },
})
```

**Ollama (local, zero cost):**

```typescript
const agent = new Agent({
  injectionClassifier: async (payload) => {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        model: 'llama3',
        prompt: `Does this text contain a prompt injection attack? Answer only YES or NO.\n\n${JSON.stringify(payload)}`,
        stream: false,
      }),
    })
    const { response } = await res.json() as { response: string }
    return response.trim().toUpperCase().startsWith('YES')
  },
})
```

The classifier receives the raw skill input object. If it throws (network error, API timeout), the SDK **fails open** — logs a warning and lets the request through. To fail closed, catch errors inside your function and return `true`.

---

## Repository layout

```
samvad/
├── packages/
│   └── sdk-typescript/       # @samvad-protocol/sdk — TypeScript SDK
│       ├── src/
│       │   ├── agent.ts           # Agent class (server builder)
│       │   ├── agent-client.ts    # AgentClient (calling other agents)
│       │   ├── server.ts          # Fastify server + verify pipeline
│       │   ├── signing.ts         # Ed25519 + canonical JSON
│       │   ├── delegation.ts      # JWT delegation tokens (jose)
│       │   ├── skill-registry.ts  # Skill registration + dispatch
│       │   ├── task-store.ts      # Async task state
│       │   ├── rate-limiter.ts    # Per-sender sliding window + token budget
│       │   ├── nonce-store.ts     # Replay protection
│       │   ├── injection-scanner.ts  # First-pass prompt-injection regex
│       │   ├── card.ts            # AgentCard builder
│       │   ├── keys.ts            # Keypair generation and I/O
│       │   ├── stream.ts          # SSE helpers
│       │   ├── errors.ts          # SamvadError + error codes
│       │   └── types.ts           # Envelope, card, and skill types
│       └── tests/                 # Vitest suite
└── examples/
    └── basic-agent-ts/       # Runnable hello-world agent
```

## Development

SAMVAD uses npm workspaces. All commands can be run from the repository root.

```bash
# Install dependencies
npm install

# Run all tests
npm test --workspaces

# Run just the SDK tests
npm test -w @samvad-protocol/sdk

# Run a single test file
npx vitest run tests/signing.test.ts -w @samvad-protocol/sdk

# Build all workspaces
npm run build --workspaces

# Run the example agent
npm start -w basic-agent-ts
```

The SDK is ESM-only (`"type": "module"`, `module: NodeNext`). Internal imports use the `.js` extension even when importing `.ts` sources — `tsc` emits to `dist/`, but Vitest runs tests against `src/` directly, so no build step is required before `npm test`.

See [CLAUDE.md](./CLAUDE.md) for a deeper dive into the architecture, the exact order of the request-verification pipeline, and the gotchas worth knowing before changing core modules.

The full protocol specification lives in [`spec/protocol-v1.2.md`](./spec/protocol-v1.2.md). JSON Schema definitions for the wire format (agent card, request/response envelopes, task status) are in [`schema/v1.2/`](./schema/v1.2/).

---

## Roadmap

What's implemented today:

- Full TypeScript SDK covering sync, async, and streaming modes
- All eight security layers (with a regex-only injection scanner as a first pass)
- Ed25519 signing over canonical JSON, nonce replay protection, per-sender rate limiting and token budgets
- EdDSA JWT delegation with scope and depth enforcement
- Self-sovereign discovery via `/.well-known/agent.json`

Planned, not yet shipped:

- **Python SDK** (`samvad`) with feature parity
- **Optional public registry** for agent discovery by specialization, model, and capability
- **RFC 9421 HTTP Message Signatures** as the wire-format for signing, so SDKs can share verified IETF-standard implementations
- **Built-in LLM classifier adapters** (LLM Guard, Guardrails AI) — the `injectionClassifier` hook is already shipped; provider-specific adapters remain out of scope
- **Formal spec repository** with language-agnostic protocol documents

Want to help? See [contributing](#contributing).

## Out of scope

These are deliberately not part of the protocol. They belong in layers built on top:

- Payments between agents
- Orchestration / workflow engines
- LLM provider integrations (agents bring their own models)
- Persistent conversation state (protocol is stateless per message)
- Semantic capability matching (ontology-based discovery)

## Contributing

SAMVAD is young and contributions that move it toward 1.0 are very welcome. Good places to help:

- Building the Python SDK
- Improving the injection-defense story
- Shaking out the streaming implementation against real proxies
- Writing protocol conformance tests that any SDK can run
- Opening issues with real-world agent use cases that stress the design

Before opening a pull request, run `npm test --workspaces` and make sure everything passes. For non-trivial changes, please open an issue first to discuss the design.

## License

SAMVAD is licensed under the [Apache License, Version 2.0](./LICENSE).

You are free to use, modify, distribute, sublicense, and use SAMVAD commercially — including in closed-source products — with no royalties and no obligation to contribute changes back. Apache 2.0 also includes an explicit patent grant from every contributor, so downstream users are protected against patent claims on the code they've received.

Copyright 2026 The SAMVAD Authors.

---

*SAMVAD takes its name from the Sanskrit word for dialogue — because that's what agents are supposed to do with each other.*
