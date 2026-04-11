# SAMVAD Protocol Specification

**Version:** 1.1  
**Status:** Stable  
**Date:** 2026-04-11

**SAMVAD** — **S**ecure **A**gent **M**essaging, **V**erification **A**nd **D**iscovery  
*The Open Sovereign Agent Dialogue Protocol*  
*"samvad" (संवाद) — Sanskrit for "dialogue between parties"*

---

## 1. Problem Statement

SAMVAD exists to fill one specific gap: a protocol for AI agents on the public internet to discover each other, verify each other's identity, and exchange typed messages — with no central authority, no platform sign-up, and a ten-minute path from zero to a working agent.

The design bet is simple: **adoption beats architecture**. The protocol that gets used will be the one that makes it trivially easy for a developer to stand up a compliant agent on an afternoon, and impossible to accidentally misconfigure the security on. Every design decision in this document is filtered through that lens — if a feature cannot be made safe-by-default in the SDK without developer effort, it gets cut or deferred.

---

## 2. Goals

- Any developer can create a protocol-compliant agent in under 10 minutes
- Agents can discover each other without a central authority
- Agents can communicate in sync, async, and streaming modes
- The protocol is secure by default — all security handled by the SDK
- No registration required to participate; registry is optional for discoverability
- Language-agnostic spec; TypeScript is the reference implementation

---

## 3. Core Concepts

### 3.1 Agent Identity

An agent's identity is its domain. The `agent://` URI scheme maps directly to an HTTPS domain:

```
agent://myagent.com  →  https://myagent.com
```

Identity is verified via:
1. TLS certificate matching the claimed domain (standard web PKI)
2. Public key declared in the agent card — all messages are signed with the corresponding private key

No accounts, no registration, no API keys required to establish identity.

### 3.2 Agent Card

Every agent hosts a machine-readable identity card at:

```
GET /.well-known/agent.json
```

The agent card is the single source of truth for everything about an agent — its skills, public keys, rate limits, and endpoints.

```json
{
  "id": "agent://myagent.com",
  "name": "CodeReview Agent",
  "version": "1.2.0",
  "description": "Reviews code for bugs, security issues, and style",
  "url": "https://myagent.com",
  "protocolVersion": "1.1",
  "specializations": ["code-review", "security-audit"],
  "models": [
    { "provider": "anthropic", "model": "claude-opus-4-6" }
  ],
  "skills": [
    {
      "id": "review-code",
      "name": "Review Code",
      "description": "Reviews a code snippet for bugs, security issues, and style",
      "inputSchema": {
        "type": "object",
        "properties": {
          "code": { "type": "string", "maxLength": 50000 },
          "language": { "type": "string" }
        },
        "required": ["code"]
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "issues": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "line": { "type": "integer" },
                "severity": { "type": "string", "enum": ["error", "warning", "info"] },
                "message": { "type": "string" }
              },
              "required": ["line", "severity", "message"]
            }
          },
          "summary": { "type": "string" }
        },
        "required": ["issues", "summary"]
      },
      "modes": ["sync", "stream"],
      "trust": "public"
    }
  ],
  "publicKeys": [
    { "kid": "key-2", "key": "base64encodedEd25519publickey", "active": true },
    { "kid": "key-1", "key": "base64encodedEd25519publickey", "active": false }
  ],
  "auth": {
    "schemes": ["bearer", "none"]
  },
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

---

## 4. Standard Endpoints

Every compliant agent exposes exactly seven endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/.well-known/agent.json`  | Machine-readable agent card |
| `GET`  | `/agent/intro`             | Human & LLM-friendly introduction |
| `GET`  | `/agent/health`            | Liveness check — uptime, version, load |
| `POST` | `/agent/message`           | Synchronous request/response |
| `POST` | `/agent/task`              | Asynchronous task with optional webhook |
| `GET`  | `/agent/task/:taskId`      | Async task status polling |
| `POST` | `/agent/stream`            | Server-Sent Events streaming |

### 4.1 GET /agent/health

Always public. Returns agent liveness and basic load information.

**Response:** `application/json`

```json
{
  "status": "ok",
  "protocolVersion": "1.1",
  "agentVersion": "1.2.0",
  "uptime": 86400,
  "load": { "activeRequests": 3, "queuedTasks": 1 }
}
```

