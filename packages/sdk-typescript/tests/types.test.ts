import { describe, it, expect } from 'vitest'
import type { AgentCard, MessageEnvelope, SkillDef } from '../src/types.js'
import { SamvadError, ErrorCode } from '../src/errors.js'

describe('SamvadError', () => {
  it('constructs with code and message', () => {
    const err = new SamvadError(ErrorCode.SKILL_NOT_FOUND, 'Skill not found')
    expect(err.code).toBe('SKILL_NOT_FOUND')
    expect(err.message).toBe('Skill not found')
    expect(err instanceof Error).toBe(true)
  })

  it('serialises to JSON envelope', () => {
    const err = new SamvadError(ErrorCode.SCHEMA_INVALID, 'Bad input')
    expect(err.toJSON()).toEqual({ code: 'SCHEMA_INVALID', message: 'Bad input' })
  })
})
