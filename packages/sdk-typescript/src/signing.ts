// SPDX-License-Identifier: Apache-2.0
import * as ed from '@noble/ed25519'
import type { Keypair } from './keys.js'

// Browser-safe base64 helpers (loop-based — spread-based causes stack overflow on large arrays)
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * RFC 9421 HTTP Message Signatures — minimal implementation for SAMVAD.
 *
 * Signed components: "@method", "@path", "content-digest"
 * Algorithm: ed25519 (EdDSA over Curve25519)
 * Body integrity: Content-Digest (RFC 9530, sha-256)
 *
 * Note: the `created` timestamp in Signature-Input is part of the signed payload and
 * is echoed back verbatim during verification. Its freshness is NOT checked here —
 * envelope-level replay protection (nonce + timestamp window) in NonceStore handles that.
 * A future upgrade to full RFC 9421 compliance would add a `created` freshness window.
 */

// Compute Content-Digest header value per RFC 9530
export async function computeContentDigest(bodyBytes: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bodyBytes as unknown as BufferSource)
  return `sha-256=:${uint8ToBase64(new Uint8Array(hashBuffer))}:`
}

// Parse the keyid from a Signature-Input header value
// e.g. sig1=("@method" "@path" "content-digest");keyid="key-1";alg="ed25519"
export function parseKeyId(signatureInput: string): string | null {
  const m = signatureInput.match(/keyid="([^"]+)"/)
  return m ? m[1] : null
}

// Build the RFC 9421 signature base string (Section 2.5)
function buildSignatureBase(
  method: string,
  path: string,
  contentDigest: string,
  signatureParams: string,  // everything after "sig1=" in Signature-Input
): string {
  // Each component line is: "name": value\n  — including the final @signature-params line
  return (
    `"@method": ${method.toUpperCase()}\n` +
    `"@path": ${path}\n` +
    `"content-digest": ${contentDigest}\n` +
    `"@signature-params": ${signatureParams}\n`
  )
}

function makeSignatureParams(kid: string, created: number): string {
  return `("@method" "@path" "content-digest");keyid="${kid}";alg="ed25519";created=${created}`
}

export interface RequestSignatureHeaders {
  'content-digest': string
  'signature-input': string
  'signature': string
}

/**
 * Sign an HTTP request body and produce the three RFC 9421 headers.
 * The caller must send these headers along with the body.
 */
export async function signRequest(
  method: string,
  path: string,
  bodyBytes: Uint8Array,
  kp: Keypair,
): Promise<RequestSignatureHeaders> {
  const contentDigest = await computeContentDigest(bodyBytes)
  const created = Math.floor(Date.now() / 1000)
  const signatureParams = makeSignatureParams(kp.kid, created)
  const sigBase = buildSignatureBase(method, path, contentDigest, signatureParams)
  const sigBytes = await ed.signAsync(new TextEncoder().encode(sigBase), kp.privateKey)
  return {
    'content-digest': contentDigest,
    'signature-input': `sig1=${signatureParams}`,
    'signature': `sig1=:${uint8ToBase64(sigBytes)}:`,
  }
}

/**
 * Verify RFC 9421 signature headers against the raw request body.
 * Returns true only if body integrity AND signature are both valid.
 */
export async function verifyRequest(
  method: string,
  path: string,
  bodyBytes: Uint8Array,
  headers: RequestSignatureHeaders,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    const { 'content-digest': contentDigest, 'signature-input': sigInputFull, 'signature': sigFull } = headers

    // Verify body integrity first (cheap hash check before expensive crypto)
    const expectedDigest = await computeContentDigest(bodyBytes)
    if (contentDigest !== expectedDigest) return false

    // Parse sig1=<params> from Signature-Input
    const paramsMatch = sigInputFull.match(/^sig1=(.+)$/)
    if (!paramsMatch) return false
    const signatureParams = paramsMatch[1]

    // Reconstruct the signature base the sender would have produced
    const sigBase = buildSignatureBase(method, path, contentDigest, signatureParams)

    // Parse sig1=:base64: from Signature
    const sigMatch = sigFull.match(/^sig1=:([^:]+):$/)
    if (!sigMatch) return false
    const sig = base64ToUint8(sigMatch[1])

    return await ed.verifyAsync(sig, new TextEncoder().encode(sigBase), publicKey)
  } catch {
    return false
  }
}
