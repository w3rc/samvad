import { SamvadError, ErrorCode } from './errors.js'
import type { RateLimit } from './types.js'

interface SenderState {
  requestTimestamps: number[]   // timestamps in current minute window
  dailyTokens: number           // tokens consumed today
  dayStart: number              // UTC midnight of current day (ms)
}

export class RateLimiter {
  private senders = new Map<string, SenderState>()

  constructor(private config: RateLimit) {}

  check(sender: string): void {
    const state = this.getOrCreate(sender)
    const now = Date.now()

    // Reset daily tokens at UTC midnight
    const todayStart = new Date().setUTCHours(0, 0, 0, 0)
    if (state.dayStart < todayStart) {
      state.dailyTokens = 0
      state.dayStart = todayStart
    }

    // Token budget check (before processing request)
    if (this.config.tokensPerSenderPerDay !== undefined &&
        state.dailyTokens >= this.config.tokensPerSenderPerDay) {
      throw new SamvadError(ErrorCode.TOKEN_BUDGET_EXCEEDED,
        `Daily token budget of ${this.config.tokensPerSenderPerDay} exceeded`)
    }

    // Sliding window: keep only timestamps within last 60 seconds
    const windowStart = now - 60_000
    state.requestTimestamps = state.requestTimestamps.filter(t => t > windowStart)

    // Per-sender rate limit
    if (state.requestTimestamps.length >= this.config.requestsPerSender) {
      throw new SamvadError(ErrorCode.RATE_LIMITED,
        `Rate limit of ${this.config.requestsPerSender} requests/minute exceeded`)
    }

    state.requestTimestamps.push(now)
  }

  recordTokens(sender: string, tokens: number): void {
    const state = this.getOrCreate(sender)
    state.dailyTokens += tokens
  }

  private getOrCreate(sender: string): SenderState {
    if (!this.senders.has(sender)) {
      this.senders.set(sender, {
        requestTimestamps: [],
        dailyTokens: 0,
        dayStart: new Date().setUTCHours(0, 0, 0, 0),
      })
    }
    return this.senders.get(sender)!
  }
}
