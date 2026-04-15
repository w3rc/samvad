// SPDX-License-Identifier: Apache-2.0
import * as ed from '@noble/ed25519'
import type { AgentCard, MessageEnvelope, ResponseEnvelope, TaskRecord } from './types.js'
import type { Keypair } from './keys.js'
import { signRequest } from './signing.js'
import { SamvadError, ErrorCode, type ErrorCodeType } from './errors.js'

export interface BrowserAgentClientOptions {
  keypair?: Keypair
  agentId?: string
}

// UUID v4 built on getRandomValues — works on Safari ≤15.3 and HTTP origins
// (crypto.randomUUID() is unavailable pre-Safari 15.4 and requires a secure context)
function randomUUID(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40   // version 4
  b[8] = (b[8] & 0x3f) | 0x80   // variant bits
  return (
    hex(b, 0, 4) + '-' +
    hex(b, 4, 6) + '-' +
    hex(b, 6, 8) + '-' +
    hex(b, 8, 10) + '-' +
    hex(b, 10, 16)
  )
}

function hex(b: Uint8Array, from: number, to: number): string {
  return Array.from(b.slice(from, to)).map(x => x.toString(16).padStart(2, '0')).join('')
}

function assertSecureContext(): void {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error(
      'Web Crypto API (crypto.subtle) is unavailable. ' +
      'BrowserAgentClient requires a secure context (HTTPS or localhost).',
    )
  }
}

/**
 * A browser-compatible SAMVAD agent client.
 *
 * Unlike AgentClient, this class has zero Node.js dependencies:
 * - No file I/O — keypair is generated in memory or passed in directly
 * - No `node:crypto` — uses Web Crypto API (globalThis.crypto)
 * - No `node:fs` or `node:path`
 *
 * Works in any environment with Web Crypto + fetch (browsers, Cloudflare Workers, Deno, Node 20+).
 * Requires a secure context (HTTPS or localhost) — crypto.subtle is unavailable on plain HTTP.
 */
export class BrowserAgentClient {
  public card: AgentCard | null = null
  private baseUrl: string | null = null

  private constructor(
    private readonly keypair: Keypair,
    public readonly agentId: string,
  ) {}

  /** Generate a fresh Ed25519 keypair for use with this client. */
  static async generateKeypair(kid: string): Promise<Keypair> {
    assertSecureContext()
    const privateKey = ed.utils.randomPrivateKey()
    const publicKey = await ed.getPublicKeyAsync(privateKey)
    return { kid, privateKey, publicKey }
  }

  /**
   * Create a client without connecting.
   * If no keypair is provided, a new one is generated.
   * The default agentId incorporates the keypair's kid so concurrent instances don't collide
   * in the server's per-sender rate limiter or knownPeers map.
   */
  static async prepare(opts: BrowserAgentClientOptions = {}): Promise<BrowserAgentClient> {
    assertSecureContext()
    const kp = opts.keypair ?? await BrowserAgentClient.generateKeypair('browser-client')
    const agentId = opts.agentId ?? `agent://browser.${kp.kid}`
    return new BrowserAgentClient(kp, agentId)
  }

  /** Connect to a remote agent by fetching its AgentCard. */
  async connect(agentUrl: string): Promise<void> {
    this.baseUrl = agentUrl
    const cardRes = await fetch(`${agentUrl}/.well-known/agent.json`)
    if (!cardRes.ok) throw new Error(`Failed to fetch agent card from ${agentUrl}: ${cardRes.status}`)
    this.card = await cardRes.json() as AgentCard
  }

  /** Convenience: prepare + connect in one call. */
  static async from(agentUrl: string, opts: BrowserAgentClientOptions = {}): Promise<BrowserAgentClient> {
    const client = await BrowserAgentClient.prepare(opts)
    await client.connect(agentUrl)
    return client
  }

  get publicKey(): Uint8Array {
    return this.keypair.publicKey
  }

