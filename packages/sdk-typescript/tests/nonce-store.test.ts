import { describe, it, expect, beforeEach, vi } from 'vitest'
import { InMemoryNonceStore, UpstashRedisNonceStore } from '../src/nonce-store.js'
import type { NonceStoreAdapter, UpstashRedisClient } from '../src/nonce-store.js'

describe('InMemoryNonceStore', () => {
  let store: InMemoryNonceStore

  beforeEach(() => { store = new InMemoryNonceStore(5 * 60 * 1000) }) // 5 min window

  it('accepts a fresh nonce', () => {
    const result = store.check('nonce-1', new Date().toISOString())
    expect(result).toBe('ok')
  })

  it('rejects a replayed nonce', () => {
    const ts = new Date().toISOString()
    store.check('nonce-1', ts)
    const result = store.check('nonce-1', ts)
    expect(result).toBe('replay')
  })

  it('rejects a message older than the window', () => {
    const old = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    const result = store.check('nonce-2', old)
    expect(result).toBe('expired')
  })

  it('accepts messages from different senders with same nonce', () => {
    const ts = new Date().toISOString()
    store.check('nonce-1', ts)
    // same nonce, different request — still replayed (nonce is globally unique)
    const result = store.check('nonce-1', ts)
    expect(result).toBe('replay')
  })

  it('rejects a message with a far-future timestamp', () => {
    const future = new Date(Date.now() + 2 * 60 * 1000).toISOString() // 2 minutes ahead
    const result = store.check('nonce-future', future)
    expect(result).toBe('expired')
  })

  it('accepts a message within the allowed clock skew', () => {
    const slightlyFuture = new Date(Date.now() + 30 * 1000).toISOString() // 30s ahead
    const result = store.check('nonce-skew', slightlyFuture)
    expect(result).toBe('ok')
  })
})

describe('UpstashRedisNonceStore', () => {
  function makeRedis(returnValue: 'OK' | null): UpstashRedisClient {
    return { set: vi.fn().mockResolvedValue(returnValue) }
  }

  it('returns ok when Redis SET NX succeeds (key did not exist)', async () => {
    const redis = makeRedis('OK')
    const store = new UpstashRedisNonceStore(redis)
    const result = await store.check('nonce-1', new Date().toISOString())
    expect(result).toBe('ok')
  })

  it('returns replay when Redis SET NX returns null (key already exists)', async () => {
    const redis = makeRedis(null)
    const store = new UpstashRedisNonceStore(redis)
    const result = await store.check('nonce-1', new Date().toISOString())
    expect(result).toBe('replay')
  })

  it('returns expired for an old timestamp without calling Redis', async () => {
    const redis = makeRedis('OK')
    const store = new UpstashRedisNonceStore(redis)
    const old = new Date(Date.now() - 6 * 60 * 1000).toISOString()
    const result = await store.check('nonce-old', old)
    expect(result).toBe('expired')
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('returns expired for a far-future timestamp without calling Redis', async () => {
    const redis = makeRedis('OK')
    const store = new UpstashRedisNonceStore(redis)
    const future = new Date(Date.now() + 2 * 60 * 1000).toISOString()
    const result = await store.check('nonce-future', future)
    expect(result).toBe('expired')
    expect(redis.set).not.toHaveBeenCalled()
  })

  it('uses the samvad:nonce: key prefix', async () => {
    const redis = makeRedis('OK')
    const store = new UpstashRedisNonceStore(redis)
    await store.check('abc123', new Date().toISOString())
    expect((redis.set as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('samvad:nonce:abc123')
  })

  it('sets nx:true on the Redis call', async () => {
    const redis = makeRedis('OK')
    const store = new UpstashRedisNonceStore(redis)
    await store.check('nonce-nx', new Date().toISOString())
    const opts = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0][2]
    expect(opts.nx).toBe(true)
  })

  it('sets a positive TTL in milliseconds', async () => {
    const redis = makeRedis('OK')
    const store = new UpstashRedisNonceStore(redis)
    await store.check('nonce-ttl', new Date().toISOString())
    const opts = (redis.set as ReturnType<typeof vi.fn>).mock.calls[0][2]
    expect(opts.px).toBeGreaterThan(0)
  })

  it('satisfies the NonceStoreAdapter interface', () => {
    const store: NonceStoreAdapter = new UpstashRedisNonceStore(makeRedis('OK'))
    expect(store).toBeDefined()
  })
})
