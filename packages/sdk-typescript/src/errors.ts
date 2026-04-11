export const ErrorCode = {
  AUTH_FAILED: 'AUTH_FAILED',
  SKILL_NOT_FOUND: 'SKILL_NOT_FOUND',
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  REPLAY_DETECTED: 'REPLAY_DETECTED',
  INJECTION_DETECTED: 'INJECTION_DETECTED',
  DELEGATION_EXCEEDED: 'DELEGATION_EXCEEDED',
  AGENT_UNAVAILABLE: 'AGENT_UNAVAILABLE',
  TOKEN_BUDGET_EXCEEDED: 'TOKEN_BUDGET_EXCEEDED',
} as const

export type ErrorCodeType = typeof ErrorCode[keyof typeof ErrorCode]

export class SamvadError extends Error {
  constructor(
    public readonly code: ErrorCodeType,
    message: string,
  ) {
    super(message)
    this.name = 'SamvadError'
  }

  toJSON(): { code: string; message: string } {
    return { code: this.code, message: this.message }
  }
}
