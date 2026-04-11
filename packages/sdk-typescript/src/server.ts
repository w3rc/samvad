// SPDX-License-Identifier: Apache-2.0
import Fastify from 'fastify'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { AgentCard, MessageEnvelope, ResponseEnvelope, InjectionClassifier } from './types.js'
import type { SkillRegistry } from './skill-registry.js'
import type { TaskStore } from './task-store.js'
import type { RateLimiter } from './rate-limiter.js'
import type { NonceStore } from './nonce-store.js'
import type { Keypair } from './keys.js'
import { verifyRequest } from './signing.js'
import { verifyDelegationToken } from './delegation.js'
import { scanObjectForInjection } from './injection-scanner.js'
import { SamvadError, ErrorCode } from './errors.js'
import { startSSE, sendSSEChunk, sendSSEKeepAlive, endSSE } from './stream.js'

// Extend FastifyRequest to carry the raw body buffer (captured by the content-type parser)
declare module 'fastify' {
  interface FastifyRequest {
    rawBody: Buffer | null
  }
}

export interface ServerOptions {
  card: AgentCard
  registry: SkillRegistry
  keypair: Keypair
  taskStore: TaskStore
  rateLimiter: RateLimiter
  nonceStore: NonceStore
  introText: string
  knownPeers: Map<string, Uint8Array>  // agentId -> publicKey cache
  injectionClassifier?: InjectionClassifier
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false })

  // Capture raw body bytes before Fastify's default JSON parsing.
  // Required for RFC 9421 Content-Digest verification.
  app.decorateRequest('rawBody', null)
  app.addContentTypeParser<Buffer>(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      req.rawBody = body
      try {
        done(null, JSON.parse(body.toString('utf-8')))
      } catch (e) {
        done(e as Error, null)
      }
    },
  )

  // ── GET /.well-known/agent.json ──────────────────────────────────────────
  app.get('/.well-known/agent.json', async (_req, reply) => {
    reply.header('Cache-Control', `public, max-age=${opts.card.cardTTL}`)
    return opts.card
  })

  // ── GET /agent/health ────────────────────────────────────────────────────
  app.get('/agent/health', async () => {
    return {
      status: 'ok',
      protocolVersion: '1.2',
      agentVersion: opts.card.version,
      uptime: process.uptime(),
    }
  })

  // ── GET /agent/intro ─────────────────────────────────────────────────────
  app.get('/agent/intro', async (_req, reply) => {
    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    return opts.introText
  })

  // ── Shared: verify incoming envelope (RFC 9421 signature path) ──────────
  async function verifyIncoming(req: FastifyRequest, envelope: MessageEnvelope): Promise<void> {
    // 1. Nonce + timestamp check (cheap, fast rejection)
    const nonceResult = opts.nonceStore.check(envelope.nonce, envelope.timestamp)
    if (nonceResult === 'expired') throw new SamvadError(ErrorCode.AUTH_FAILED, 'Message timestamp expired')
    if (nonceResult === 'replay') throw new SamvadError(ErrorCode.REPLAY_DETECTED, 'Nonce already seen')

    // 2. Rate limit (protects downstream work)
    opts.rateLimiter.check(envelope.from)

    // 3. RFC 9421 signature verification (expensive — only after cheap checks pass)
    const pubKey = opts.knownPeers.get(envelope.from)
    if (!pubKey) {
      throw new SamvadError(ErrorCode.AUTH_FAILED, `Unknown sender: ${envelope.from}`)
    }
    if (!req.rawBody) {
      throw new SamvadError(ErrorCode.AUTH_FAILED, 'Raw body unavailable for signature verification')
    }
    const contentDigest = req.headers['content-digest'] as string | undefined
    const signatureInput = req.headers['signature-input'] as string | undefined
    const signature = req.headers['signature'] as string | undefined
    if (!contentDigest || !signatureInput || !signature) {
      throw new SamvadError(ErrorCode.AUTH_FAILED, 'Missing RFC 9421 signature headers (Content-Digest, Signature-Input, Signature)')
    }
    const valid = await verifyRequest(
      req.method, req.url!,
      req.rawBody,
      { 'content-digest': contentDigest, 'signature-input': signatureInput, 'signature': signature },
      pubKey,
    )
    if (!valid) throw new SamvadError(ErrorCode.AUTH_FAILED, 'Invalid message signature')

    // 4. Delegation token verification (when present)
    if (envelope.delegationToken) {
      const parts = envelope.delegationToken.split('.')
      let issuer: string | undefined
      if (parts.length === 3) {
        try {
          const rawPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
          issuer = rawPayload.iss
        } catch {
          // malformed payload — handled below
        }
      }
      if (!issuer) {
        throw new SamvadError(ErrorCode.AUTH_FAILED, 'Malformed delegation token')
      }
      const issuerKey = opts.knownPeers.get(issuer)
      if (!issuerKey) {
        throw new SamvadError(ErrorCode.AUTH_FAILED, `Unknown delegation token issuer: ${issuer}`)
      }
      const claims = await verifyDelegationToken(envelope.delegationToken, issuerKey)
      if (!claims.scope.includes(envelope.skill)) {
        throw new SamvadError(ErrorCode.DELEGATION_EXCEEDED,
          `Delegation token scope does not include skill '${envelope.skill}'`)
      }
    }

    // 5. Injection scan — regex first pass (fast, free), then optional LLM classifier
    if (scanObjectForInjection(envelope.payload)) {
      throw new SamvadError(ErrorCode.INJECTION_DETECTED, 'Potential prompt injection detected in payload')
    }
    if (opts.injectionClassifier) {
      try {
        const flagged = await opts.injectionClassifier(envelope.payload)
        if (flagged) {
          throw new SamvadError(ErrorCode.INJECTION_DETECTED, 'Input failed injection scan')
        }
      } catch (err) {
        if (err instanceof SamvadError) throw err
        // Classifier threw (network error, API down, etc.) — fail open
        // app.log is pino with logger:false → level 'silent', so fall back to console
        const msg = `[SAMVAD] injectionClassifier threw — failing open: ${(err as Error).message}`
        if (app.log.level !== 'silent') { app.log.warn({ err }, msg) } else { console.warn(msg) }
      }
    }

    // 6. Trust tier enforcement — skill must exist before checking its trust tier
    const skillDef = opts.registry.getSkill(envelope.skill)?.def
    if (!skillDef) {
      throw new SamvadError(ErrorCode.SKILL_NOT_FOUND, `Skill '${envelope.skill}' not found`)
    }
    if (skillDef.trust === 'authenticated') {
      if (!envelope.auth?.token) throw new SamvadError(ErrorCode.AUTH_FAILED, 'Bearer token required')
    }
    if (skillDef.trust === 'trusted-peers') {
      const allowed = skillDef.allowedPeers ?? []
      if (!allowed.includes(envelope.from)) {
        throw new SamvadError(ErrorCode.AUTH_FAILED, `Sender ${envelope.from} not in trusted-peers list`)
      }
    }
  }

  function errorResponse(err: unknown, traceId: string, spanId: string): ResponseEnvelope {
    if (err instanceof SamvadError) {
      return { traceId, spanId, status: 'error', error: err.toJSON() }
    }
    return { traceId, spanId, status: 'error', error: { code: ErrorCode.AGENT_UNAVAILABLE, message: String(err) } }
  }

  function statusCodeFor(err: unknown): number {
    if (err instanceof SamvadError) {
      if (err.code === ErrorCode.RATE_LIMITED || err.code === ErrorCode.TOKEN_BUDGET_EXCEEDED) return 429
      if (err.code === ErrorCode.SKILL_NOT_FOUND) return 404
      if (err.code === ErrorCode.AUTH_FAILED || err.code === ErrorCode.REPLAY_DETECTED) return 401
      return 400
    }
    return 500
  }

  // ── POST /agent/message (sync) ───────────────────────────────────────────
  app.post<{ Body: MessageEnvelope }>('/agent/message', async (req, reply) => {
    const env = req.body
    const spanId = randomUUID()
    try {
      await verifyIncoming(req, env)
      const result = await opts.registry.dispatch(env.skill, env.payload, {
        sender: env.from, traceId: env.traceId, spanId, delegationToken: env.delegationToken,
      })
      reply.status(200)
      return { traceId: env.traceId, spanId, status: 'ok', result: result as Record<string, unknown> } satisfies ResponseEnvelope
    } catch (err) {
      reply.status(statusCodeFor(err))
      return errorResponse(err, env.traceId, spanId)
    }
  })

  // ── POST /agent/task (async) ─────────────────────────────────────────────
  app.post<{ Body: MessageEnvelope & { callbackUrl?: string } }>('/agent/task', async (req, reply) => {
    const env = req.body
    const spanId = randomUUID()

    // Validate callbackUrl before doing any work — prevents SSRF via internal URLs
    if (env.callbackUrl !== undefined) {
      let parsedCallback: URL
      try {
        parsedCallback = new URL(env.callbackUrl)
      } catch {
        reply.status(400)
        return errorResponse(new SamvadError(ErrorCode.SCHEMA_INVALID, 'callbackUrl is not a valid URL'), env.traceId, spanId)
      }
      if (parsedCallback.protocol !== 'https:') {
        reply.status(400)
        return errorResponse(new SamvadError(ErrorCode.SCHEMA_INVALID, 'callbackUrl must use https'), env.traceId, spanId)
      }
    }

    try {
      await verifyIncoming(req, env)
    } catch (err) {
      reply.status(statusCodeFor(err))
      return errorResponse(err, env.traceId, spanId)
    }

    const task = opts.taskStore.create()
    reply.status(202)

    // Run asynchronously — must use setImmediate so Fastify returns 202 before handler runs
    setImmediate(async () => {
      opts.taskStore.setRunning(task.taskId, 0)
      try {
        const result = await opts.registry.dispatch(env.skill, env.payload, {
          sender: env.from, traceId: env.traceId, spanId, delegationToken: env.delegationToken,
        })
        opts.taskStore.setDone(task.taskId, result as Record<string, unknown>)
        if (env.callbackUrl) {
          const response: ResponseEnvelope = {
            traceId: env.traceId, spanId, status: 'ok',
            result: result as Record<string, unknown>,
          }
          fetch(env.callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(response),
          }).catch(() => { /* caller can poll /agent/task/:taskId as fallback */ })
        }
      } catch (err) {
        const error = err instanceof SamvadError ? err.toJSON() : { code: ErrorCode.AGENT_UNAVAILABLE, message: String(err) }
        opts.taskStore.setFailed(task.taskId, error)
      }
    })

    return { taskId: task.taskId, status: 'accepted' }
  })

  // ── GET /agent/task/:taskId ──────────────────────────────────────────────
  app.get<{ Params: { taskId: string } }>('/agent/task/:taskId', async (req, reply) => {
    const task = opts.taskStore.get(req.params.taskId)
    if (!task) {
      reply.status(404)
      return { error: 'Task not found' }
    }
    return task
  })

  // ── POST /agent/stream (SSE) ─────────────────────────────────────────────
  app.post<{ Body: MessageEnvelope }>('/agent/stream', async (req, reply) => {
    const env = req.body
    const spanId = randomUUID()
    try {
      await verifyIncoming(req, env)
    } catch (err) {
      reply.status(statusCodeFor(err))
      return errorResponse(err, env.traceId, spanId)
    }

    startSSE(reply)
    const keepAlive = setInterval(() => sendSSEKeepAlive(reply), 15_000)

    try {
      const result = await opts.registry.dispatch(env.skill, env.payload, {
        sender: env.from, traceId: env.traceId, spanId, delegationToken: env.delegationToken,
      })
      sendSSEChunk(reply, { done: true, result, traceId: env.traceId, spanId })
    } catch (err) {
      const error = err instanceof SamvadError ? err.toJSON() : { code: ErrorCode.AGENT_UNAVAILABLE, message: String(err) }
      sendSSEChunk(reply, { done: true, error, traceId: env.traceId, spanId })
    } finally {
      clearInterval(keepAlive)
      endSSE(reply)
    }
  })

  return app
}
