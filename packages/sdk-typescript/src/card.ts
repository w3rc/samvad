// SPDX-License-Identifier: Apache-2.0
import type { AgentCard, PublicKey, SkillDef, RateLimit } from './types.js'

interface BuildCardOptions {
  name: string
  version: string
  description: string
  url: string
  specializations: string[]
  models: Array<{ provider: string; model: string }>
  skills: SkillDef[]
  publicKeys: PublicKey[]
  rateLimit: RateLimit
  cardTTL: number
}

export function buildAgentCard(opts: BuildCardOptions): AgentCard {
  const domain = new URL(opts.url).hostname
  return {
    id: `agent://${domain}`,
    name: opts.name,
    version: opts.version,
    description: opts.description,
    url: opts.url,
    protocolVersion: '1.1',
    specializations: opts.specializations,
    models: opts.models,
    skills: opts.skills,
    publicKeys: opts.publicKeys,
    auth: { schemes: ['bearer', 'none'] },
    rateLimit: opts.rateLimit,
    cardTTL: opts.cardTTL,
    endpoints: {
      intro: '/agent/intro',
      message: '/agent/message',
      task: '/agent/task',
      taskStatus: '/agent/task/:taskId',
      stream: '/agent/stream',
      health: '/agent/health',
    },
  }
}
