import { describe, it, expect } from 'vitest'
import { signEnvelope, verifyEnvelope, canonicalise } from '../src/signing.js'
import { generateKeypair } from '../src/keys.js'
import type { MessageEnvelope } from '../src/types.js'

function makeEnvelope(overrides: Partial<MessageEnvelope> = {}): MessageEnvelope {
  return {
    from: 'agent://sender.com',
    to: 'agent://receiver.com',
    skill: 'test-skill',
    mode: 'sync',
    nonce: 'abc123',
    timestamp: new Date().toISOString(),
    kid: 'key-1',
    signature: '',
    traceId: 'trace-1',
    spanId: 'span-1',
    payload: { input: 'hello' },
    ...overrides,
  }
}

describe('signing', () => {
  it('signs an envelope and verifies it', async () => {
    const kp = await generateKeypair('key-1')
    const env = makeEnvelope()
    const signed = await signEnvelope(env, kp)
    expect(signed.signature).not.toBe('')
    const ok = await verifyEnvelope(signed, kp.publicKey)
    expect(ok).toBe(true)
  })

  it('fails verification when payload is tampered', async () => {
    const kp = await generateKeypair('key-1')
    const env = makeEnvelope()
    const signed = await signEnvelope(env, kp)
    signed.payload = { input: 'tampered' }
    const ok = await verifyEnvelope(signed, kp.publicKey)
    expect(ok).toBe(false)
  })

  it('fails verification when signature is wrong key', async () => {
    const kp1 = await generateKeypair('key-1')
    const kp2 = await generateKeypair('key-2')
    const env = makeEnvelope()
    const signed = await signEnvelope(env, kp1)
    const ok = await verifyEnvelope(signed, kp2.publicKey)
    expect(ok).toBe(false)
  })

  it('canonicalise produces deterministic output', () => {
    const a = canonicalise({ b: 2, a: 1 })
    const b = canonicalise({ a: 1, b: 2 })
    expect(a).toBe(b)
  })
})
