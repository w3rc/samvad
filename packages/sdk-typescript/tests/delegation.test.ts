import { describe, it, expect } from 'vitest'
import { createDelegationToken, verifyDelegationToken } from '../src/delegation.js'
import { generateKeypair } from '../src/keys.js'
import { ErrorCode } from '../src/errors.js'

describe('delegation', () => {
  it('creates and verifies a delegation token', async () => {
    const kp = await generateKeypair('key-1')
    const token = await createDelegationToken({
      issuer: 'agent://a.com',
      subject: 'agent://b.com',
      scope: ['review-code'],
      maxDepth: 2,
      expiresInSeconds: 3600,
      privateKey: kp.privateKey,
    })
    expect(typeof token).toBe('string')

    const claims = await verifyDelegationToken(token, kp.publicKey)
    expect(claims.iss).toBe('agent://a.com')
    expect(claims.sub).toBe('agent://b.com')
    expect(claims.scope).toContain('review-code')
    expect(claims.maxDepth).toBe(2)
  })

  it('throws DELEGATION_EXCEEDED when maxDepth is 0', async () => {
    const kp = await generateKeypair('key-1')
    const token = await createDelegationToken({
      issuer: 'agent://a.com',
      subject: 'agent://b.com',
      scope: ['review-code'],
      maxDepth: 0,
      expiresInSeconds: 3600,
      privateKey: kp.privateKey,
    })
    await expect(verifyDelegationToken(token, kp.publicKey))
      .rejects.toMatchObject({ code: ErrorCode.DELEGATION_EXCEEDED })
  })

  it('throws AUTH_FAILED when scope claim is missing', async () => {
    const kp = await generateKeypair('key-1')
    // Manually craft a JWT without a scope claim using jose
    const { SignJWT } = await import('jose')
    const jwk = { kty: 'OKP', crv: 'Ed25519', d: Buffer.from(kp.privateKey).toString('base64url'), x: Buffer.from(kp.publicKey).toString('base64url') }
    const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign'])
    const token = await new SignJWT({ maxDepth: 1 })  // no scope
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer('agent://a.com').setSubject('agent://b.com')
      .setExpirationTime('1h')
      .sign(privateKey)
    await expect(verifyDelegationToken(token, kp.publicKey))
      .rejects.toMatchObject({ code: ErrorCode.AUTH_FAILED })
  })

  it('throws AUTH_FAILED when maxDepth claim is missing', async () => {
    const kp = await generateKeypair('key-1')
    const { SignJWT } = await import('jose')
    const jwk = { kty: 'OKP', crv: 'Ed25519', d: Buffer.from(kp.privateKey).toString('base64url'), x: Buffer.from(kp.publicKey).toString('base64url') }
    const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign'])
    const token = await new SignJWT({ scope: ['echo'] })  // no maxDepth
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer('agent://a.com').setSubject('agent://b.com')
      .setExpirationTime('1h')
      .sign(privateKey)
    await expect(verifyDelegationToken(token, kp.publicKey))
      .rejects.toMatchObject({ code: ErrorCode.AUTH_FAILED })
  })

  it('throws AUTH_FAILED for expired token', async () => {
    const kp = await generateKeypair('key-1')
    const token = await createDelegationToken({
      issuer: 'agent://a.com',
      subject: 'agent://b.com',
      scope: ['review-code'],
      maxDepth: 2,
      expiresInSeconds: -1,  // already expired
      privateKey: kp.privateKey,
    })
    await expect(verifyDelegationToken(token, kp.publicKey))
      .rejects.toMatchObject({ code: ErrorCode.AUTH_FAILED })
  })
})
