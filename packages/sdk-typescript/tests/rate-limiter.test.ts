import { describe, it, expect } from 'vitest'
import { RateLimiter } from '../src/rate-limiter.js'
import { ErrorCode } from '../src/errors.js'

describe('RateLimiter', () => {
  it('allows requests within per-minute limit', () => {
    const rl = new RateLimiter({ requestsPerMinute: 10, requestsPerSender: 5 })
    expect(() => rl.check('agent://a.com')).not.toThrow()
    expect(() => rl.check('agent://a.com')).not.toThrow()
  })

  it('throws RATE_LIMITED when per-sender limit exceeded', () => {
    const rl = new RateLimiter({ requestsPerMinute: 100, requestsPerSender: 2 })
    rl.check('agent://a.com')
    rl.check('agent://a.com')
    expect(() => rl.check('agent://a.com'))
      .toThrow(expect.objectContaining({ code: ErrorCode.RATE_LIMITED }))
  })

  it('throws TOKEN_BUDGET_EXCEEDED when daily token budget exhausted', () => {
    const rl = new RateLimiter({ requestsPerMinute: 100, requestsPerSender: 100, tokensPerSenderPerDay: 1000 })
    rl.recordTokens('agent://a.com', 1001)
    expect(() => rl.check('agent://a.com'))
      .toThrow(expect.objectContaining({ code: ErrorCode.TOKEN_BUDGET_EXCEEDED }))
  })

  it('does not enforce token budget when not configured', () => {
    const rl = new RateLimiter({ requestsPerMinute: 100, requestsPerSender: 100 })
    rl.recordTokens('agent://a.com', 999999)
    expect(() => rl.check('agent://a.com')).not.toThrow()
  })

  it('throws RATE_LIMITED when global requestsPerMinute exceeded across different senders', () => {
    const rl = new RateLimiter({ requestsPerMinute: 3, requestsPerSender: 100 })
    rl.check('agent://a.com')
    rl.check('agent://b.com')
    rl.check('agent://c.com')
    expect(() => rl.check('agent://d.com'))
      .toThrow(expect.objectContaining({ code: ErrorCode.RATE_LIMITED }))
  })

  it('does not count global requests outside the 60-second window', () => {
    const rl = new RateLimiter({ requestsPerMinute: 2, requestsPerSender: 100 })
    rl.check('agent://a.com')
    rl.check('agent://b.com')
    // The two requests above are both fresh — limit reached.
    // A third from a new sender should be blocked.
    expect(() => rl.check('agent://c.com'))
      .toThrow(expect.objectContaining({ code: ErrorCode.RATE_LIMITED }))
  })
})
