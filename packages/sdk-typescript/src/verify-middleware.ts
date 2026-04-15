// SPDX-License-Identifier: Apache-2.0
/**
 * Framework-agnostic SAMVAD request verification middleware.
 *
 * Use this when building agents outside the SDK's built-in Agent class
 * (e.g. Next.js API routes, serverless functions, Express handlers).
 *
 * Returns plain objects — the consumer wraps them in their framework's
 * response type (NextResponse, express res.json, etc.).
 */

import { InMemoryNonceStore } from './nonce-store.js'
import type { NonceStoreAdapter } from './nonce-store.js'
import { verifyRequest } from './signing.js'
import type { RequestSignatureHeaders } from './signing.js'
import { decodePublicKey } from './keys.js'
import type { MessageEnvelope, PublicKey, SkillDef } from './types.js'
import { randomUUID } from 'node:crypto'

// ── Types ───────────────────────────────────────────────────────────────────

export interface VerifyMiddlewareConfig {
  /** The agent:// ID of this agent (used for envelope.to validation) */
  agentId: string
  /** The skills this agent offers (used for trust tier enforcement) */
  skills: SkillDef[]
  /** Rate limiter function — return { allowed: false } to reject */
  rateLimiter?: (clientIp: string) => { allowed: boolean; limit?: number }
  /** Nonce window in ms (default: 5 minutes). Ignored when nonceStore is provided. */
  nonceWindowMs?: number
  /** Custom nonce store. Use UpstashRedisNonceStore for serverless or multi-replica deployments. */
  nonceStore?: NonceStoreAdapter
  /** Peer key cache TTL in ms (default: 5 minutes) */
  peerCacheTtlMs?: number
  /** Fetch timeout for remote agent cards in ms (default: 8000) */
  fetchTimeoutMs?: number
}

export interface VerifiedRequest {
  envelope: MessageEnvelope
  spanId: string
}

export interface VerifyError {
  status: number
  code: string
  message: string
  traceId?: string
}

export type VerifyResult =
  | { ok: true; data: VerifiedRequest }
  | { ok: false; error: VerifyError }

// ── Middleware factory ───────────────────────────────────────────────────────