### 4.2 GET /agent/intro

Returns a plain-text or Markdown self-introduction. Always public. Intended for humans and LLMs deciding whether to work with the agent.

**Response:** `text/markdown` or `text/plain`

```markdown
# CodeReview Agent

I'm a code review specialist agent powered by Claude Opus 4.6.
I review code for bugs, security vulnerabilities, and style issues.

## What I'm good at
- Static analysis across 20+ languages
- Security vulnerability detection (OWASP Top 10)
- Performance bottleneck identification

## How to work with me
Call my `review-code` skill with a code snippet.
For large files, use async task mode with a callback URL.
```

---

## 5. Message Format

All three communication modes share the same signed envelope.

### 5.1 Request Envelope

```json
{
  "from": "agent://sender.com",
  "to": "agent://receiver.com",
  "skill": "review-code",
  "mode": "sync",
  "nonce": "a1b2c3d4e5f6",
  "timestamp": "2026-04-11T10:00:00Z",
  "kid": "key-2",
  "signature": "base64-Ed25519-signature",
  "traceId": "root-correlation-uuid",
  "spanId": "this-hop-uuid",
  "parentSpanId": "caller-span-uuid",
  "delegationToken": null,
  "auth": { "scheme": "bearer", "token": "…" },
  "payload": {
    "code": "function foo() { return 1 }",
    "language": "typescript"
  }
}
```

The `auth` field is omitted or `null` for `public` skills. The `delegationToken` field is omitted or `null` when no delegation is in use.

**Signature computation:** The signature is computed over a recursive canonical JSON serialization of all fields except `signature` — keys sorted lexicographically at every depth level, no insignificant whitespace. Any field reordering or body substitution invalidates the signature.

> **Roadmap:** A future protocol version will migrate the signing format to RFC 9421 (HTTP Message Signatures) for interoperability with IETF-standard tooling.

### 5.2 Response Envelope

```json
{
  "traceId": "root-correlation-uuid",
  "spanId": "responder-uuid",
  "status": "ok",
  "result": {
    "issues": [
      { "line": 12, "severity": "warning", "message": "Unused variable 'x'" }
    ],
    "summary": "1 warning found"
  }
}
```

On error, `result` is absent and `error` is populated:

```json
{
  "status": "error",
  "error": {
    "code": "SCHEMA_INVALID",
    "message": "Field 'code' exceeds maxLength of 50000 characters"
  }
}
```

### 5.3 Standard Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `AUTH_FAILED` | 401 | Invalid or missing signature, unknown sender, or missing bearer token |
| `REPLAY_DETECTED` | 401 | Nonce already seen within the replay window |
| `SKILL_NOT_FOUND` | 404 | Skill ID does not exist on this agent |
| `SCHEMA_INVALID` | 400 | Payload fails input schema validation |
| `INJECTION_DETECTED` | 400 | Content scanner flagged potential prompt injection |
| `DELEGATION_EXCEEDED` | 400 | Delegation scope or depth limit exceeded |
| `RATE_LIMITED` | 429 | Sender exceeded declared request rate |
| `TOKEN_BUDGET_EXCEEDED` | 429 | Sender exhausted their daily token budget |
| `AGENT_UNAVAILABLE` | 500 | Agent is overloaded or handler threw |

---

## 6. Communication Modes

### 6.1 Sync — POST /agent/message

Standard request/response. The agent returns HTTP 200 with the result body. Best for tasks completing in under ~30 seconds.

```
Caller  →  POST /agent/message  →  Agent
Caller  ←  HTTP 200 { result }  ←  Agent
```

### 6.2 Async — POST /agent/task

Fire-and-forget with optional webhook callback. The agent returns HTTP 202 with a `taskId` immediately. When the task completes, the agent POSTs the result to the `callbackUrl` provided in the request (if any). Best for long-running work.

Request (additional field):
```json
{
  "callbackUrl": "https://caller.com/agent/message",
  "payload": { "…": "…" }
}
```

Immediate response:
```json
{
  "taskId": "task-uuid",
  "status": "accepted"
}
```

When complete, the agent POSTs the full response envelope to `callbackUrl`, signed by the agent's own key.

#### Task Status Polling — GET /agent/task/:taskId

