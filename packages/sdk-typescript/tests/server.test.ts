import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildServer } from '../src/server.js'
import { SkillRegistry } from '../src/skill-registry.js'
import { TaskStore } from '../src/task-store.js'
import { RateLimiter } from '../src/rate-limiter.js'
import { NonceStore } from '../src/nonce-store.js'
import { generateKeypair } from '../src/keys.js'
import { signRequest } from '../src/signing.js'
import { buildAgentCard } from '../src/card.js'
import { createDelegationToken } from '../src/delegation.js'
import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import type { MessageEnvelope, InjectionClassifier } from '../src/types.js'

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

/** Build a signed inject call for a message endpoint. */
async function signedInject(
  server: FastifyInstance,
  url: string,
  body: MessageEnvelope | (MessageEnvelope & { callbackUrl?: string }),
  kp: Awaited<ReturnType<typeof generateKeypair>>,
) {
  const bodyStr = JSON.stringify(body)
  const bodyBytes = Buffer.from(bodyStr)
  const sigHeaders = await signRequest('POST', url, bodyBytes, kp)
  return server.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', ...sigHeaders },
    payload: bodyStr,
  })
}

function makeEnvelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    from: 'agent://testagent.com',
    to: 'agent://testagent.com',
    skill: 'echo',
    mode: 'sync',
    nonce: Math.random().toString(36),
    timestamp: new Date().toISOString(),
    traceId: 'trace-1',
    spanId: 'span-1',
    payload: { text: 'hello' },
    ...overrides,
  }
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
    expect(body.protocolVersion).toBe('1.2')
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
    const envelope = makeEnvelope({ payload: { text: 'hello' } })
    const res = await signedInject(server, '/agent/message', envelope, kp)
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.status).toBe('ok')
    expect(body.result).toEqual({ echo: 'hello' })
  })

  it('POST /agent/message rejects missing signature headers', async () => {
    const envelope = makeEnvelope()
    const res = await server.inject({
      method: 'POST', url: '/agent/message',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(envelope),
    })
    expect(res.statusCode).toBe(401)
  })

  it('POST /agent/message rejects tampered body', async () => {
    const envelope = makeEnvelope({ payload: { text: 'hello' } })
    const bodyStr = JSON.stringify(envelope)
    const bodyBytes = Buffer.from(bodyStr)
    const sigHeaders = await signRequest('POST', '/agent/message', bodyBytes, kp)

    // Send a different body but keep the original signature headers
    const tamperedEnvelope = makeEnvelope({ payload: { text: 'tampered' } })
    const res = await server.inject({
      method: 'POST', url: '/agent/message',
      headers: { 'content-type': 'application/json', ...sigHeaders },
      payload: JSON.stringify(tamperedEnvelope),
    })
    expect(res.statusCode).toBe(401)
  })

  it('POST /agent/task returns 202 with taskId', async () => {
    const envelope = makeEnvelope({ mode: 'async', spanId: 'span-2', payload: { text: 'async hello' } })
    const res = await signedInject(server, '/agent/task', envelope, kp)
    expect(res.statusCode).toBe(202)
    const body = JSON.parse(res.body)
    expect(body.taskId).toBeTruthy()
    expect(body.status).toBe('accepted')
  })

  it('GET /agent/task/:taskId returns task status', async () => {
    const envelope = makeEnvelope({ mode: 'async', spanId: 'span-3', payload: { text: 'poll me' } })
    const taskRes = await signedInject(server, '/agent/task', envelope, kp)
    const { taskId } = JSON.parse(taskRes.body)

    await new Promise(r => setTimeout(r, 50))
    const pollRes = await server.inject({ method: 'GET', url: `/agent/task/${taskId}` })
    expect(pollRes.statusCode).toBe(200)
    const pollBody = JSON.parse(pollRes.body)
    expect(['running', 'done']).toContain(pollBody.status)
  })
})

