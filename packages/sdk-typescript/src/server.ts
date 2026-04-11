// SPDX-License-Identifier: Apache-2.0
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { AgentCard, MessageEnvelope, ResponseEnvelope } from './types.js'
import type { SkillRegistry } from './skill-registry.js'
import type { TaskStore } from './task-store.js'
import type { RateLimiter } from './rate-limiter.js'
import type { NonceStore } from './nonce-store.js'
import type { Keypair } from './keys.js'
import { verifyEnvelope } from './signing.js'
import { scanObjectForInjection } from './injection-scanner.js'
import { SamvadError, ErrorCode } from './errors.js'
import { startSSE, sendSSEChunk, sendSSEKeepAlive, endSSE } from './stream.js'

export interface ServerOptions {
  card: AgentCard
  registry: SkillRegistry
  keypair: Keypair
  taskStore: TaskStore
  rateLimiter: RateLimiter
  nonceStore: NonceStore
  introText: string
  knownPeers: Map<string, Uint8Array>  // agentId -> publicKey cache
}

export function buildServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: false })

  // ── GET /.well-known/agent.json ──────────────────────────────────────────
  app.get('/.well-known/agent.json', async (_req, reply) => {
    reply.header('Cache-Control', `public, max-age=${opts.card.cardTTL}`)
    return opts.card
  })

  // ── GET /agent/health ────────────────────────────────────────────────────
  app.get('/agent/health', async () => {
    return {
      status: 'ok',
      protocolVersion: '1.1',
      agentVersion: opts.card.version,
      uptime: process.uptime(),
    }
  })

  // ── GET /agent/intro ─────────────────────────────────────────────────────
  app.get('/agent/intro', async (_req, reply) => {
    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    return opts.introText
  })

  // ── Shared: verify incoming envelope ────────────────────────────────────
  async function verifyIncoming(envelope: MessageEnvelope): Promise<void> {
    // 1. Nonce + timestamp check (cheap, fast rejection)
    const nonceResult = opts.nonceStore.check(envelope.nonce, envelope.timestamp)
    if (nonceResult === 'expired') throw new SamvadError(ErrorCode.AUTH_FAILED, 'Message timestamp expired')
    if (nonceResult === 'replay') throw new SamvadError(ErrorCode.REPLAY_DETECTED, 'Nonce already seen')

    // 2. Rate limit (protects downstream work)
    opts.rateLimiter.check(envelope.from)

    // 3. Signature verification (expensive crypto)
    const pubKey = opts.knownPeers.get(envelope.from)
    if (!pubKey) {
      throw new SamvadError(ErrorCode.AUTH_FAILED, `Unknown sender: ${envelope.from}`)
    }
    const valid = await verifyEnvelope(envelope, pubKey)
    if (!valid) throw new SamvadError(ErrorCode.AUTH_FAILED, 'Invalid message signature')

    // 4. Injection scan (after signature — only scan authenticated input)
    if (scanObjectForInjection(envelope.payload)) {
      throw new SamvadError(ErrorCode.INJECTION_DETECTED, 'Potential prompt injection detected in payload')
    }

    // 5. Trust tier enforcement (last — requires skill lookup)
    const skillDef = opts.registry.getSkill(envelope.skill)?.def
    if (skillDef?.trust === 'authenticated') {
      if (!envelope.auth?.token) throw new SamvadError(ErrorCode.AUTH_FAILED, 'Bearer token required')
      // Actual token validation is the agent owner's responsibility (handled in handler/middleware hooks)
    }
    if (skillDef?.trust === 'trusted-peers') {
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
      await verifyIncoming(env)
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
    try {
      await verifyIncoming(env)
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
        // Deliver to callbackUrl if provided
        if (env.callbackUrl) {
          const response: ResponseEnvelope = {
            traceId: env.traceId,
            spanId,
            status: 'ok',
            result: result as Record<string, unknown>,
          }
          fetch(env.callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(response),
          }).catch(() => {
            // Fail silently — caller can poll /agent/task/:taskId as fallback
          })
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
      await verifyIncoming(env)
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
