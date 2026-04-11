# Agent Playground — Design Spec

**Date:** 2026-04-11
**Status:** Approved
**Repos:** `w3rc/samvadprotocol` (registry), `w3rc/samvad-agents` (Scout CORS fix)

---

## 1. Purpose

Let anyone try a registered agent's skills directly from the registry, without writing any code. A "Try it" button in the Detail Panel opens a full-screen modal where users pick a skill, fill in the inputs, and see the live JSON response.

---

## 2. User Flow

1. User opens an agent's Detail Panel in the registry.
2. Clicks **"Try it"** button at the top of the panel.
3. Full-screen `PlaygroundModal` opens.
4. Modal immediately pings `{agent.url}/agent/health`.
5. **Ping succeeds** → skill form shown, calls `{agent.url}/agent/message`.
6. **Ping fails + `playgroundUrl` exists in card** → skill form shown with a "Using sandbox endpoint" banner, calls `playgroundUrl`.
7. **Ping fails + no `playgroundUrl`** → "Agent unreachable" state, no form.
8. User selects a skill tab, fills inputs, clicks **Run**.
9. POST to endpoint: `{ "skill": "<id>", "payload": { ...inputs } }`.
10. Response shown as pretty-printed JSON with HTTP status and latency.

---

## 3. `playgroundUrl` Field

An optional extension field agents can declare in `/.well-known/agent.json`:

```json
{
  "playgroundUrl": "https://samvad-scout-sandbox.vercel.app/agent/message"
}
```

Stored in the registry DB as part of the `card` JSONB column (no schema migration needed — it's already freeform). Read at render time as `(card as any).playgroundUrl`. Allows operators to expose a stable sandbox/demo endpoint that stays reachable even if the main agent goes down.

---

## 4. Modal Layout

**Mobile (< 768px):** Single column — skill tabs → input form → run button → output below.

**Desktop (≥ 768px):** Two-column split — left column has skill tabs + input form + run button; right column has response output. Both columns visible simultaneously.

**Modal chrome:**
- Full-screen overlay with dark backdrop
- Header: agent avatar initial + name + `agent://` ID + close button (×)
- Close on backdrop click or × button

---

## 5. Skill Selector

Skill tabs rendered from `card.skills`. Active tab highlighted in indigo. Switching tabs resets the input form and clears the response pane.

---

## 6. Input Form

Generated from the active skill's `inputSchema.properties`. Each property becomes a labelled text `<input>`. Required fields (from `inputSchema.required`) marked with a red asterisk. All inputs are plain text — no special handling for non-string types at this stage.

---

## 7. Error States

| State | Condition | UI |
|---|---|---|
| **Pinging** | On modal open, before health response | Spinner with "Checking agent…" |
| **Unreachable** | Ping fails, no `playgroundUrl` | Yellow banner: "Agent is currently unreachable." No form shown. |
| **Sandbox** | Ping fails, `playgroundUrl` exists | Green banner: "Main endpoint unreachable — calling sandbox." Form shown. |
| **CORS blocked** | Fetch throws a network/CORS error | Red banner: "CORS blocked. Ask the operator to add: `Access-Control-Allow-Origin: *`" |
| **HTTP error** | Response with non-2xx status | Response pane shows status code + error JSON |
| **Success** | 2xx response | Response pane shows HTTP status, latency (ms), pretty-printed JSON |

---

## 8. Response Pane

- HTTP status badge (green for 2xx, red otherwise) + latency in ms
- Pretty-printed JSON with basic syntax colouring:
  - Keys: indigo
  - Strings: amber
  - `"ok"` / `true`: green
  - `"error"` / `false`: red
- Monospace font, scrollable if tall

---

## 9. Files Changed

### `w3rc/samvadprotocol` (samvad-registry)

| File | Change |
|---|---|
| `components/PlaygroundModal.tsx` | **New** — full modal component |
| `components/DetailPanel.tsx` | Add "Try it" button at top, `onTry` prop |
| `app/registry/page.tsx` | Add `playgroundAgent` state, render `PlaygroundModal`, pass `onTry` to `DetailPanel` |

### `w3rc/samvad-agents` (Scout)

| File | Change |
|---|---|
| `agents/scout/app/agent/message/route.ts` | Add CORS headers + OPTIONS preflight handler |

---

## 10. CORS Headers (Scout)

Added to `POST /agent/message` response and OPTIONS preflight:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

An `export function OPTIONS()` handler returns 204 with these headers so browsers can complete preflight checks.

---

## 11. Out of Scope

- "Try it" button on agent cards in the grid — Detail Panel only
- Non-text input types (file upload, number pickers, dropdowns)
- Saving or sharing playground requests
- Auth token input for `authenticated` or `trusted-peers` skills
- Streaming skill support (`stream` mode)
