import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateKeypair, saveKeypair, loadKeypair, encodePublicKey } from '../src/keys.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('keys', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'samvad-keys-')) })
  afterEach(() => { rmSync(dir, { recursive: true }) })

  it('generates a keypair with kid', async () => {
    const kp = await generateKeypair('key-1')
    expect(kp.kid).toBe('key-1')
    expect(kp.privateKey).toBeInstanceOf(Uint8Array)
    expect(kp.publicKey).toBeInstanceOf(Uint8Array)
    expect(kp.privateKey.length).toBe(32)
    expect(kp.publicKey.length).toBe(32)
  })

  it('saves and loads a keypair from disk', async () => {
    const kp = await generateKeypair('key-1')
    await saveKeypair(kp, dir)
    const loaded = await loadKeypair(dir, 'key-1')
    expect(loaded.kid).toBe('key-1')
    expect(loaded.privateKey).toEqual(kp.privateKey)
    expect(loaded.publicKey).toEqual(kp.publicKey)
  })

  it('encodes public key as base64', async () => {
    const kp = await generateKeypair('key-1')
    const encoded = encodePublicKey(kp.publicKey)
    expect(typeof encoded).toBe('string')
    expect(Buffer.from(encoded, 'base64').length).toBe(32)
  })
})
