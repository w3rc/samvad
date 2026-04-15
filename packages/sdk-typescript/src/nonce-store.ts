// SPDX-License-Identifier: Apache-2.0
export type NonceCheckResult = 'ok' | 'replay' | 'expired'

// Accept messages up to 60 seconds into the future to allow for clock skew
const CLOCK_SKEW_MS = 60_000

/**
 * Adapter interface for nonce stores. Implement this to plug in any backend
 * (Redis, DynamoDB, etc.). The in-process default is InMemoryNonceStore.
 *
 * `check` must be atomic: it checks for an existing nonce and records it in
 * a single operation to prevent TOCTOU races under concurrent requests.
 */
export interface NonceStoreAdapter {
  check(nonce: string, timestamp: string): NonceCheckResult | Promise<NonceCheckResult>
}

/**
 * Default in-process nonce store. Works correctly for single-instance
 * deployments. Not suitable for serverless or multi-replica deployments
 * where each instance has isolated memory — use UpstashRedisNonceStore
 * (or a similar adapter) instead.
 */
export class InMemoryNonceStore implements NonceStoreAdapter {
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

/**
 * @deprecated Use InMemoryNonceStore instead. This alias exists for backwards
 * compatibility and will be removed in a future major version.
 */
export class NonceStore extends InMemoryNonceStore {}

/**
 * Upstash Redis nonce store adapter for serverless and multi-replica deployments.
 *
 * Uses Redis `SET key value NX PX ttl` — a single atomic command that both
 * checks for the key's existence and sets it if absent. This eliminates the
 * TOCTOU race that would occur with separate GET + SET calls.
 *
 * Install the Upstash Redis SDK before using this adapter:
 *   npm install @upstash/redis
 *
 * Usage:
 *   import { Redis } from '@upstash/redis'
 *   import { UpstashRedisNonceStore } from '@samvad-protocol/sdk'
 *
 *   const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! })
 *   const agent = new Agent({ ..., nonceStore: new UpstashRedisNonceStore(redis) })
 */
export class UpstashRedisNonceStore implements NonceStoreAdapter {
  private readonly windowMs: number
  // Key prefix to avoid collisions with other data in the same Redis instance
  private readonly prefix = 'samvad:nonce:'

  /**
   * @param redis  An @upstash/redis `Redis` instance (or any object with a
   *               compatible `set(key, value, { nx: true, px: number })` method).
   * @param windowMs  Nonce validity window in milliseconds. Must match the
   *                  timestamp window used by the sender. Default: 5 minutes.
   */
  constructor(
    private readonly redis: UpstashRedisClient,
    windowMs?: number,
  ) {
    this.windowMs = windowMs ?? 5 * 60_000
  }

  async check(nonce: string, timestamp: string): Promise<NonceCheckResult> {
    const ts = new Date(timestamp).getTime()
    const now = Date.now()

    if (isNaN(ts) || now - ts > this.windowMs || ts - now > CLOCK_SKEW_MS) return 'expired'

    // SET key 1 NX PX ttl — returns 'OK' on success, null if key already exists.
    // Atomic: no TOCTOU race between checking and recording the nonce.
    const remaining = this.windowMs - (now - ts)
    const result = await this.redis.set(
      `${this.prefix}${nonce}`,
      '1',
      { nx: true, px: Math.max(remaining, 1) },
    )

    return result === null ? 'replay' : 'ok'
  }
}

/**
 * Minimal interface for the Upstash Redis client. Using a structural type
 * rather than importing @upstash/redis directly keeps this adapter dependency-
 * free — the SDK doesn't need @upstash/redis installed to compile.
 */
export interface UpstashRedisClient {
  set(
    key: string,
    value: string,
    options: { nx: boolean; px: number },
  ): Promise<'OK' | null>
}
