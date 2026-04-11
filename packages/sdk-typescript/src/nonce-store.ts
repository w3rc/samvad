export type NonceCheckResult = 'ok' | 'replay' | 'expired'

export class NonceStore {
  // Map from nonce to timestamp it was first seen
  private seen = new Map<string, number>()

  constructor(private windowMs: number) {}

  check(nonce: string, timestamp: string): NonceCheckResult {
    const ts = new Date(timestamp).getTime()
    const now = Date.now()

    if (isNaN(ts) || now - ts > this.windowMs) return 'expired'
    if (this.seen.has(nonce)) return 'replay'

    this.seen.set(nonce, now)
    this.evict()
    return 'ok'
  }

  // Remove nonces older than the window to prevent unbounded memory growth
  private evict(): void {
    const cutoff = Date.now() - this.windowMs
    for (const [nonce, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(nonce)
    }
  }
}
