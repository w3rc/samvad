# LLM Injection Classifier — Design Spec

**Date:** 2026-04-11

## Goal

Add an opt-in, developer-supplied LLM-based injection classifier to the SAMVAD SDK as a second defense layer on top of the existing regex scanner.

## Background

The current `injection-scanner.ts` uses 10 regex patterns. The source file itself documents that adaptive attacks bypass regex >90% of the time. The fix is an opt-in hook where the developer wires in their own classifier (OpenAI moderation API, local Ollama, LLM Guard sidecar, or anything else). The SDK stays lean — no new runtime dependencies.

---

## Architecture

### API surface

`injectionClassifier` is an optional field on `AgentOptions`:

```typescript
export type InjectionClassifier = (payload: Record<string, unknown>) => boolean | Promise<boolean>

interface AgentOptions {
  // ... existing fields
  injectionClassifier?: InjectionClassifier
}
```

Returns `true` = injection detected → request rejected. Returns `false` = clean → request proceeds.

The type is exported from `@samvad-protocol/sdk` so developers get autocomplete and type safety.

### Request pipeline

```
verify signature
  → rate limit check
    → nonce check
      → zod schema validation
        → regex scan (existing, always runs)
          → LLM classifier (runs only if injectionClassifier is configured)
            → skill handler
```

The LLM classifier runs after the regex scan. If regex already catches the injection, the LLM call is never made. The skill handler never runs if either check returns `true`.

### Error response on detection

HTTP 400:

```json
{
  "status": "error",
  "error": {
    "code": "INJECTION_DETECTED",
    "message": "Input failed injection scan"
  }
}
```

### Failure behavior

If the classifier throws (network error, API timeout, etc.), the SDK **fails open**: logs a warning to the Fastify logger and lets the request through. Rationale: a flaky LLM API should not DoS the agent.

Developers who want fail-closed behavior implement it inside their classifier:

```typescript
injectionClassifier: async (payload) => {
  try {
    const res = await openai.moderations.create({ input: JSON.stringify(payload) })
    return res.results[0].flagged
  } catch {
    return true // fail closed: block on error
  }
}
```

---

## Files changed

| File | Change |
|------|--------|
| `packages/sdk-typescript/src/types.ts` | Add `InjectionClassifier` type, add `injectionClassifier` to `AgentOptions` |
| `packages/sdk-typescript/src/agent.ts` | Accept and store `injectionClassifier` from options |
| `packages/sdk-typescript/src/server.ts` | Call classifier in request pipeline after regex scan |
| `packages/sdk-typescript/src/index.ts` | Export `InjectionClassifier` type |
| `packages/sdk-typescript/tests/server.test.ts` | Tests: classifier called, blocks on true, passes on false, fails open on throw |
| `README.md` | New "Injection defense" section with OpenAI and Ollama examples |

---

## README section (to be added)

````markdown
## Injection defense

The SDK runs a regex-based injection scan on every incoming payload. For high-trust skills, add a second LLM-based layer:

```typescript
import OpenAI from 'openai'
const openai = new OpenAI()

const agent = new Agent({
  injectionClassifier: async (payload) => {
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
    const { response } = await res.json()
    return response.trim().toUpperCase().startsWith('YES')
  },
})
```

The classifier receives the raw skill input object. Return `true` to block the request (HTTP 400, `INJECTION_DETECTED`). If the classifier throws, the SDK fails open and logs a warning — to fail closed, catch errors inside your function and return `true`.
````

---

## Out of scope

- Built-in adapters for specific providers (OpenAI, Ollama) — YAGNI, the escape hatch covers all cases
- Skill-level classifier override — agent-level only for now
- Streaming the payload to the classifier — full payload is passed as a single object
