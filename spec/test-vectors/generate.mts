// SPDX-License-Identifier: Apache-2.0
// Run with: npx tsx spec/test-vectors/generate.mts
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { signRequest, computeContentDigest, parseKeyId } from '../../packages/sdk-typescript/src/signing.js'
import {
  generateKeypair,
  saveKeypair,
  loadKeypair,
  encodePublicKey,
} from '../../packages/sdk-typescript/src/keys.js'
import { existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dir = dirname(__filename)

const keysDir = join(__dir, 'keys')
mkdirSync(keysDir, { recursive: true })

const KID = 'vector-kid'
const keyFile = join(keysDir, `${KID}.json`)

let kp
if (existsSync(keyFile)) {
  kp = await loadKeypair(keysDir, KID)
} else {
  kp = await generateKeypair(KID)
  await saveKeypair(kp, keysDir)
}

const cases: Array<{
  name: string
  method: string
  path: string
  bodyJson: string
  expectedResult: { 'content-digest': string; 'signature-input': string; 'signature': string }
}> = []

const testInputs = [
  {
    name: 'simple-echo',
    method: 'POST',
    path: '/agent/message',
    body: { skill: 'echo', payload: { text: 'hello' } },
  },
  {
    name: 'utf8-payload',
    method: 'POST',
    path: '/agent/message',
    body: { skill: 'translate', payload: { text: 'भारत', lang: 'en' } },
  },
  {
    name: 'nested-sort',
    method: 'POST',
    path: '/agent/task',
    body: { z: { b: 2, a: 1 }, a: 'first' },
  },
]

for (const input of testInputs) {
  const bodyStr = JSON.stringify(input.body)
  const bodyBytes = new TextEncoder().encode(bodyStr)
  const signed = await signRequest(input.method, input.path, bodyBytes, kp)
  cases.push({
    name: input.name,
    method: input.method,
    path: input.path,
    bodyJson: bodyStr,
    expectedResult: signed,
  })
}

const output = {
  description: 'RFC 9421 test vectors signed by the TypeScript SAMVAD SDK',
  protocolVersion: '1.2',
  publicKeyB64: encodePublicKey(kp.publicKey),
  kid: kp.kid,
  cases,
}

const outPath = join(__dir, 'vectors.json')
writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n')
console.log(`Wrote ${cases.length} vectors to ${outPath}`)
console.log(`Public key (kid=${kp.kid}): ${encodePublicKey(kp.publicKey)}`)
