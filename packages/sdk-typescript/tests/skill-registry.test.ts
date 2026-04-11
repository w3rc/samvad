import { describe, it, expect, beforeEach } from 'vitest'
import { SkillRegistry } from '../src/skill-registry.js'
import { ErrorCode } from '../src/errors.js'
import { z } from 'zod'

describe('SkillRegistry', () => {
  let registry: SkillRegistry

  beforeEach(() => { registry = new SkillRegistry() })

  it('registers a skill and returns its def', () => {
    registry.register('greet', {
      name: 'Greet',
      description: 'Greets someone',
      input: z.object({ name: z.string() }),
      output: z.object({ message: z.string() }),
      modes: ['sync'],
      trust: 'public',
      handler: async (input) => ({ message: `Hello, ${(input as { name: string }).name}!` }),
    })
    const defs = registry.getDefs()
    expect(defs).toHaveLength(1)
    expect(defs[0].id).toBe('greet')
  })

  it('dispatches a valid call to the handler', async () => {
    registry.register('greet', {
      name: 'Greet',
      description: 'Greets someone',
      input: z.object({ name: z.string() }),
      output: z.object({ message: z.string() }),
      modes: ['sync'],
      trust: 'public',
      handler: async (input) => ({ message: `Hello, ${(input as { name: string }).name}!` }),
    })
    const result = await registry.dispatch('greet', { name: 'World' }, { sender: 'agent://a.com', traceId: 't', spanId: 's' })
    expect(result).toEqual({ message: 'Hello, World!' })
  })

  it('throws SKILL_NOT_FOUND for unknown skill', async () => {
    await expect(registry.dispatch('unknown', {}, { sender: 'agent://a.com', traceId: 't', spanId: 's' }))
      .rejects.toMatchObject({ code: ErrorCode.SKILL_NOT_FOUND })
  })

  it('throws SCHEMA_INVALID when input does not match schema', async () => {
    registry.register('greet', {
      name: 'Greet',
      description: 'Greets someone',
      input: z.object({ name: z.string() }),
      output: z.object({ message: z.string() }),
      modes: ['sync'],
      trust: 'public',
      handler: async (input) => ({ message: `Hello, ${(input as { name: string }).name}!` }),
    })
    await expect(registry.dispatch('greet', { name: 123 }, { sender: 'agent://a.com', traceId: 't', spanId: 's' }))
      .rejects.toMatchObject({ code: ErrorCode.SCHEMA_INVALID })
  })
})
