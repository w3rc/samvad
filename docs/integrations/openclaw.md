# SAMVAD + OpenClaw Integration

OpenClaw is a self-hosted AI agent runtime that can run on your own machine. The Claw SAMVAD agent acts as a signed-envelope bridge: any agent in the SAMVAD network sends a request to Claw, and Claw forwards it to your local OpenClaw gateway and returns the response. This gives your personal OpenClaw instance a sovereign identity, a discoverable agent card, and full SAMVAD protocol compatibility.

```
SAMVAD caller (any agent)
        │
   POST /agent/message  (signed envelope)
        │
   Claw agent  ─── deployed on Vercel
        │
   POST /v1/chat/completions  (OpenAI-compatible)
        │
   OpenClaw Gateway  ─── running on your machine
        │
   your LLM (configured in OpenClaw)
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| OpenClaw 2026.3 or later | Install via npm: `npm install -g openclaw@latest` |
| Node.js 20+ | Required by OpenClaw |
| A Vercel account | Free Hobby tier is sufficient |
| Public HTTPS URL for your gateway | Tailscale Funnel (recommended), Cloudflare Tunnel, or ngrok |

---

## 1. Install and onboard OpenClaw

If you haven't installed OpenClaw yet:

```bash
npm install -g openclaw@latest
openclaw onboard
```

`onboard` walks you through gateway setup, LLM provider, and initial configuration interactively. It creates `~/.openclaw/openclaw.json` and starts the gateway as a background systemd service (Linux) or launchd agent (macOS).

If OpenClaw is already running, verify the gateway is live:

```bash
curl http://localhost:18789/health
# {"ok":true,"status":"live"}
```

---

## 2. Enable the OpenAI-compatible HTTP API

The `/v1/chat/completions` endpoint is disabled by default. Add the following to `~/.openclaw/openclaw.json` under the `gateway` key:

```json
{
  "gateway": {
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  }
}
```

Using the Python one-liner (safe in-place edit):

```bash
python3 -c "
import json, sys
with open('/home/$USER/.openclaw/openclaw.json') as f:
    cfg = json.load(f)
cfg.setdefault('gateway', {}).setdefault('http', {}).setdefault('endpoints', {})['chatCompletions'] = {'enabled': True}
with open('/home/$USER/.openclaw/openclaw.json', 'w') as f:
    json.dump(cfg, f, indent=2)
print('done')
"
```

Restart the gateway to pick up the change:

```bash
# systemd (Linux)
systemctl --user restart openclaw-gateway

# launchd (macOS)
launchctl kickstart -k gui/$(id -u)/openclaw-gateway

# manual (if not running as a service)
openclaw gateway --restart
```

Verify the endpoint is live:

```bash
curl -s http://localhost:18789/health
# {"ok":true,"status":"live"}
```

---

## 3. Note your gateway token

The gateway token is in `~/.openclaw/openclaw.json` under `gateway.auth.token`. You need it for Claw to authenticate:

```bash
python3 -c "
import json
with open('/home/$USER/.openclaw/openclaw.json') as f:
    cfg = json.load(f)
print(cfg['gateway']['auth']['token'])
"
```

Keep this value — it becomes the `OPENCLAW_GATEWAY_TOKEN` environment variable.

---

## 4. Authentication model

OpenClaw's HTTP API uses **two-layer authentication**:

1. **Bearer token** — `Authorization: Bearer <gateway_token>` identifies the caller as an operator
2. **Scope header** — `x-openclaw-scopes: operator.write` declares the capabilities being requested

Both are required. Sending the bearer token alone returns:

```json
{"ok": false, "error": {"type": "forbidden", "message": "missing scope: operator.write"}}
```

The Claw agent's `openclaw.ts` handles this automatically. If you ever call the gateway directly, always include both headers:

```bash
curl -s http://localhost:18789/v1/chat/completions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-openclaw-scopes: operator.write" \
  -H "Content-Type: application/json" \
  -d '{"model":"openclaw","messages":[{"role":"user","content":"ping"}]}'
```

---

## 5. Expose the gateway publicly

The OpenClaw gateway binds to `127.0.0.1` by default. Claw on Vercel needs a public HTTPS URL to reach it. Choose one option:

### Option A: Tailscale Funnel (recommended)

Tailscale Funnel gives you a stable, permanent public HTTPS URL. It's built into OpenClaw.

**Requirements:** Tailscale v1.38.3+, MagicDNS enabled, HTTPS enabled, and the `funnel` node attribute granted in Tailscale admin.

Enable Tailscale Serve (proxies port 18789 to HTTPS on your tailnet):

```bash
sudo tailscale serve --bg http://127.0.0.1:18789
```

Enable Tailscale Funnel (makes it public):

```bash
sudo tailscale funnel --https=443 --bg 18789
```

Verify:

```bash
tailscale funnel status
# https://your-machine.tail1234.ts.net (Funnel on)
# |-- / proxy http://127.0.0.1:18789
```

Your public gateway URL is `https://your-machine.tail1234.ts.net`.

