// SPDX-License-Identifier: Apache-2.0
import { SamvadError, ErrorCode } from './errors.js'
import type { RateLimit } from './types.js'

interface SenderState {
  requestTimestamps: number[]   // timestamps in current minute window
  dailyTokens: number           // tokens consumed today
  dayStart: number              // UTC midnight of current day (ms)
}

export class RateLimiter {
  private senders = new Map<string, SenderState>()
  private globalTimestamps: number[] = []  // timestamps across all senders

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

    const windowStart = now - 60_000

    // Global rate limit (requestsPerMinute across all senders)
    this.globalTimestamps = this.globalTimestamps.filter(t => t > windowStart)
    if (this.globalTimestamps.length >= this.config.requestsPerMinute) {
      throw new SamvadError(ErrorCode.RATE_LIMITED,
        `Global rate limit of ${this.config.requestsPerMinute} requests/minute exceeded`)
    }

    // Per-sender rate limit (sliding window)
    state.requestTimestamps = state.requestTimestamps.filter(t => t > windowStart)
    if (state.requestTimestamps.length >= this.config.requestsPerSender) {
      throw new SamvadError(ErrorCode.RATE_LIMITED,
        `Rate limit of ${this.config.requestsPerSender} requests/minute exceeded`)
    }

    this.globalTimestamps.push(now)
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