export function createVerifyMiddleware(config: VerifyMiddlewareConfig) {
  const nonceStore: NonceStoreAdapter = config.nonceStore ?? new InMemoryNonceStore(config.nonceWindowMs ?? 5 * 60 * 1000)
  const peerKeyCache = new Map<string, { keys: PublicKey[]; fetchedAt: number }>()
  const peerCacheTtl = config.peerCacheTtlMs ?? 5 * 60 * 1000
  const fetchTimeout = config.fetchTimeoutMs ?? 8000

  async function fetchPeerKeys(agentUrl: string): Promise<PublicKey[]> {
    const origin = new URL(agentUrl.replace('agent://', 'https://')).origin
    const cardUrl = `${origin}/.well-known/agent.json`
    const cached = peerKeyCache.get(agentUrl)
    if (cached && Date.now() - cached.fetchedAt < peerCacheTtl) return cached.keys

    try {
      const res = await fetch(cardUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(fetchTimeout),
      })
      if (!res.ok) return []
      const card = await res.json() as { publicKeys?: PublicKey[] }
      const keys = card.publicKeys ?? []
      peerKeyCache.set(agentUrl, { keys, fetchedAt: Date.now() })
      return keys
    } catch {
      return []
    }
  }

  function findSkill(skillId: string): SkillDef | undefined {
    return config.skills.find(s => s.id === skillId)
  }

  function err(status: number, code: string, message: string, traceId?: string): VerifyResult {
    return { ok: false, error: { status, code, message, traceId } }
  }

  /**
   * Verify an incoming request. Two modes:
   *
   * 1. **Full envelope** (from, to, nonce, timestamp, signatures) → full protocol verification
   * 2. **Lightweight** (just skill + payload) → rate-limited only, public skills only
   *    (for playground/curl testing)
   */
  return async function verify(
    method: string,
    path: string,
    bodyBytes: Uint8Array,
    headers: { get(name: string): string | null },
    clientIp: string,
  ): Promise<VerifyResult> {
    // Parse body
    let body: Record<string, unknown>
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes))
    } catch {
      return err(400, 'SCHEMA_INVALID', 'Invalid JSON body')
    }

    // ── Lightweight mode ──────────────────────────────────────────────────
    const isFullEnvelope = 'from' in body && 'nonce' in body && 'timestamp' in body
    if (!isFullEnvelope) {
      if (config.rateLimiter) {
        const rl = config.rateLimiter(clientIp)
        if (!rl.allowed) {
          return err(429, 'RATE_LIMITED', `Rate limit exceeded (${rl.limit ?? '?'} req/min)`)
        }
      }

      if (!body.skill || typeof body.skill !== 'string') {
        return err(400, 'SCHEMA_INVALID', 'Missing required field: skill')
      }
      if (!body.payload || typeof body.payload !== 'object') {
        return err(400, 'SCHEMA_INVALID', 'Missing required field: payload')
      }

      const skill = findSkill(body.skill as string)
      if (skill && skill.trust !== 'public') {
        return err(401, 'AUTH_FAILED', `Skill "${body.skill}" requires ${skill.trust} access — send a full signed envelope`)
      }

      const envelope: MessageEnvelope = {
        from: 'agent://anonymous',
        to: config.agentId,
        skill: body.skill as string,
        mode: 'sync',
        nonce: randomUUID(),
        timestamp: new Date().toISOString(),
        traceId: randomUUID(),
        spanId: randomUUID(),
        payload: body.payload as Record<string, unknown>,
      }
      return { ok: true, data: { envelope, spanId: randomUUID() } }
    }

    // ── Full envelope mode ────────────────────────────────────────────────
    const envelope = body as unknown as MessageEnvelope

    const missing = ['from', 'to', 'skill', 'mode', 'nonce', 'timestamp', 'traceId', 'spanId', 'payload']
      .filter(f => !(f in envelope))
    if (missing.length > 0) {
      return err(400, 'SCHEMA_INVALID', `Missing required fields: ${missing.join(', ')}`)
    }

    if (typeof envelope.from !== 'string' || !envelope.from.startsWith('agent://')) {
      return err(400, 'SCHEMA_INVALID', 'from must be an agent:// URI')
    }

    if (envelope.to !== config.agentId) {
      return err(400, 'SCHEMA_INVALID', `Invalid recipient: expected ${config.agentId}`)
    }

    // 1. Nonce + timestamp
    const nonceResult = await nonceStore.check(envelope.nonce, envelope.timestamp)
    if (nonceResult === 'expired') {
      return err(400, 'TIMESTAMP_EXPIRED', 'Request timestamp is outside the 5-minute window', envelope.traceId)
    }
    if (nonceResult === 'replay') {
      return err(401, 'REPLAY_DETECTED', 'Nonce already seen', envelope.traceId)
    }

    // 2. Rate limit
    if (config.rateLimiter) {
      const rl = config.rateLimiter(clientIp)
      if (!rl.allowed) {
        return err(429, 'RATE_LIMITED', `Rate limit exceeded (${rl.limit ?? '?'} req/min)`, envelope.traceId)
      }
    }

    // 3. Signature verification
    const contentDigest = headers.get('content-digest')
    const signatureInput = headers.get('signature-input')
    const signature = headers.get('signature')

    if (!contentDigest || !signatureInput || !signature) {
      return err(401, 'AUTH_FAILED', 'Missing signature headers (Content-Digest, Signature-Input, Signature)', envelope.traceId)
    }

    const sigHeaders: RequestSignatureHeaders = {
      'content-digest': contentDigest,
      'signature-input': signatureInput,
      'signature': signature,
    }

    const peerKeys = await fetchPeerKeys(envelope.from)
    if (peerKeys.length === 0) {
      return err(401, 'AUTH_FAILED', `Could not fetch public keys for ${envelope.from}`, envelope.traceId)
    }

    let verified = false
    for (const pk of peerKeys) {
      if (!pk.active) continue
      try {
        const pubBytes = decodePublicKey(pk.key)
        if (await verifyRequest(method, path, bodyBytes, sigHeaders, pubBytes)) {
          verified = true
          break
        }
      } catch {
        // try next key
      }
    }

    if (!verified) {
      return err(401, 'AUTH_FAILED', 'Signature verification failed', envelope.traceId)
    }

    // 4. Trust tier
    const skill = findSkill(envelope.skill)
    if (skill) {
      if (skill.trust === 'trusted-peers') {
        const allowed = skill.allowedPeers ?? []
        if (!allowed.includes(envelope.from)) {
          return err(403, 'AUTH_FAILED', `Caller ${envelope.from} is not in allowedPeers for skill "${envelope.skill}"`, envelope.traceId)
        }
      }
    }

    return {
      ok: true,
      data: { envelope, spanId: randomUUID() },
    }
  }
}