Callers **must** implement polling as a fallback, because webhook delivery fails silently in real-world conditions. Agents must retain task results for at least 1 hour after completion.

Response while running:
```json
{ "taskId": "task-uuid", "status": "running", "progress": 0.4 }
```

Response when complete:
```json
{ "taskId": "task-uuid", "status": "done", "result": { "…": "…" } }
```

Response on failure:
```json
{ "taskId": "task-uuid", "status": "failed", "error": { "code": "…", "message": "…" } }
```

Valid status values: `pending` | `running` | `done` | `failed`.

### 6.3 Stream — POST /agent/stream

Server-Sent Events connection. The full signed request envelope is sent as a POST body (same format as `/agent/message`). The response is `text/event-stream`. The agent sends chunks as they are generated; the final event carries `"done": true` and the full typed result.

> **Note:** Browser clients cannot use the native `EventSource` API (which is GET-only). Use `fetch()` with a streaming reader, or an SDK client that handles this automatically.

**Required response headers** (prevents proxy buffering):
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

Servers must send a keep-alive comment every 15 seconds when no data is flowing:
```
: keep-alive
```

SSE event format:
```
data: {"chunk": "Reviewing lines 1-50...", "done": false}
data: {"chunk": "Found issue on line 12...", "done": false}
: keep-alive
data: {"done": true, "result": { "issues": […], "summary": "…" }}
```

---

## 7. Security Model

Eight layers of security, all enforced automatically by compliant SDKs.

### L1 — Agent Identity (DNS + TLS)

TLS certificate must match the claimed agent domain. Identity is anchored in standard web PKI — no new infrastructure required.

### L2 — Message Signing (Ed25519 + Canonical JSON + Nonce + Timestamp)

Every envelope is signed with Ed25519 over a canonical JSON serialization of all fields except `signature` (keys sorted lexicographically at every depth, no insignificant whitespace). Messages older than 5 minutes or whose nonce has already been seen within the window are rejected immediately.

Each message includes the `kid` of the signing key, so receivers can verify against the correct key in the agent card.

### L3 — Trust Tiers (per skill)

Each skill declares its trust tier, enforced by the receiver after signature verification:

| Tier | Who can call |
|------|-------------|
| `public` | Anyone with a valid signature |
| `authenticated` | Callers presenting a Bearer token issued by the agent owner |
| `trusted-peers` | Specific `agent://` IDs listed in the skill's `allowedPeers` |

### L4 — Input Validation + Injection Defense

Inputs are validated against the skill's `inputSchema` before the handler runs. Unexpected fields are stripped. `maxLength` declarations are enforced.

> **Note on injection defense:** OWASP GenAI Security research shows adaptive prompt injection attacks bypass regex-based defenses with over 90% success rate. A regex scanner is a useful first pass but not a sufficient defense on its own. For high-trust skills, layer in an LLM-based classifier (LLM Guard, Guardrails AI) and always wrap external input in an untrusted-input boundary before passing it into an LLM context. Apply the principle of least privilege to whatever the handler touches.

### L5 — Rate Limiting + Token Budgets

Rate limits are declared in the agent card and tracked per verified sender `agent://` ID. Excess requests receive HTTP 429.

```json
"rateLimit": {
  "requestsPerMinute": 60,
  "requestsPerSender": 10,
  "tokensPerSenderPerDay": 100000
}
```

`tokensPerSenderPerDay` caps LLM token consumption per caller (tracked from provider API responses). When exceeded, the agent returns `TOKEN_BUDGET_EXCEEDED` with a `Retry-After` header.

### L6 — Key Versioning + Revocation

Agent cards list every active and inactive key with a `kid`. Messages include the `kid` used to sign. Receivers re-fetch the card after `cardTTL` seconds, so deactivating a key propagates globally with no central revocation server.

### L7 — Delegation Scope + Depth (EdDSA JWT, RFC 8693)

When Agent A delegates to Agent B, a JWT delegation token is passed in the message envelope's `delegationToken` field. The token follows RFC 8693 (OAuth 2.0 Token Exchange) using the `act` claim for chained delegation, signed with Agent A's Ed25519 private key.