/** Build a server with extra known peers and optional extra skills. */
async function makeServerWithPeers(
  extraPeers: Map<string, Uint8Array>,
  extraSkills?: (registry: SkillRegistry) => void,
) {
  const kp = await generateKeypair('key-1')
  const registry = new SkillRegistry()
  registry.register('echo', {
    name: 'Echo', description: 'Echoes input',
    input: z.object({ text: z.string() }),
    output: z.object({ echo: z.string() }),
    modes: ['sync'], trust: 'public',
    handler: async (input) => ({ echo: (input as { text: string }).text }),
  })
  extraSkills?.(registry)
  const card = buildAgentCard({
    name: 'Test Agent', version: '1.0.0', description: 'Test',
    url: 'https://testagent.com', specializations: [],
    models: [{ provider: 'test', model: 'test' }],
    skills: registry.getDefs(),
    publicKeys: [{ kid: 'key-1', key: Buffer.from(kp.publicKey).toString('base64'), active: true }],
    rateLimit: { requestsPerMinute: 60, requestsPerSender: 100 }, cardTTL: 300,
  })
  const knownPeers = new Map<string, Uint8Array>([['agent://testagent.com', kp.publicKey], ...extraPeers])
  const server = buildServer({
    card, registry, keypair: kp,
    taskStore: new TaskStore(3600_000),
    rateLimiter: new RateLimiter(card.rateLimit),
    nonceStore: new NonceStore(5 * 60_000),
    introText: '# Test Agent',
    knownPeers,
  })
  await server.ready()
  return { server, kp }
}

async function makeServerWithClassifier(injectionClassifier: InjectionClassifier) {
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
    introText: '# Test Agent',
    knownPeers: new Map([['agent://testagent.com', kp.publicKey]]),
    injectionClassifier,
  })
  await server.ready()
  return { server, kp }
}

describe('injectionClassifier', () => {
  it('blocks request when classifier returns true', async () => {
    const classifier: InjectionClassifier = async () => true
    const { server, kp } = await makeServerWithClassifier(classifier)
    const envelope = makeEnvelope({ payload: { text: 'hello' } })
    const res = await signedInject(server, '/agent/message', envelope, kp)
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe('INJECTION_DETECTED')
    await server.close()
  })

  it('passes request when classifier returns false', async () => {
    const classifier: InjectionClassifier = async () => false
    const { server, kp } = await makeServerWithClassifier(classifier)
    const envelope = makeEnvelope({ payload: { text: 'hello' } })
    const res = await signedInject(server, '/agent/message', envelope, kp)
    expect(res.statusCode).toBe(200)
    await server.close()
  })

  it('fails open when classifier throws — request proceeds', async () => {
    const classifier: InjectionClassifier = async () => { throw new Error('API down') }
    const { server, kp } = await makeServerWithClassifier(classifier)
    const envelope = makeEnvelope({ payload: { text: 'hello' } })
    const res = await signedInject(server, '/agent/message', envelope, kp)
    expect(res.statusCode).toBe(200)
    await server.close()
  })

  it('classifier is called with the payload object', async () => {
    let capturedPayload: Record<string, unknown> | undefined
    const classifier: InjectionClassifier = async (payload) => {
      capturedPayload = payload
      return false
    }
    const { server, kp } = await makeServerWithClassifier(classifier)
    const envelope = makeEnvelope({ payload: { text: 'check me' } })
    await signedInject(server, '/agent/message', envelope, kp)
    expect(capturedPayload).toEqual({ text: 'check me' })
    await server.close()
  })
})