Find your exact URL:

```bash
tailscale status --json | python3 -c "
import sys, json
s = json.load(sys.stdin)
print('https://' + s['Self']['DNSName'].rstrip('.'))
"
```

To make the Funnel persistent across reboots, configure it in `openclaw.json`:

```json
{
  "gateway": {
    "tailscale": {
      "mode": "funnel",
      "resetOnExit": false
    }
  }
}
```

### Option B: Cloudflare Tunnel (free, stable URL)

```bash
# Install cloudflared
brew install cloudflared          # macOS
# or download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# Start the tunnel
cloudflared tunnel --url http://localhost:18789
```

Cloudflare prints a stable `*.trycloudflare.com` URL. Use it as your gateway URL.

For a permanent URL, create a named tunnel via the Cloudflare dashboard and add:

```bash
cloudflared tunnel run my-openclaw-tunnel
```

### Option C: ngrok (simplest, URL changes on free plan)

```bash
ngrok http 18789
```

The printed `https://*.ngrok.io` URL changes every time ngrok restarts unless you have a reserved domain (paid plan).

---

## 6. Test the public endpoint

From any machine (not just localhost), verify the gateway is reachable:

```bash
curl -s https://YOUR_PUBLIC_URL/health
# {"ok":true,"status":"live"}

curl -s https://YOUR_PUBLIC_URL/v1/chat/completions \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-openclaw-scopes: operator.write" \
  -H "Content-Type: application/json" \
  -d '{"model":"openclaw","messages":[{"role":"user","content":"Reply with just the word pong"}]}'
# {"id":"chatcmpl_...","choices":[{"message":{"content":"pong",...}}],...}
```

---

## 7. Deploy the Claw SAMVAD agent

Clone the SAMVAD agents repo (or navigate to it if you already have it):

```bash
git clone https://github.com/w3rc/samvad-agents
cd samvad-agents/agents/claw
npm install
```

Deploy to Vercel:

```bash
vercel --prod
```

When prompted for the project name, use `samvad-agents-claw` — this matches the agent card's expected URL (`https://samvad-agents-claw.vercel.app`).

Set the required environment variables:

```bash
vercel env add OPENCLAW_GATEWAY_URL
# Enter: https://your-machine.tail1234.ts.net  (your public gateway URL from step 5)

vercel env add OPENCLAW_GATEWAY_TOKEN
# Enter: your gateway token from step 3
```

Redeploy to pick up the env vars:

```bash
vercel --prod
```

---

## 8. Verify the Claw agent

Check that the agent is healthy and sees the gateway as configured:

```bash
curl https://samvad-agents-claw.vercel.app/agent/health
```

Expected:
```json
{
  "status": "ok",
  "agent": "claw",
  "protocolVersion": "1.2",
  "openclaw": "configured"
}
```

If `openclaw` shows `"missing OPENCLAW_GATEWAY_URL"` or `"missing OPENCLAW_GATEWAY_TOKEN"`, the env vars are not set in Vercel. Recheck `vercel env ls` and redeploy.

Check the agent card:

```bash
curl https://samvad-agents-claw.vercel.app/.well-known/agent.json
```

---

## 9. Register in the SAMVAD registry

Once the agent is healthy, register it so other agents can discover it:

```bash
curl -X POST https://samvad.dev/api/register \
  -H "Content-Type: application/json" \
  -d '{"url": "https://samvad-agents-claw.vercel.app"}'
```

Expected response:

```json
{
  "id": "agent://samvad-agents-claw.vercel.app",
  "name": "Claw",
  "registeredAt": "2026-04-13T10:00:00Z"
}
```

Your OpenClaw instance is now discoverable and callable by any agent in the SAMVAD network.

---

## 10. Call Claw from another SAMVAD agent

Using the TypeScript SDK:

```typescript
import { AgentClient } from '@samvad-protocol/sdk'

const client = await AgentClient.from('https://samvad-agents-claw.vercel.app')

const result = await client.call('chat', {
  message: 'Summarise the latest AI news',
})

console.log(result.reply)
```

Raw HTTP (no SDK):

```bash
curl -X POST https://samvad-agents-claw.vercel.app/agent/message \
  -H "Content-Type: application/json" \
  -d '{
    "skill": "chat",
    "payload": {
      "message": "What is the capital of France?",
      "channel": "samvad"
    }
  }'
```

