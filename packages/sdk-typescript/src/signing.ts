// SPDX-License-Identifier: Apache-2.0
import * as ed from '@noble/ed25519'
import type { MessageEnvelope } from './types.js'
import type { Keypair } from './keys.js'

// Produce a deterministic JSON string with sorted keys (recursive)
export function canonicalise(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
  if (Array.isArray(obj)) return '[' + obj.map(canonicalise).join(',') + ']'
  const sorted = Object.keys(obj as object).sort()
  return '{' + sorted.map(k => JSON.stringify(k) + ':' + canonicalise((obj as Record<string, unknown>)[k])).join(',') + '}'
}

// Produce the signing input: canonical JSON of all fields except signature
function signingInput(env: MessageEnvelope): Uint8Array {
  const { signature: _sig, ...rest } = env
  return new TextEncoder().encode(canonicalise(rest))
}

export async function signEnvelope(env: MessageEnvelope, kp: Keypair): Promise<MessageEnvelope> {
  const input = signingInput(env)
  const sig = await ed.signAsync(input, kp.privateKey)
  return { ...env, signature: Buffer.from(sig).toString('base64') }
}

export async function verifyEnvelope(env: MessageEnvelope, publicKey: Uint8Array): Promise<boolean> {
  try {
    const input = signingInput(env)
    const sig = new Uint8Array(Buffer.from(env.signature, 'base64'))
    return await ed.verifyAsync(sig, input, publicKey)
  } catch {
    return false
  }
}
