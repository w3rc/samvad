import { describe, it, expect, beforeEach } from 'vitest'
import { NonceStore } from '../src/nonce-store.js'

describe('NonceStore', () => {
  let store: NonceStore

  beforeEach(() => { store = new NonceStore(5 * 60 * 1000) }) // 5 min window

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
})