```json
{"status": "ok", "result": {"reply": "Paris.", "channel": "samvad"}}
```

### Async task mode

Submit a task and poll for the result:

```bash
# Submit
TASK=$(curl -s -X POST https://samvad-agents-claw.vercel.app/agent/task \
  -H "Content-Type: application/json" \
  -d '{"skill":"chat","payload":{"message":"Write a haiku about distributed systems"}}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['taskId'])")

echo "Task ID: $TASK"

# Poll
curl -s https://samvad-agents-claw.vercel.app/agent/task/$TASK | python3 -m json.tool
```

### Streaming mode (SSE)

```bash
curl -N -X POST https://samvad-agents-claw.vercel.app/agent/stream \
  -H "Content-Type: application/json" \
  -d '{"skill":"chat","payload":{"message":"Tell me about agent-to-agent protocols"}}'
```

Events emitted:

| Event | Payload |
|---|---|
| `status` | `{"status":"processing"}` |
| `result` | `{"status":"ok","result":{"reply":"...","channel":"..."}}"` |
| `error` | `{"status":"error","code":"AGENT_UNAVAILABLE","message":"..."}` |
| `done` | `{}` |

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `OPENCLAW_GATEWAY_URL` | Yes | Full public HTTPS URL of your OpenClaw gateway (e.g. `https://your-machine.tail1234.ts.net`) |
| `OPENCLAW_GATEWAY_TOKEN` | Yes | Bearer token from `gateway.auth.token` in `openclaw.json` |

---

## Troubleshooting

### `openclaw: "missing OPENCLAW_GATEWAY_URL"` on health check

The env var is not set in Vercel. Run `vercel env ls` to confirm. After adding it, run `vercel --prod` to redeploy.

### `status: "degraded"` on health check

Either `OPENCLAW_GATEWAY_URL` or `OPENCLAW_GATEWAY_TOKEN` is not set. The response body says which one is missing.

### `502` from `/agent/message`

Claw can reach the gateway URL but the request failed. Common causes:

- **Gateway not running** — SSH into your machine and check `systemctl --user status openclaw-gateway`
- **Wrong gateway URL** — the public URL isn't correctly pointing to port 18789. Re-run `tailscale funnel status` or equivalent.
- **Token mismatch** — the `OPENCLAW_GATEWAY_TOKEN` doesn't match `gateway.auth.token` in `openclaw.json`

### `{"ok":false,"error":{"type":"forbidden","message":"missing scope: operator.write"}}`

You're calling the gateway directly without the `x-openclaw-scopes: operator.write` header. The Claw agent adds this automatically. If you're testing with curl, add `-H "x-openclaw-scopes: operator.write"`.

### `{"error":{"message":"Unauthorized","type":"unauthorized"}}`

The bearer token is wrong or expired. Verify that `OPENCLAW_GATEWAY_TOKEN` matches the `gateway.auth.token` value in `~/.openclaw/openclaw.json` on your machine.

### Tailscale Funnel: `Access denied: serve config denied`

Funnel requires the `funnel` node attribute in your Tailscale account. Enable it in the Tailscale admin console under the machine's settings, or run `sudo tailscale funnel --bg 443`.

### Gateway only reachable from tailnet, not the public internet

Tailscale Serve (`serve`) and Tailscale Funnel (`funnel`) are different:

- **Serve** = accessible within your tailnet only
- **Funnel** = accessible from the public internet

Make sure you ran `tailscale funnel`, not just `tailscale serve`. Confirm with `tailscale funnel status` — you should see `(Funnel on)` next to the URL.

### The gateway is running but `/v1/chat/completions` returns 404 or the Control UI HTML

The `chatCompletions` endpoint is not enabled. Verify `openclaw.json` contains:

```json
"http": {
  "endpoints": {
    "chatCompletions": { "enabled": true }
  }
}
```

And that the gateway was restarted after the config change.

---

## Security notes

- **The gateway token grants full operator access.** Anyone with it can run arbitrary prompts on your OpenClaw instance. Keep it secret and treat it like an SSH key.
- **Tailscale Funnel is public.** The gateway is reachable from the internet. The bearer token + scope header combination is your only auth layer. OpenClaw rate-limits failed auth attempts automatically.
- **Do not expose the gateway on `bind: "lan"` without auth.** The default `bind: "loopback"` + Tailscale Funnel is the safe configuration.
- **Rotate your gateway token if compromised.** Generate a new random token, update `gateway.auth.token` in `openclaw.json`, restart the gateway, and update the `OPENCLAW_GATEWAY_TOKEN` env var in Vercel.
