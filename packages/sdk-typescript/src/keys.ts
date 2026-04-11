// SPDX-License-Identifier: Apache-2.0
import * as ed from '@noble/ed25519'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface Keypair {
  kid: string
  privateKey: Uint8Array
  publicKey: Uint8Array
}

export async function generateKeypair(kid: string): Promise<Keypair> {
  const privateKey = ed.utils.randomPrivateKey()
  const publicKey = await ed.getPublicKeyAsync(privateKey)
  return { kid, privateKey, publicKey }
}

export async function saveKeypair(kp: Keypair, dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const data = {
    kid: kp.kid,
    privateKey: Buffer.from(kp.privateKey).toString('base64'),
    publicKey: Buffer.from(kp.publicKey).toString('base64'),
  }
  await writeFile(join(dir, `${kp.kid}.json`), JSON.stringify(data), { mode: 0o600 })
}

export async function loadKeypair(dir: string, kid: string): Promise<Keypair> {
  const raw = await readFile(join(dir, `${kid}.json`), 'utf-8')
  const data = JSON.parse(raw) as { kid: string; privateKey: string; publicKey: string }
  return {
    kid: data.kid,
    privateKey: new Uint8Array(Buffer.from(data.privateKey, 'base64')),
    publicKey: new Uint8Array(Buffer.from(data.publicKey, 'base64')),
  }
}

export function encodePublicKey(publicKey: Uint8Array): string {
  return Buffer.from(publicKey).toString('base64')
}

export function decodePublicKey(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, 'base64'))
}
