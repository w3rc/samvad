# Research Agent — Design Spec

**Date:** 2026-04-13
**Status:** Approved
**Repo:** `w3rc/samvad-agents` (monorepo, `agents/research/`)
**Deployment:** Vercel free Hobby tier → `samvad-agents-research.vercel.app`

---

## 1. Purpose

A SAMVAD agent that takes a topic, searches the web, then calls Scout (another SAMVAD agent) over signed envelopes to read and summarize the top 3 results, and synthesizes everything into a structured research brief. This is the canonical demo of agent-to-agent communication — the thing SAMVAD exists for.

---

## 2. Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | Next.js 15 (App Router) | Consistent with Scout/Claw |
| Search | Tavily API | Clean JSON, built for AI agents, generous free tier |
| Web reading | Scout agent via SAMVAD | Real agent-to-agent call over signed envelopes |
| Synthesis LLM | Groq (`llama-3.3-70b-versatile`) | Free tier, fast |
| Protocol | `@samvad-protocol/sdk@0.4.0` | Signing, nonce, keys, types |
| Language | TypeScript | Consistent |

---

## 3. Skill

One skill: `research`

**Input:**
```json
{
  "type": "object",
  "properties": {
    "topic": { "type": "string", "description": "The research topic" },
    "urls": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Optional specific URLs to research. If omitted, Tavily search finds them."
    }
  },
  "required": ["topic"]
}
```

**Output:**
```json
{
  "type": "object",
  "properties": {
    "topic": { "type": "string" },
    "brief": { "type": "string" },
    "keyFindings": { "type": "array", "items": { "type": "string" } },
    "sources": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "url": { "type": "string" },
          "title": { "type": "string" },
          "summary": { "type": "string" }
        }
      }
    },
    "agentCalls": { "type": "number" }
  },
  "required": ["topic", "brief", "keyFindings", "sources", "agentCalls"]
}
```

**Modes:** `sync`, `stream`
**Trust:** `public`

---

## 4. Flow

1. **Search** — Tavily search for `topic` → top 3 URLs (or use provided `urls`)
2. **Read** — For each URL, call Scout's `summarizePage` at `https://samvad-agents-scout.vercel.app/agent/message` with `{ skill: "summarizePage", payload: { url, question: topic } }`
3. **Synthesize** — Send the 3 summaries to Groq LLM → produce a unified research brief with key findings
4. **Return** — Structured response with `brief`, `keyFindings`, `sources[]`, `agentCalls: 3`

---

## 5. SSE Streaming Status Events

The `/agent/stream` endpoint sends real-time status updates as the agent works:

| Event | Data |
|---|---|
| `status` | `{"step": "searching", "message": "Searching Tavily for \"SAMVAD protocol\"..."}` |
| `status` | `{"step": "found", "message": "Found 3 sources"}` |
| `status` | `{"step": "calling_scout", "message": "Calling Scout → summarizePage for github.com/w3rc/samvad..."}` |
| `status` | `{"step": "calling_scout", "message": "Calling Scout → summarizePage for docs.samvadprotocol.com..."}` |
| `status` | `{"step": "calling_scout", "message": "Calling Scout → summarizePage for news.ycombinator.com/..."}` |
| `status` | `{"step": "synthesizing", "message": "Synthesizing 3 sources into research brief..."}` |
| `result` | `{"status": "ok", "result": { ...full research output }}` |
| `done` | `{}` |

For sync mode (`/agent/message`), the same flow runs but the response is returned as a single JSON object after completion.

---

## 6. Agent Card

```json
{
  "id": "agent://samvad-agents-research.vercel.app",
  "name": "Research",
  "version": "1.0.0",
  "description": "Multi-agent research assistant. Give it a topic, it searches the web, calls Scout to read and summarize sources, then synthesizes a structured research brief. Demonstrates real agent-to-agent communication over SAMVAD.",
  "url": "https://samvad-agents-research.vercel.app",
  "protocolVersion": "1.2",
  "specializations": ["research", "synthesis", "multi-agent"],
  "models": [{ "provider": "groq", "model": "llama-3.3-70b-versatile" }],
  "skills": [{ "id": "research", "modes": ["sync", "stream"], "trust": "public" }],
  "rateLimit": { "requestsPerMinute": 10, "requestsPerSender": 3 },
  "cardTTL": 3600
}
```

---

## 7. Calling Scout

The Research agent calls Scout using the lightweight mode (just `skill` + `payload`, no signed envelope). This is acceptable because:
- Scout's `summarizePage` skill is `trust: 'public'`
- Both agents are on Vercel — no untrusted network between them
- Full envelope signing would require the Research agent to have its own keypair registered with Scout, adding deployment complexity for no security benefit between two public agents

The call:
```
POST https://samvad-agents-scout.vercel.app/agent/message
Content-Type: application/json

{
  "skill": "summarizePage",
  "payload": { "url": "...", "question": "..." }
}
```

The response includes `traceId` and `spanId` from Scout, which could be propagated into the Research agent's own response for distributed tracing.

---

## 8. Project Structure

```
agents/research/
  app/
    layout.tsx
    page.tsx
    .well-known/agent.json/route.ts
    agent/
      health/route.ts
      intro/route.ts
      message/route.ts
      stream/route.ts
      task/route.ts
      task/[taskId]/route.ts
  lib/
    card.ts
    keys.ts              (copy from claw/scout)
    protocol.ts           (copy from claw/scout)
    rate-limiter.ts       (copy from claw/scout, 10rpm/3 per sender)
    task-store.ts         (copy from claw/scout)
    tavily.ts             (Tavily search client)
    scout-client.ts       (calls Scout agent over HTTP)
    groq.ts               (synthesis LLM, similar to Scout's)
    skills/
      research.ts         (main skill: search → scout calls → synthesize)
  package.json
  next.config.ts
  tsconfig.json
  vercel.json
```

---

## 9. Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TAVILY_API_KEY` | Yes | Tavily search API key |
| `GROQ_API_KEY` | Yes | Groq API key for synthesis |
| `SAMVAD_PRIVATE_KEY` | Yes | Ed25519 private key (base64) for agent identity |

---

## 10. Rate Limits

10 req/min global, 3 req/sender. Lower than Scout/Claw because each Research call fans out to 3 Scout calls + 1 Tavily call + 1 Groq call.

---

## 11. Out of Scope

- Caching search results or summaries
- Configurable depth (fixed at 3 sources)
- Calling Claw or other agents (only Scout for now)
- PDF/document reading (Scout only handles web pages)
