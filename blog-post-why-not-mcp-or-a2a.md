# Why I Didn't Use MCP or Google's A2A

If you're building a system where agents need to talk to other agents on the public internet, you've probably looked at MCP and A2A. I did too. Both are well-designed protocols that solve real problems. Neither solved mine.

I ended up building SAMVAD -- Secure Agent Messaging, Verification And Discovery -- an open-source agent-to-agent protocol with a TypeScript SDK. This post explains why, without pretending the alternatives are bad. They aren't.

## MCP: Great for Tools, Not for Peers

Anthropic's Model Context Protocol is genuinely useful. It gives LLMs a clean way to discover and call tools -- file systems, databases, APIs, code interpreters. The client-server model is straightforward. JSON-RPC is a sensible choice for structured tool invocation. If you need to connect Claude or GPT to your internal tooling, MCP is probably the right answer.

But MCP was designed for a different topology. It's a client-server protocol where the LLM is the client and the tool is the server. There is no concept of mutual identity -- the tool doesn't verify who is calling it beyond whatever auth layer you bolt on yourself. There's no message signing on the wire. No replay protection. No built-in rate limiting.

These aren't oversights. They're reasonable design choices for the problem MCP solves: connecting an LLM to tools within a trusted environment. The assumption is that you control both sides, or at least trust the network between them.

The moment you want agent A on the internet to call agent B on a different server, owned by a different developer, that assumption breaks. You need both sides to prove who they are, sign their messages, reject replays, and throttle abuse. MCP doesn't have answers for these because they were never its questions.

## A2A: Enterprise-Grade, Enterprise-Weight

Google's Agent-to-Agent protocol is closer to what I needed. It's explicitly designed for agent-to-agent communication. It has agent cards for discovery, a task lifecycle model, streaming support, and structured skill definitions. The design is thoughtful and comprehensive.

Where A2A diverges from my use case is in its assumptions about infrastructure. Identity in A2A flows through OAuth 2.0 and OpenID Connect. Discovery assumes centralized registries or enterprise service meshes. The protocol is designed for environments where you already have an identity provider, a service catalog, and probably a team managing both.

For a solo developer or a small startup that wants to deploy an agent on a $5 VPS and have other agents call it, the infrastructure requirements are heavy. You need to set up or integrate with an OAuth provider. You need to register with a discovery service. The protocol is correct in an enterprise context, but the on-ramp for indie developers is steep.

There's also a philosophical difference. A2A leans toward orchestrated workflows where a central coordinator dispatches tasks to specialist agents. That's a valid architecture, but it's not the only one. Sometimes you want a flat peer-to-peer network where any agent can talk to any other agent directly, without a coordinator in the middle.

## SAMVAD: Peer-to-Peer, Secure by Default

SAMVAD fills the gap between MCP's tool-calling model and A2A's enterprise orchestration.

Like A2A, it's designed for agent-to-agent communication. Agents publish AgentCards at `/.well-known/agent.json` that advertise their skills, public keys, rate limits, and supported communication modes. Other agents fetch the card, discover capabilities, and call skills with typed inputs and outputs.

Unlike A2A, identity is peer-to-peer. Each agent generates an Ed25519 keypair on first boot. Your domain is your identity -- `agent://yourdomain.com`. No OAuth provider, no central registry, no enterprise infrastructure. If you control a domain and can serve HTTPS, you can run an agent.

Security is built into the SDK, not left as an exercise for the developer. Every message envelope is signed with Ed25519. Signatures are verified against the sender's published public key before any payload processing. Nonces and timestamps provide replay protection with a 5-minute window. Rate limiting -- per-sender request throttling and daily token budgets -- runs on every inbound request. Prompt injection scanning (regex-based, with an optional LLM classifier hook) happens after authentication, so untrusted input is never processed before identity is proven.

