// SPDX-License-Identifier: Apache-2.0
export type NonceCheckResult = 'ok' | 'replay' | 'expired'

// Accept messages up to 60 seconds into the future to allow for clock skew
const CLOCK_SKEW_MS = 60_000

export class NonceStore {
  // Map from nonce to insertion timestamp — insertion-ordered for O(k) eviction
  private seen = new Map<string, number>()

  constructor(private windowMs: number) {}

  check(nonce: string, timestamp: string): NonceCheckResult {
    const ts = new Date(timestamp).getTime()
    const now = Date.now()

    if (isNaN(ts) || now - ts > this.windowMs || ts - now > CLOCK_SKEW_MS) return 'expired'
    if (this.seen.has(nonce)) return 'replay'

    this.seen.set(nonce, now)
    this.evict()
    return 'ok'
  }

  // Evict expired nonces — Map is insertion-ordered so we only scan from the front.
  // Correctness relies on Date.now() being non-decreasing (NTP backward jumps would
  // cause under-eviction, leaving some stale entries — harmless but not a security risk).
  private evict(): void {
    const cutoff = Date.now() - this.windowMs
    for (const [nonce, ts] of this.seen) {
      if (ts >= cutoff) break  // all subsequent entries are newer
      this.seen.delete(nonce)
    }
  }
}
