import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildServer } from '../src/server.js'
import { SkillRegistry } from '../src/skill-registry.js'
import { TaskStore } from '../src/task-store.js'
import { RateLimiter } from '../src/rate-limiter.js'
import { NonceStore } from '../src/nonce-store.js'
import { generateKeypair } from '../src/keys.js'
import { signEnvelope } from '../src/signing.js'
import { buildAgentCard } from '../src/card.js'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'

async function makeServer() {
  const kp = await generateKeypair('key-1')
  const registry = new SkillRegistry()
  registry.register('echo', {
    name: 'Echo',
    description: 'Echoes input',
    input: z.object({ text: z.string() }),
    output: z.object({ echo: z.string() }),
    modes: ['sync', 'async', 'stream'],
    trust: 'public',
    handler: async (input) => ({ echo: (input as { text: string }).text }),
  })

  const card = buildAgentCard({
    name: 'Test Agent', version: '1.0.0', description: 'Test',
    url: 'https://testagent.com', specializations: [],
    models: [{ provider: 'test', model: 'test' }],
    skills: registry.getDefs(),
    publicKeys: [{ kid: 'key-1', key: Buffer.from(kp.publicKey).toString('base64'), active: true }],
    rateLimit: { requestsPerMinute: 60, requestsPerSender: 100 }, cardTTL: 300,
  })

  const server = buildServer({
    card, registry, keypair: kp,
    taskStore: new TaskStore(3600_000),
    rateLimiter: new RateLimiter(card.rateLimit),
    nonceStore: new NonceStore(5 * 60_000),
    introText: '# Test Agent\nI am a test agent.',
    knownPeers: new Map([['agent://testagent.com', kp.publicKey]]),
  })
  await server.ready()
  return { server, kp, card }
}

describe('server endpoints', () => {
  let server: FastifyInstance
  let kp: Awaited<ReturnType<typeof generateKeypair>>

  beforeEach(async () => {
    const result = await makeServer()
    server = result.server
    kp = result.kp
  })

  afterEach(async () => { await server.close() })

  it('GET /.well-known/agent.json returns card', async () => {
    const res = await server.inject({ method: 'GET', url: '/.well-known/agent.json' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.protocolVersion).toBe('1.1')
    expect(body.skills).toHaveLength(1)
  })

  it('GET /agent/health returns ok', async () => {
    const res = await server.inject({ method: 'GET', url: '/agent/health' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).status).toBe('ok')
  })

  it('GET /agent/intro returns markdown', async () => {
    const res = await server.inject({ method: 'GET', url: '/agent/intro' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/markdown')
    expect(res.body).toContain('Test Agent')
  })

  it('POST /agent/message dispatches echo skill', async () => {
    const envelope = await signEnvelope({
      from: 'agent://testagent.com', to: 'agent://testagent.com',
      skill: 'echo', mode: 'sync',
      nonce: Math.random().toString(36), timestamp: new Date().toISOString(),
      kid: 'key-1', signature: '', traceId: 'trace-1', spanId: 'span-1',
      payload: { text: 'hello' },
    }, kp)

    const res = await server.inject({
      method: 'POST', url: '/agent/message',
      headers: { 'content-type': 'application/json' },
      payload: envelope,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('ok')
    expect(body.result).toEqual({ echo: 'hello' })
  })

  it('POST /agent/task returns 202 with taskId', async () => {
    const envelope = await signEnvelope({
      from: 'agent://testagent.com', to: 'agent://testagent.com',
      skill: 'echo', mode: 'async',
      nonce: Math.random().toString(36), timestamp: new Date().toISOString(),
      kid: 'key-1', signature: '', traceId: 'trace-1', spanId: 'span-2',
      payload: { text: 'async hello' },
    }, kp)

    const res = await server.inject({
      method: 'POST', url: '/agent/task',
      headers: { 'content-type': 'application/json' },
      payload: envelope,
    })
    expect(res.statusCode).toBe(202)
    const body = JSON.parse(res.body)
    expect(body.taskId).toBeTruthy()
    expect(body.status).toBe('accepted')
  })

  it('GET /agent/task/:taskId returns task status', async () => {
    const envelope = await signEnvelope({
      from: 'agent://testagent.com', to: 'agent://testagent.com',
      skill: 'echo', mode: 'async',
      nonce: Math.random().toString(36), timestamp: new Date().toISOString(),
      kid: 'key-1', signature: '', traceId: 'trace-1', spanId: 'span-3',
      payload: { text: 'poll me' },
    }, kp)
    const taskRes = await server.inject({ method: 'POST', url: '/agent/task', headers: { 'content-type': 'application/json' }, payload: envelope })
    const { taskId } = JSON.parse(taskRes.body)

    // Give the async handler a moment to complete
    await new Promise(r => setTimeout(r, 50))
    const pollRes = await server.inject({ method: 'GET', url: `/agent/task/${taskId}` })
    expect(pollRes.statusCode).toBe(200)
    const pollBody = JSON.parse(pollRes.body)
    expect(['running', 'done']).toContain(pollBody.status)
  })
})
