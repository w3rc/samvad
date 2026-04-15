import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserAgentClient } from '../src/browser-client.js'
import type { AgentCard, ResponseEnvelope, TaskRecord } from '../src/types.js'
import { ErrorCode } from '../src/errors.js'

// Mock signRequest so tests don't do real crypto timing
vi.mock('../src/signing.js', () => ({
  signRequest: vi.fn().mockResolvedValue({
    'content-digest': 'sha-256=:abc:',
    'signature-input': 'sig1=("@method" "@path" "content-digest");keyid="k";alg="ed25519";created=1',
    'signature': 'sig1=:AAAA:',
  }),
}))

const AGENT_URL = 'https://agent.example.com'

const MOCK_CARD: AgentCard = {
  id: 'agent://example',
  name: 'Test Agent',
  description: 'A test agent',
  version: '1.0.0',
  protocolVersion: '1.2',
  endpoint: `${AGENT_URL}/agent/message`,
  endpoints: {
    message: `${AGENT_URL}/agent/message`,
    task: `${AGENT_URL}/agent/task`,
    stream: `${AGENT_URL}/agent/stream`,
    health: `${AGENT_URL}/agent/health`,
    intro: `${AGENT_URL}/agent/intro`,
  },
  skills: [],
  publicKeys: [{ kid: 'key-1', publicKey: 'AAAA', active: true }],
  rateLimit: { requestsPerMinute: 60, requestsPerSender: 100 },
}

