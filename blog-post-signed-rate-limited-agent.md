# Signed, Rate-Limited Agent-to-Agent Messaging in 15 Lines of TypeScript

Every team building multi-agent systems ends up writing the same infrastructure code. Authentication between agents. Replay protection so a replayed message doesn't trigger the same action twice. Rate limiting so one runaway agent doesn't hammer another into the ground. Ed25519 signing so you can actually verify who sent what.

It's unglamorous work. It's also load-bearing. Skip any of it and you have agents that can be spoofed, flooded, or replayed into doing things they shouldn't.

SAMVAD is an open-source protocol and TypeScript SDK that gives you all of it out of the box.

## The code

Here is a complete agent with one skill, signed and rate-limited, ready to receive messages from other agents:

```typescript
import { Agent } from '@samvad-protocol/sdk'
import { z } from 'zod'

const agent = new Agent({
  name: 'weather-agent',
  url: 'http://localhost:3000',
  rateLimit: { requestsPerMinute: 60, requestsPerSender: 10, tokensPerSenderPerDay: 100_000 },
})

agent.skill('get-weather', {
  name: 'Get Weather',
  description: 'Returns current weather for a city',
  input: z.object({ city: z.string() }),
  output: z.object({ temp: z.number(), conditions: z.string() }),
  modes: ['sync'],
  trust: 'authenticated',
  handler: async ({ city }) => ({ temp: 22, conditions: `Sunny in ${city}` }),
})

agent.serve({ port: 3000 })
```

That's it. Fifteen lines. When `serve()` runs, the agent generates an Ed25519 keypair (or loads an existing one), publishes an AgentCard at `/.well-known/agent.json`, and starts accepting signed requests with nonce-based replay protection, per-sender rate limiting, token budgets, Zod schema validation, and injection scanning.

## Calling it

From another agent or script, calling that skill is three lines:

```typescript
import { AgentClient } from '@samvad-protocol/sdk'

const client = await AgentClient.from('http://localhost:3000')
const result = await client.call('get-weather', { city: 'Tokyo' })
// { temp: 22, conditions: 'Sunny in Tokyo' }
```

`AgentClient.from()` fetches the remote agent's card, discovers its public keys and skills, and generates a client keypair. `call()` signs the request with RFC 9421 HTTP Message Signatures, includes a nonce and timestamp, and sends it. The receiving agent verifies the signature, checks the nonce hasn't been seen in the last 5 minutes, enforces rate limits, validates the payload against the Zod schema, and runs the injection scanner -- all before your handler executes.

## What you get for free

Every SAMVAD agent ships with a fixed verification pipeline, executed in this order for every inbound request:

1. **Nonce + timestamp check** -- rejects replayed or expired messages (5-minute window)
2. **Rate limiting** -- sliding window per sender, plus daily token budgets
3. **Ed25519 signature verification** -- RFC 9421 HTTP Message Signatures over the request body
4. **Injection scanning** -- regex-based first pass, with an optional async LLM classifier as a second layer
5. **Trust tier enforcement** -- skills declare `public`, `authenticated`, or `trusted-peers` access

The ordering is deliberate. Cheap rejections run first. Expensive operations like signature verification and injection scanning run only after a message passes the fast checks. Untrusted input is never scanned before being proven to come from a known peer.

Beyond the request pipeline, you also get:

- **Three communication modes** -- synchronous (request/response), asynchronous (task queue with polling and webhooks), and streaming (SSE)
- **JWT delegation tokens** -- EdDSA-signed JWTs with scope, max depth, and chained delegation via RFC 8693 `act` claims
- **OpenTelemetry tracing** -- every envelope carries `traceId` and `spanId`
- **Auto-generated AgentCard** -- your skills, public keys, rate limits, and capabilities published at a well-known URL

## How this compares to MCP and A2A

MCP (Model Context Protocol) is good at what it does: connecting a model to tools and data sources. It's a client-server protocol. The model is the client, tools are the servers. If you need to give an LLM access to a database or an API, MCP is a solid choice.

Google's A2A (Agent-to-Agent) protocol targets enterprise orchestration -- discovery, task lifecycle, multi-turn conversations between agents in large organizations. It's comprehensive and built for scale.

SAMVAD fills a different gap. It's peer-to-peer. Any agent can call any other agent directly, without a central orchestrator. The security primitives -- signing, replay protection, rate limiting, delegation -- are built into the protocol, not bolted on as middleware. You don't need infrastructure to get started. You need `npm install` and 15 lines.

MCP doesn't give you agent-to-agent communication. A2A doesn't give you a working agent in 15 lines. These aren't competing goals. If you're building a system where agents need to talk to each other directly with mutual authentication, SAMVAD is the layer that handles that.

## Try it

Don't take my word for it. The live agent registry is running at [samvad.dev/registry](https://samvad.dev/registry). Browse connected agents, inspect their cards, and see the protocol in action.

The SDK is published and installable today:

```bash
npm install @samvad-protocol/sdk
```

A Python SDK isn't ready yet, but the protocol is language-agnostic -- any language that can do Ed25519 and HTTP can implement it.

The full source, protocol spec, and examples are on GitHub: [github.com/w3rc/samvad](https://github.com/w3rc/samvad)

If you're building multi-agent systems and tired of re-implementing the security plumbing, give it a look. The protocol is open, the SDK is Apache-2.0 licensed, and the whole thing is designed to get out of your way.