// ── Critical 2: Delegation token verification ────────────────────────────────
describe('delegation token enforcement', () => {
  it('rejects malformed delegation token', async () => {
    const { server, kp } = await makeServerWithPeers(new Map())
    const envelope = makeEnvelope({ delegationToken: 'not.a.valid.jwt' })
    const res = await signedInject(server, '/agent/message', envelope, kp)
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).error.code).toBe('AUTH_FAILED')
    await server.close()
  })

  it('rejects delegation token from unknown issuer', async () => {
    const unknownKp = await generateKeypair('unknown-key')
    const token = await createDelegationToken({
      issuer: 'agent://unknown-issuer.com',  // not in knownPeers
      subject: 'agent://testagent.com',
      scope: ['echo'],
      maxDepth: 1,
      expiresInSeconds: 300,
      privateKey: unknownKp.privateKey,
    })
    const { server, kp } = await makeServerWithPeers(new Map())
    const envelope = makeEnvelope({ delegationToken: token })
    const res = await signedInject(server, '/agent/message', envelope, kp)
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).error.code).toBe('AUTH_FAILED')
    await server.close()
  })

  it('accepts valid delegation token from known issuer', async () => {
    const issuerKp = await generateKeypair('issuer-key')
    const token = await createDelegationToken({
      issuer: 'agent://issuer.com',
      subject: 'agent://testagent.com',
      scope: ['echo'],
      maxDepth: 1,
      expiresInSeconds: 300,
      privateKey: issuerKp.privateKey,
    })
    const { server, kp } = await makeServerWithPeers(
      new Map([['agent://issuer.com', issuerKp.publicKey]])
    )
    const envelope = makeEnvelope({ delegationToken: token })
    const res = await signedInject(server, '/agent/message', envelope, kp)
    expect(res.statusCode).toBe(200)
    await server.close()
  })
})

// ── Critical 3 / Important 8: Trust tier enforcement ────────────────────────
describe('trust tier enforcement', () => {
  it('rejects authenticated skill request missing bearer token', async () => {
    const { server, kp } = await makeServerWithPeers(new Map(), (registry) => {
      registry.register('secret', {
        name: 'Secret', description: 'Needs auth',
        input: z.object({ q: z.string() }),
        output: z.object({ a: z.string() }),
        modes: ['sync'], trust: 'authenticated',
        handler: async () => ({ a: 'ok' }),
      })
    })
    const envelope = makeEnvelope({ skill: 'secret', payload: { q: 'hi' } })
    const res = await signedInject(server, '/agent/message', envelope, kp)
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).error.code).toBe('AUTH_FAILED')
    await server.close()
  })

  it('rejects trusted-peers skill request from unlisted sender', async () => {
    const { server, kp } = await makeServerWithPeers(new Map(), (registry) => {
      registry.register('admin', {
        name: 'Admin', description: 'Trusted only',
        input: z.object({ cmd: z.string() }),
        output: z.object({ done: z.boolean() }),
        modes: ['sync'],
        trust: 'trusted-peers',
        allowedPeers: ['agent://other-trusted.com'],
        handler: async () => ({ done: true }),
      })
    })
    // agent://testagent.com is NOT in allowedPeers
    const envelope = makeEnvelope({ skill: 'admin', payload: { cmd: 'run' } })
    const res = await signedInject(server, '/agent/message', envelope, kp)
    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).error.code).toBe('AUTH_FAILED')
    await server.close()
  })

  it('rejects call to non-existent skill with SKILL_NOT_FOUND before trust checks run', async () => {
    const { server, kp } = await makeServerWithPeers(new Map(), (registry) => {
      registry.register('admin', {
        name: 'Admin', description: 'Trusted only',
        input: z.object({ cmd: z.string() }),
        output: z.object({ done: z.boolean() }),
        modes: ['sync'],
        trust: 'trusted-peers',
        allowedPeers: ['agent://other-trusted.com'],
        handler: async () => ({ done: true }),
      })
    })
    const envelope = makeEnvelope({ skill: 'nonexistent', payload: { cmd: 'run' } })
    const res = await signedInject(server, '/agent/message', envelope, kp)
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error.code).toBe('SKILL_NOT_FOUND')
    await server.close()
  })
})