function mockFetch(responses: Array<{ ok: boolean; body: unknown }>) {
  let i = 0
  return vi.fn().mockImplementation(() => {
    const r = responses[i++] ?? responses[responses.length - 1]
    return Promise.resolve({
      ok: r.ok,
      status: r.ok ? 200 : 500,
      json: () => Promise.resolve(r.body),
    })
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('BrowserAgentClient.generateKeypair', () => {
  it('returns a keypair with the given kid', async () => {
    const kp = await BrowserAgentClient.generateKeypair('my-key')
    expect(kp.kid).toBe('my-key')
    expect(kp.privateKey).toBeInstanceOf(Uint8Array)
    expect(kp.publicKey).toBeInstanceOf(Uint8Array)
    expect(kp.privateKey.length).toBe(32)
    expect(kp.publicKey.length).toBe(32)
  })

  it('generates unique keypairs', async () => {
    const kp1 = await BrowserAgentClient.generateKeypair('k1')
    const kp2 = await BrowserAgentClient.generateKeypair('k2')
    expect(kp1.privateKey).not.toEqual(kp2.privateKey)
  })
})

describe('BrowserAgentClient.prepare', () => {
  it('generates a keypair if none is provided', async () => {
    const client = await BrowserAgentClient.prepare()
    expect(client.publicKey).toBeInstanceOf(Uint8Array)
    expect(client.agentId).toBe('agent://browser.local')
  })

  it('uses provided keypair and agentId', async () => {
    const kp = await BrowserAgentClient.generateKeypair('test-key')
    const client = await BrowserAgentClient.prepare({ keypair: kp, agentId: 'agent://custom' })
    expect(client.publicKey).toEqual(kp.publicKey)
    expect(client.agentId).toBe('agent://custom')
  })
})

describe('BrowserAgentClient.connect', () => {
  it('fetches and stores the AgentCard', async () => {
    globalThis.fetch = mockFetch([{ ok: true, body: MOCK_CARD }])
    const client = await BrowserAgentClient.prepare()
    await client.connect(AGENT_URL)
    expect(client.card).toEqual(MOCK_CARD)
  })

  it('throws if agent card fetch fails', async () => {
    globalThis.fetch = mockFetch([{ ok: false, body: null }])
    const client = await BrowserAgentClient.prepare()
    await expect(client.connect(AGENT_URL)).rejects.toThrow('Failed to fetch agent card')
  })
})

describe('BrowserAgentClient.from', () => {
  it('creates a connected client in one call', async () => {
    globalThis.fetch = mockFetch([{ ok: true, body: MOCK_CARD }])
    const client = await BrowserAgentClient.from(AGENT_URL)
    expect(client.card).toEqual(MOCK_CARD)
  })
})

describe('BrowserAgentClient.call', () => {
  it('sends a sync request and returns the result', async () => {
    const successResponse: ResponseEnvelope = {
      status: 'ok',
      result: { answer: 42 },
    }
    globalThis.fetch = mockFetch([
      { ok: true, body: MOCK_CARD },
      { ok: true, body: successResponse },
    ])
    const client = await BrowserAgentClient.from(AGENT_URL)
    const result = await client.call('echo', { msg: 'hello' })
    expect(result).toEqual({ answer: 42 })
  })

  it('throws SamvadError on error response', async () => {
    const errorResponse: ResponseEnvelope = {
      status: 'error',
      error: { code: ErrorCode.SKILL_NOT_FOUND, message: 'no such skill' },
    }
    globalThis.fetch = mockFetch([
      { ok: true, body: MOCK_CARD },
      { ok: true, body: errorResponse },
    ])
    const client = await BrowserAgentClient.from(AGENT_URL)
    await expect(client.call('missing', {})).rejects.toMatchObject({
      code: ErrorCode.SKILL_NOT_FOUND,
    })
  })

  it('throws if not connected', async () => {
    const client = await BrowserAgentClient.prepare()
    await expect(client.call('skill', {})).rejects.toThrow('not connected')
  })
})

describe('BrowserAgentClient.task', () => {
  it('returns a taskId', async () => {
    globalThis.fetch = mockFetch([
      { ok: true, body: MOCK_CARD },
      { ok: true, body: { taskId: 'task-123', status: 'pending' } },
    ])
    const client = await BrowserAgentClient.from(AGENT_URL)
    const taskId = await client.task('analyze', { data: 'x' })
    expect(taskId).toBe('task-123')
  })
})

describe('BrowserAgentClient.taskAndPoll', () => {
  it('polls until done and returns result', async () => {
    const pendingRecord: TaskRecord = { id: 'task-1', status: 'pending' }
    const doneRecord: TaskRecord = { id: 'task-1', status: 'done', result: { out: 'value' } }
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(MOCK_CARD) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ taskId: 'task-1', status: 'pending' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(pendingRecord) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(doneRecord) })

    const client = await BrowserAgentClient.from(AGENT_URL)
    const result = await client.taskAndPoll('slow', {}, { intervalMs: 1 })
    expect(result).toEqual({ out: 'value' })
  })

  it('throws on task failure', async () => {
    const failedRecord: TaskRecord = {
      id: 'task-2',
      status: 'failed',
      error: { code: ErrorCode.AGENT_UNAVAILABLE, message: 'crashed' },
    }
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(MOCK_CARD) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ taskId: 'task-2', status: 'pending' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(failedRecord) })

    const client = await BrowserAgentClient.from(AGENT_URL)
    await expect(client.taskAndPoll('crash', {}, { intervalMs: 1 })).rejects.toMatchObject({
      code: ErrorCode.AGENT_UNAVAILABLE,
    })
  })
})

describe('BrowserAgentClient.stream', () => {
  it('yields SSE chunks and completes', async () => {
    const sseData = [
      'data: {"chunk":"hello"}\n\n',
      'data: {"chunk":"world"}\n\n',
      'data: {"done":true}\n\n',
    ].join('')

    const encoder = new TextEncoder()
    const encoded = encoder.encode(sseData)
    let offset = 0

    const mockReader = {
      read: vi.fn().mockImplementation(() => {
        if (offset >= encoded.length) return Promise.resolve({ done: true, value: undefined })
        const chunk = encoded.slice(offset, offset + 20)
        offset += 20
        return Promise.resolve({ done: false, value: chunk })
      }),
    }

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(MOCK_CARD) })
      .mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => mockReader },
      })

    const client = await BrowserAgentClient.from(AGENT_URL)
    const chunks: unknown[] = []
    for await (const chunk of client.stream('generate', { prompt: 'hi' })) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(['hello', 'world'])
  })
})
