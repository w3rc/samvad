// SPDX-License-Identifier: Apache-2.0
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ZodTypeAny } from 'zod'
import { generateKeypair, saveKeypair, loadKeypair, encodePublicKey } from './keys.js'
import { SkillRegistry } from './skill-registry.js'
import { TaskStore } from './task-store.js'
import { RateLimiter } from './rate-limiter.js'
import { NonceStore } from './nonce-store.js'
import { buildAgentCard } from './card.js'
import { buildServer } from './server.js'
import type { CommunicationMode, TrustTier } from './types.js'
import type { FastifyInstance } from 'fastify'

export interface AgentConfig {
  name: string
  version?: string
  description?: string
  url: string
  specializations?: string[]
  models?: Array<{ provider: string; model: string }>
  keysDir?: string
  cardTTL?: number
  rateLimit?: { requestsPerMinute: number; requestsPerSender: number; tokensPerSenderPerDay?: number }
}

export interface AgentSkillOptions {
  name: string
  description: string
  input: ZodTypeAny
  output: ZodTypeAny
  modes: CommunicationMode[]
  trust: TrustTier
  allowedPeers?: string[]
  handler: (input: unknown, ctx: { sender: string; traceId: string; spanId: string; delegationToken?: string }) => Promise<unknown>
}

export interface ServeOptions {
  port?: number
  host?: string
}

export class Agent {
  private registry = new SkillRegistry()
  private config: AgentConfig
  private pendingPeers = new Map<string, Uint8Array>()

  constructor(config: AgentConfig) {
    this.config = config
  }

  skill(id: string, opts: AgentSkillOptions): this {
    this.registry.register(id, opts)
    return this
  }

  trustPeer(agentId: string, publicKey: Uint8Array): this {
    this.pendingPeers.set(agentId, publicKey)
    return this
  }

  async serve(opts: ServeOptions = {}): Promise<FastifyInstance> {
    const port = opts.port ?? 3000
    const host = opts.host ?? '0.0.0.0'
    const keysDir = this.config.keysDir ?? join(process.cwd(), '.samvad', 'keys')

    // Load or generate keypair
    let kp
    const keyFile = join(keysDir, 'key-current.json')
    if (existsSync(keyFile)) {
      kp = await loadKeypair(keysDir, 'key-current')
    } else {
      kp = await generateKeypair('key-current')
      await saveKeypair(kp, keysDir)
    }

    const card = buildAgentCard({
      name: this.config.name,
      version: this.config.version ?? '1.0.0',
      description: this.config.description ?? '',
      url: this.config.url,
      specializations: this.config.specializations ?? [],
      models: this.config.models ?? [],
      skills: this.registry.getDefs(),
      publicKeys: [{ kid: kp.kid, key: encodePublicKey(kp.publicKey), active: true }],
      rateLimit: this.config.rateLimit ?? { requestsPerMinute: 60, requestsPerSender: 10 },
      cardTTL: this.config.cardTTL ?? 300,
    })

    const introText = `# ${card.name}\n\n${card.description}\n\n## Skills\n${card.skills.map(s => `- **${s.name}**: ${s.description}`).join('\n')}`

    // Merge the agent's own public key (for self-calls in tests) with trusted peers
    const knownPeers = new Map(this.pendingPeers)
    knownPeers.set(card.id, kp.publicKey)

    const server = buildServer({
      card,
      registry: this.registry,
      keypair: kp,
      taskStore: new TaskStore(3600_000),
      rateLimiter: new RateLimiter(card.rateLimit),
      nonceStore: new NonceStore(5 * 60_000),
      introText,
      knownPeers,
    })

    await server.listen({ port, host })
    console.log(`[SAMVAD] Agent "${card.name}" listening on ${host}:${port}`)
    console.log(`[SAMVAD] Card: ${card.url}/.well-known/agent.json`)
    return server
  }
}