The verification pipeline runs in a deliberate order: nonce check, rate limit, signature verification, injection scan, trust tier enforcement. Cheap rejections first, expensive ones last. This isn't configurable because reordering these steps changes the security posture.

Communication supports three modes through the same verification pipeline: synchronous request-response, asynchronous tasks with polling and optional webhooks, and SSE streaming. Skills are defined with Zod schemas that get validated at dispatch time and converted to JSON Schema for the AgentCard.

Here's what a working agent looks like:

```typescript
import { Agent } from '@samvad-protocol/sdk'
import { z } from 'zod'

const agent = new Agent({
  name: 'Hello Agent',
  url: 'https://my-agent.example.com',
  specializations: ['greetings'],
  rateLimit: { requestsPerMinute: 60, requestsPerSender: 10 },
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

agent.serve({ port: 3002 })
```

That's a complete agent with Ed25519 signing, replay protection, rate limiting, and a discoverable skill -- no security boilerplate from the developer. The SDK handles all of it.

Delegation is built in too. SAMVAD uses EdDSA-signed JWTs with scope restrictions and depth limits for chained delegation. When agent A asks agent B to call agent C on its behalf, the delegation token carries the chain of trust with a decrementing depth counter.

## Comparison

| | SAMVAD | MCP | A2A |
|---|---|---|---|
| **Primary model** | Agent-to-agent | LLM-to-tool | Agent-to-agent |
| **Identity** | Ed25519 keypair + domain | None built-in | OAuth 2.0 / OIDC |
| **Message signing** | Ed25519 on every envelope | No | No (relies on transport) |
| **Replay protection** | Nonce + timestamp (5-min window) | No | No |
| **Rate limiting** | Per-sender + daily token budget | No | No |
| **Discovery** | `/.well-known/agent.json` | Tool manifest | Agent card + registry |
| **Communication modes** | Sync, async (task), SSE stream | Request-response (JSON-RPC) | Sync, async (task), SSE stream |
| **Delegation** | Signed JWT with depth limit | N/A | Deferred to infrastructure |
| **Injection defense** | Regex + optional LLM classifier | N/A | N/A |
| **Auth infrastructure** | None required (key-based) | Developer-managed | OAuth/OIDC provider required |
| **Setup complexity** | npm install + serve | npm install + configure | OAuth + registry + deploy |
| **SDK languages** | TypeScript | Python, TypeScript, others | Python, TypeScript |

## What SAMVAD Doesn't Do

Honesty matters more than marketing. Here's what SAMVAD doesn't cover today:

**No Python SDK yet.** The reference implementation is TypeScript only. If your agent ecosystem is Python-first, you're either wrapping HTTP calls manually or waiting.

**Regex-only injection scanning by default.** The built-in scanner catches obvious patterns but adaptive attacks bypass it. The optional LLM classifier hook exists for stronger detection, but out of the box, don't treat passing the scanner as a security proof.

**Young ecosystem.** MCP has Anthropic's backing and a large community. A2A has Google's. SAMVAD is an open-source project. The protocol is stable and the SDK is tested, but the ecosystem of agents and integrations is early.

## When to Use What

**Use MCP** when you're connecting an LLM to tools -- databases, APIs, code execution, file systems. It does this well and has broad ecosystem support.

**Use A2A** when you're building agent workflows within an enterprise that already has OAuth infrastructure and service registries. The protocol handles complex orchestration patterns at scale.

**Use SAMVAD** when you want to put agents on the internet and have them talk to each other securely with minimal setup. When your identity is your domain, not an OAuth token. When you want the SDK to handle signing, replay protection, and rate limiting so you can focus on what your agent actually does.

The three protocols aren't really competing. They occupy different points in the design space. Pick the one that matches your topology.

---

SAMVAD is open source under Apache 2.0. The code, documentation, and runnable examples are at [github.com/w3rc/samvad](https://github.com/w3rc/samvad). The live registry is at [samvad.dev](https://samvad.dev).
