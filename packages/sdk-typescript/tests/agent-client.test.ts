import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Agent } from '../src/agent.js'
import { AgentClient } from '../src/agent-client.js'
import { SamvadError } from '../src/errors.js'
import { z } from 'zod'
import { rmSync, existsSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'

const AGENT_KEYS_DIR = '/tmp/samvad-e2e-agent-keys'
const CLIENT_KEYS_DIR = '/tmp/samvad-e2e-client-keys'

describe('AgentClient end-to-end', () => {
  let server: FastifyInstance
  let client: AgentClient

  beforeAll(async () => {
    // Clean up any leftover keys from previous runs
    if (existsSync(AGENT_KEYS_DIR)) rmSync(AGENT_KEYS_DIR, { recursive: true })
    if (existsSync(CLIENT_KEYS_DIR)) rmSync(CLIENT_KEYS_DIR, { recursive: true })

    // Create client first so we know its public key
    client = await AgentClient.prepare({ keysDir: CLIENT_KEYS_DIR, agentId: 'agent://client.local' })

    const agent = new Agent({
      name: 'E2E Test Agent',
      url: 'http://localhost:4444',
      keysDir: AGENT_KEYS_DIR,
    })
    agent.skill('add', {
      name: 'Add',
      description: 'Adds two numbers',
      input: z.object({ a: z.number(), b: z.number() }),
      output: z.object({ sum: z.number() }),
      modes: ['sync', 'async'],
      trust: 'public',
      handler: async (input) => {
        const { a, b } = input as { a: number; b: number }
        return { sum: a + b }
      },
    })
    // Pre-register the client's public key so signature verification succeeds
    agent.trustPeer('agent://client.local', client.publicKey)

    server = await agent.serve({ port: 4444 })

    // Now connect the client to the running agent
    await client.connect('http://localhost:4444')
  })

  afterAll(async () => {
    await server.close()
    if (existsSync(AGENT_KEYS_DIR)) rmSync(AGENT_KEYS_DIR, { recursive: true })
    if (existsSync(CLIENT_KEYS_DIR)) rmSync(CLIENT_KEYS_DIR, { recursive: true })
  })

  it('fetches agent card', async () => {
    expect(client.card!.name).toBe('E2E Test Agent')
    expect(client.card!.skills).toHaveLength(1)
  })

  it('calls a skill synchronously', async () => {
    const result = await client.call('add', { a: 3, b: 4 })
    expect(result).toEqual({ sum: 7 })
  })

  it('calls a skill with taskAndPoll (async + polling)', async () => {
    const result = await client.taskAndPoll('add', { a: 10, b: 20 })
    expect(result).toEqual({ sum: 30 })
  })
})

const STREAM_AGENT_KEYS_DIR = '/tmp/samvad-e2e-stream-keys'

describe('AgentClient stream error propagation', () => {
  let streamServer: FastifyInstance
  let streamClient: AgentClient

  beforeAll(async () => {
    if (existsSync(STREAM_AGENT_KEYS_DIR)) rmSync(STREAM_AGENT_KEYS_DIR, { recursive: true })

    streamClient = await AgentClient.prepare({ keysDir: CLIENT_KEYS_DIR, agentId: 'agent://client.local' })

    const agent = new Agent({ name: 'Stream Test Agent', url: 'http://localhost:4446', keysDir: STREAM_AGENT_KEYS_DIR })
    agent.skill('fail-stream', {
      name: 'FailStream', description: 'Always fails',
      input: z.object({}),
      output: z.object({}),
      modes: ['stream'],
      trust: 'public',
      handler: async () => { throw new SamvadError('AGENT_UNAVAILABLE' as const, 'deliberate stream failure') },
    })
    agent.trustPeer('agent://client.local', streamClient.publicKey)
    streamServer = await agent.serve({ port: 4446 })
    await streamClient.connect('http://localhost:4446')
  })

  afterAll(async () => {
    await streamServer.close()
    if (existsSync(STREAM_AGENT_KEYS_DIR)) rmSync(STREAM_AGENT_KEYS_DIR, { recursive: true })
  })

  it('stream generator throws SamvadError when skill handler fails', async () => {
    await expect(async () => {
      for await (const _ of streamClient.stream('fail-stream', {})) { /* consume */ }
    }).rejects.toBeInstanceOf(SamvadError)
  })
})
