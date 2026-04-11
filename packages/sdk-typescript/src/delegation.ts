import { SignJWT, jwtVerify } from 'jose'
import * as ed from '@noble/ed25519'
import { SamvadError, ErrorCode } from './errors.js'

export interface DelegationClaims {
  iss: string
  sub: string
  scope: string[]
  maxDepth: number
  act?: { sub: string }
}

export interface CreateDelegationOptions {
  issuer: string
  subject: string
  scope: string[]
  maxDepth: number
  expiresInSeconds: number
  privateKey: Uint8Array
  parentActor?: string   // for chained delegation (RFC 8693 act claim)
}

// jose requires CryptoKey — convert from raw Uint8Array using SubtleCrypto
async function toPrivateCryptoKey(privateKey: Uint8Array): Promise<CryptoKey> {
  const publicKey = await ed.getPublicKeyAsync(privateKey)
  const jwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    d: Buffer.from(privateKey).toString('base64url'),
    x: Buffer.from(publicKey).toString('base64url'),
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign'])
}

async function toPublicCryptoKey(publicKey: Uint8Array): Promise<CryptoKey> {
  const jwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    x: Buffer.from(publicKey).toString('base64url'),
  }
  return crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify'])
}

export async function createDelegationToken(opts: CreateDelegationOptions): Promise<string> {
  const privateKeyObj = await toPrivateCryptoKey(opts.privateKey)
  const payload: Record<string, unknown> = {
    scope: opts.scope,
    maxDepth: opts.maxDepth,
  }
  if (opts.parentActor) payload.act = { sub: opts.parentActor }

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(opts.issuer)
    .setSubject(opts.subject)
    .setIssuedAt()
    .setExpirationTime(`${opts.expiresInSeconds}s`)
    .sign(privateKeyObj)
}

export async function verifyDelegationToken(token: string, publicKey: Uint8Array): Promise<DelegationClaims> {
  const publicKeyObj = await toPublicCryptoKey(publicKey)
  let payload
  try {
    const result = await jwtVerify(token, publicKeyObj)
    payload = result.payload
  } catch (err) {
    throw new SamvadError(ErrorCode.AUTH_FAILED, `Invalid or expired delegation token: ${(err as Error).message}`)
  }

  const maxDepth = payload.maxDepth as number
  if (maxDepth <= 0) throw new SamvadError(ErrorCode.DELEGATION_EXCEEDED, 'Delegation depth limit reached')

  return {
    iss: payload.iss as string,
    sub: payload.sub as string,
    scope: payload.scope as string[],
    maxDepth,
    act: payload.act as { sub: string } | undefined,
  }
}