  private ensureConnected(): void {
    if (!this.baseUrl || !this.card) {
      throw new Error('BrowserAgentClient is not connected. Call connect(agentUrl) first.')
    }
  }

  private buildBody(
    skill: string,
    mode: 'sync' | 'async' | 'stream',
    payload: Record<string, unknown>,
  ): MessageEnvelope {
    this.ensureConnected()
    return {
      from: this.agentId,
      to: this.card!.id,
      skill, mode,
      nonce: randomUUID(),
      timestamp: new Date().toISOString(),
      traceId: randomUUID(),
      spanId: randomUUID(),
      payload,
    }
  }

  /** Sign and POST a JSON body, returning the raw Response. */
  private async signedFetch(url: string, body: object): Promise<Response> {
    const bodyStr = JSON.stringify(body)
    const bodyBytes = new TextEncoder().encode(bodyStr)
    const { pathname } = new URL(url)
    const sigHeaders = await signRequest('POST', pathname, bodyBytes, this.keypair)
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...sigHeaders },
      body: bodyStr,
    })
  }

  async call(skill: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.ensureConnected()
    const body = this.buildBody(skill, 'sync', payload)
    const res = await this.signedFetch(`${this.baseUrl}/agent/message`, body)
    const respBody = await res.json() as ResponseEnvelope
    if (respBody.status === 'error') {
      throw new SamvadError(respBody.error!.code as ErrorCodeType, respBody.error!.message)
    }
    return respBody.result!
  }

  async task(skill: string, payload: Record<string, unknown>, callbackUrl?: string): Promise<string> {
    this.ensureConnected()
    const body: Record<string, unknown> = { ...this.buildBody(skill, 'async', payload) }
    if (callbackUrl) body.callbackUrl = callbackUrl
    const res = await this.signedFetch(`${this.baseUrl}/agent/task`, body)
    const result = await res.json() as { taskId: string; status: string }
    return result.taskId
  }

  async taskAndPoll(
    skill: string,
    payload: Record<string, unknown>,
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<Record<string, unknown>> {
    this.ensureConnected()
    const taskId = await this.task(skill, payload)
    const interval = opts.intervalMs ?? 100
    const timeout = opts.timeoutMs ?? 30_000
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, interval))
      const res = await fetch(`${this.baseUrl}/agent/task/${taskId}`)
      if (!res.ok) throw new SamvadError(ErrorCode.AGENT_UNAVAILABLE, `Task poll returned HTTP ${res.status}`)
      const task = await res.json() as TaskRecord
      if (task.status === 'done') return task.result!
      if (task.status === 'failed') {
        throw new SamvadError(task.error!.code as ErrorCodeType, task.error!.message)
      }
    }
    throw new SamvadError(ErrorCode.AGENT_UNAVAILABLE, `Task ${taskId} timed out after ${timeout}ms`)
  }

  async *stream(skill: string, payload: Record<string, unknown>): AsyncGenerator<unknown> {
    this.ensureConnected()
    const body = this.buildBody(skill, 'stream', payload)
    const res = await this.signedFetch(`${this.baseUrl}/agent/stream`, body)
    if (!res.ok) {
      const err = await res.json().catch(() => null) as ResponseEnvelope | null
      const code = (err?.error?.code ?? ErrorCode.AGENT_UNAVAILABLE) as ErrorCodeType
      const msg = err?.error?.message ?? `Stream request failed with HTTP ${res.status}`
      throw new SamvadError(code, msg)
    }
    if (!res.body) throw new Error('No response body for stream')
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const trimmed = block.trim()
        if (trimmed.startsWith('data: ')) {
          const data = JSON.parse(trimmed.slice(6))
          if (data.done) {
            if (data.error) throw new SamvadError(data.error.code as ErrorCodeType, data.error.message)
            return
          }
          yield data.chunk
        }
      }
    }
  }
}