Token structure:
```json
{
  "iss": "agent://agenta.com",
  "sub": "agent://agentb.com",
  "scope": "review-code summarize-code",
  "maxDepth": 2,
  "exp": 1744371600,
  "act": { "sub": "agent://agenta.com" }
}
```

Each hop:
1. Verifies the JWT signature against the issuer's published public key
2. Checks `scope` — the receiver may only invoke skills listed here
3. Decrements `maxDepth` before passing the token further; rejects if depth reaches 0
4. Checks `exp` — rejects expired tokens

### L8 — Audit Trail (OpenTelemetry-compatible)

Every envelope carries `traceId`, `spanId`, and `parentSpanId`. Each agent logs its span. The full call tree of any multi-agent conversation is reconstructible from the logs of any participant. Also available as HTTP headers: `X-Agent-Trace-ID`, `X-Agent-Span-ID`, `X-Agent-Parent-Span`.

---

## 8. Access Control & Cost Management

The protocol does not define a billing model. Agent owners decide how to run and monetize their agents. The protocol provides the authentication primitives; everything built on top is the agent owner's product.

### 8.1 The Three Models

**Public service** — set skills to `trust: "public"`. Anyone can call; the agent owner absorbs LLM costs. Use `tokensPerSenderPerDay` to cap per-caller consumption.

**Internal / multi-agent orchestration** — set skills to `trust: "trusted-peers"` with an `allowedPeers` allowlist of your internal agent IDs.

```json
{
  "id": "process-order",
  "trust": "trusted-peers",
  "allowedPeers": ["agent://billing.internal", "agent://inventory.internal"]
}
```

**Commercial / paywalled** — set skills to `trust: "authenticated"`. Issue Bearer tokens from your own paywall or subscription flow; the protocol enforces their presence.

### 8.2 What Is Out of Scope

How agent owners issue, rotate, or revoke API keys; how they charge for access; how they implement subscriptions or usage-based pricing — all of this is outside the protocol. The protocol provides one hook: `trust: "authenticated"` requires a valid Bearer token. Everything built on top of that hook is the agent owner's product.

---

## 9. Discovery

### 9.1 Self-Sovereign (no registry required)

If you know an agent's domain, you can reach it directly:

1. Fetch `https://theirdomain.com/.well-known/agent.json`
2. Read their endpoints, skills, and public keys
3. Call any public skill immediately

### 9.2 Optional Public Registry

Agents that want to be discoverable submit their card URL to a registry. The registry crawls the card, indexes it, and re-crawls every `cardTTL` seconds.

**Registry endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST`   | `/register`      | Submit agent card URL for indexing |
| `GET`    | `/search`        | Search by specialization, model, capability, free text |
| `GET`    | `/agents/:id`    | Fetch a specific agent's cached card |
| `DELETE` | `/agents/:id`    | Remove from registry (request must be signed by the agent's key) |

**Search parameters:**

| Param | Description | Example |
|-------|-------------|---------|
| `q` | Free text search | `code-review` |
| `specialization` | Filter by specialization tag | `security-audit` |
| `model` | Filter by model provider or name | `claude` |
| `mode` | Filter by supported communication mode | `stream` |
| `page` | Pagination (default: 1) | `2` |
| `limit` | Results per page (max 50, default 20) | `10` |

Search response includes `total`, `page`, `limit`, and a `results` array of agent cards. The registry is optional and unspecified as to implementation — compliant agents work without one.

---

## 10. What Is Explicitly Out of Scope

These are deliberately not part of the protocol. They belong in layers built on top:

- Payments between agents
- Agent orchestration / workflow engines
- LLM provider integrations (agents bring their own models)
- Persistent conversation state (protocol is stateless per message; agents manage their own state)
- Semantic / ontology-based capability matching

---

## 11. Conformance

A compliant agent implementation must:

1. Host a valid `agent.json` at `GET /.well-known/agent.json`
2. Expose all seven standard endpoints
3. Validate inbound envelope signatures against the sender's published public key
4. Reject envelopes older than 5 minutes or with a seen nonce
5. Enforce skill trust tiers after signature verification
6. Validate skill inputs against the declared `inputSchema`
7. Return standard error codes for all failure conditions
8. Retain async task results for at least 1 hour after completion

---

*See also: [README](../README.md) for quick start, usage examples, and the TypeScript SDK reference.*
