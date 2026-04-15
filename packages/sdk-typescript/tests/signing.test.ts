import { describe, it, expect } from 'vitest'
import { signRequest, verifyRequest, computeContentDigest, parseKeyId } from '../src/signing.js'
import { generateKeypair } from '../src/keys.js'

const METHOD = 'POST'
const PATH = '/agent/message'

function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

describe('computeContentDigest', () => {
  it('produces a sha-256 Content-Digest header value', async () => {
    const digest = await computeContentDigest(toBytes('hello'))
    expect(digest).toMatch(/^sha-256=:[A-Za-z0-9+/]+=*:$/)
  })

  it('is deterministic for the same input', async () => {
    const body = toBytes('{"key":"value"}')
    expect(await computeContentDigest(body)).toBe(await computeContentDigest(body))
  })

  it('differs for different inputs', async () => {
    expect(await computeContentDigest(toBytes('a'))).not.toBe(await computeContentDigest(toBytes('b')))
  })
})

describe('parseKeyId', () => {
  it('extracts keyid from Signature-Input value', () => {
    const sigInput = 'sig1=("@method" "@path" "content-digest");keyid="key-1";alg="ed25519"'
    expect(parseKeyId(sigInput)).toBe('key-1')
  })

  it('returns null when keyid is missing', () => {
    expect(parseKeyId('sig1=("@method");alg="ed25519"')).toBeNull()
  })
})

describe('signRequest / verifyRequest', () => {
  it('signs and verifies successfully', async () => {
    const kp = await generateKeypair('key-1')
    const body = toBytes('{"from":"agent://a"}')
    const headers = await signRequest(METHOD, PATH, body, kp)
    expect(headers['content-digest']).toMatch(/^sha-256=:/)
    expect(headers['signature-input']).toMatch(/^sig1=\(/)
    expect(headers['signature']).toMatch(/^sig1=:/)
    const ok = await verifyRequest(METHOD, PATH, body, headers, kp.publicKey)
    expect(ok).toBe(true)
  })

  it('fails when body is tampered after signing', async () => {
    const kp = await generateKeypair('key-1')
    const originalBody = toBytes('{"from":"agent://a"}')
    const headers = await signRequest(METHOD, PATH, originalBody, kp)
    const tamperedBody = toBytes('{"from":"agent://evil"}')
    const ok = await verifyRequest(METHOD, PATH, tamperedBody, headers, kp.publicKey)
    expect(ok).toBe(false)
  })

  it('fails when verified with the wrong public key', async () => {
    const kp1 = await generateKeypair('key-1')
    const kp2 = await generateKeypair('key-2')
    const body = toBytes('{"from":"agent://a"}')
    const headers = await signRequest(METHOD, PATH, body, kp1)
    const ok = await verifyRequest(METHOD, PATH, body, headers, kp2.publicKey)
    expect(ok).toBe(false)
  })

  it('fails when the path differs', async () => {
    const kp = await generateKeypair('key-1')
    const body = toBytes('{"from":"agent://a"}')
    const headers = await signRequest(METHOD, PATH, body, kp)
    const ok = await verifyRequest(METHOD, '/agent/task', body, headers, kp.publicKey)
    expect(ok).toBe(false)
  })

  it('fails when the method differs', async () => {
    const kp = await generateKeypair('key-1')
    const body = toBytes('{"from":"agent://a"}')
    const headers = await signRequest(METHOD, PATH, body, kp)
    const ok = await verifyRequest('GET', PATH, body, headers, kp.publicKey)
    expect(ok).toBe(false)
  })

  it('includes keyid in Signature-Input', async () => {
    const kp = await generateKeypair('my-key-id')
    const headers = await signRequest(METHOD, PATH, toBytes('{}'), kp)
    expect(headers['signature-input']).toContain('keyid="my-key-id"')
    expect(parseKeyId(headers['signature-input'])).toBe('my-key-id')
  })
})
