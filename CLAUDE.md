# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SAMVAD — **S**ecure **A**gent **M**essaging, **V**erification **A**nd **D**iscovery. Tagline: *The Open Sovereign Agent Dialogue Protocol*. The name is also the Sanskrit word (संवाद) for "dialogue between parties." An agent-to-agent protocol with a reference TypeScript SDK. npm workspaces monorepo: `packages/sdk-typescript` (the SDK, published as `@samvad-protocol/sdk`) and `examples/basic-agent-ts` (runnable demo).

## Commands

All commands run from the repo root unless noted.

- `npm test --workspaces` — run all workspace tests (Vitest)
- `npm run build --workspaces` — build all workspaces (tsc)
- `npm test -w @samvad-protocol/sdk` — run just the SDK test suite
- `npx vitest run tests/signing.test.ts -w @samvad-protocol/sdk` — run a single test file
- `npx vitest -w @samvad-protocol/sdk` — watch mode for the SDK
- `npm start -w basic-agent-ts` — run the example agent on port 3002 (uses `tsx`)

The SDK is ESM-only (`"type": "module"`, `module: NodeNext`). Internal imports must use the `.js` extension even when importing `.ts` sources (e.g. `import { Agent } from './agent.js'`). `tsc` emits to `dist/`; tests run against `src/` directly via Vitest.

## Architecture

The SDK is organized around a single `Agent` class that composes focused, independently-testable modules. Entry point: `packages/sdk-typescript/src/index.ts`.

**Agent lifecycle (`agent.ts` → `server.ts`):** `new Agent(config).skill(...).trustPeer(...).serve()`. On `serve()`, the agent loads or generates an Ed25519 keypair from `keysDir` (default `.samvad/keys/`), builds an `AgentCard` advertising skills/keys/rate limits, then starts a Fastify server. The card is published at `/.well-known/agent.json`; other endpoints (`/agent/message`, `/agent/task`, `/agent/task/:taskId`, `/agent/stream`, `/agent/health`, `/agent/intro`) live under `/agent/*`.

**Request pipeline (`server.ts` `verifyIncoming`):** Every inbound envelope is validated in a fixed order chosen for cost and correctness — cheap rejections first, expensive ones last:
1. Nonce + timestamp (`NonceStore`, 5-min window, replay protection)
2. Rate limit (`RateLimiter`, sliding-window per sender + daily token budget)
3. Ed25519 signature verify (`signing.ts`, against `knownPeers` cache)
4. Prompt-injection scan on the payload (`injection-scanner.ts`) — **only after auth** so untrusted input is never scanned before being proven to come from a known peer
5. Trust tier enforcement from the `SkillDef` (`public` / `authenticated` / `trusted-peers`)

This ordering is deliberate; reordering these steps (e.g. scanning before verifying) changes the security posture. Preserve it when adding middleware.

**Skill dispatch (`skill-registry.ts`):** Skills are declared with Zod input/output schemas. On registration, Zod schemas are converted to JSON Schema via `zodToJsonSchema` for the AgentCard; at dispatch time, input is validated with `safeParse` and the handler receives the parsed, typed value plus a `SkillContext` (`sender`, `traceId`, `spanId`, `delegationToken`). Schema failures surface as `SCHEMA_INVALID`; unknown skills as `SKILL_NOT_FOUND`.

**Envelope signing (`signing.ts`):** Envelopes are signed over a recursive canonical JSON form (sorted keys at every level) of all fields except `signature`. Any field added to `MessageEnvelope` automatically becomes part of the signed payload — no allowlist to update — but **the canonical form must remain stable**, so avoid non-deterministic serialization (e.g. `Map`, `Set`, `undefined` values in objects).

**Communication modes:** Three modes share the same verify pipeline but differ in delivery — `sync` (`POST /agent/message`, response in body), `async` (`POST /agent/task` → 202 + `taskId`, dispatched via `setImmediate` so the HTTP response flies before the handler runs; optional `callbackUrl` webhook; polling via `GET /agent/task/:taskId`; state in `TaskStore` with a 1h TTL), and `stream` (`POST /agent/stream`, SSE via `stream.ts` with a 15s keep-alive).

**Client (`agent-client.ts`):** `AgentClient.prepare()` creates a keypair without connecting (needed when the target agent must `trustPeer(publicKey)` before any call is possible); `AgentClient.from(url)` is prepare+connect in one call. `connect()` fetches the remote `AgentCard`. `call()` does sync, `task()`/`taskAndPoll()` do async, `stream()` is an async generator over SSE chunks. The client signs with its own keypair stored under `.samvad/client-keys/` by default.

**Delegation (`delegation.ts`):** EdDSA-signed JWTs (via `jose`) carrying `scope`, `maxDepth`, and an optional RFC 8693 `act` claim for chained delegation. `jose` requires a `CryptoKey`, so raw Ed25519 keys are imported via `SubtleCrypto.importKey('jwk', ...)`. Tokens passed as `envelope.delegationToken` are verified by the receiver against the issuer's advertised public key; depth is decremented and checked on each hop.

**Error model (`errors.ts`):** All protocol errors throw `SamvadError` with a code from `ErrorCode`. `server.ts#statusCodeFor` maps codes to HTTP (429 for rate/budget, 404 for missing skill, 401 for auth/replay, 400 for other protocol errors, 500 for uncaught).

## Conventions

- **Keys are secrets.** `.samvad/` is gitignored; never commit anything under it. Key files are Ed25519 private keys.
- **Tests target `src/` directly**, not `dist/`. No build step is required before `npm test`.
- **Injection scanning is a first-pass only.** The regex list in `injection-scanner.ts` is documented as best-effort; adaptive attacks bypass regex-based detection. Don't treat passing the scanner as a safety proof.
- **Test style:** Vitest with `globals: true`. Tests live in `packages/sdk-typescript/tests/` and mirror `src/` filenames (e.g. `signing.ts` ↔ `signing.test.ts`).
