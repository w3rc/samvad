import { describe, it, expect } from 'vitest'
import { buildAgentCard } from '../src/card.js'
import type { PublicKey, SkillDef } from '../src/types.js'

describe('buildAgentCard', () => {
  const publicKeys: PublicKey[] = [{ kid: 'key-1', key: 'base64key', active: true }]
  const skills: SkillDef[] = [{
    id: 'greet',
    name: 'Greet',
    description: 'Greets someone',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { message: { type: 'string' } } },
    modes: ['sync'],
    trust: 'public',
  }]

  it('builds a valid agent card', () => {
    const card = buildAgentCard({
      name: 'Test Agent',
      version: '1.0.0',
      description: 'A test agent',
      url: 'https://testagent.com',
      specializations: ['testing'],
      models: [{ provider: 'anthropic', model: 'claude-opus-4-6' }],
      skills,
      publicKeys,
      rateLimit: { requestsPerMinute: 60, requestsPerSender: 10 },
      cardTTL: 300,
    })

    expect(card.id).toBe('agent://testagent.com')
    expect(card.protocolVersion).toBe('1.2')
    expect(card.skills).toHaveLength(1)
    expect(card.endpoints.message).toBe('/agent/message')
    expect(card.endpoints.health).toBe('/agent/health')
    expect(card.endpoints.taskStatus).toBe('/agent/task/:taskId')
  })
})
