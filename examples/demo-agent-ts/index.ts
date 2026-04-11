// SPDX-License-Identifier: Apache-2.0
import { Agent } from '@samvad-protocol/sdk'
import { z } from 'zod'

const DEMO_URL = process.env.DEMO_URL ?? 'http://localhost:3003'
const PORT = Number(process.env.PORT ?? 3003)

const agent = new Agent({
  name: 'SAMVAD Demo Agent',
  version: '1.0.0',
  description:
    'A live demo agent for the SAMVAD protocol. Call any skill — no setup, no account, no API key. ' +
    'Every request is Ed25519-signed, rate-limited, and replay-protected automatically.',
  url: DEMO_URL,
  specializations: ['demo', 'protocol-verification'],
  rateLimit: {
    requestsPerMinute: 30,
    requestsPerSender: 5,
    tokensPerSenderPerDay: 10000,
  },
})

agent.skill('ping', {
  name: 'Ping',
  description:
    'Returns a signed pong. Verifies the full SAMVAD handshake: ' +
    'your envelope was Ed25519-verified, the nonce was checked, rate limits applied.',
  input: z.object({}),
  output: z.object({
    pong: z.literal(true),
    protocolVersion: z.string(),
    message: z.string(),
  }),
  modes: ['sync'],
  trust: 'public',
  handler: async (_input, ctx) => ({
    pong: true as const,
    protocolVersion: '1.1',
    message:
      `Verified. Your envelope was signed by ${ctx.sender}, ` +
      `nonce checked, rate limit applied. TraceId: ${ctx.traceId}`,
  }),
})

agent.skill('whoami', {
  name: 'Who Am I',
  description:
    'Returns the verified agent:// identity of the caller, proven by Ed25519 signature verification. ' +
    'This is what SAMVAD identity looks like: your domain, your key, no accounts.',
  input: z.object({}),
  output: z.object({
    callerId: z.string(),
    traceId: z.string(),
    message: z.string(),
  }),
  modes: ['sync'],
  trust: 'public',
  handler: async (_input, ctx) => ({
    callerId: ctx.sender,
    traceId: ctx.traceId,
    message:
      `Your identity is ${ctx.sender}. Verified by checking your Ed25519 signature ` +
      `against the public key in your agent card — no passwords, no tokens, no central authority.`,
  }),
})

agent.skill('echo', {
  name: 'Echo',
  description:
    'Validates your input against a JSON Schema and echoes it back with request metadata. ' +
    'Unknown fields are dropped. maxLength is enforced. This is SAMVAD input validation in action.',
  input: z.object({
    message: z.string().min(1).max(500),
    tag: z.string().max(50).optional(),
  }),
  output: z.object({
    echo: z.object({
      message: z.string(),
      tag: z.string().optional(),
    }),
    meta: z.object({
      sender: z.string(),
      traceId: z.string(),
      timestamp: z.string(),
    }),
  }),
  modes: ['sync', 'stream'],
  trust: 'public',
  handler: async (input, ctx) => {
    const { message, tag } = input as { message: string; tag?: string }
    return {
      echo: { message, ...(tag !== undefined ? { tag } : {}) },
      meta: {
        sender: ctx.sender,
        traceId: ctx.traceId,
        timestamp: new Date().toISOString(),
      },
    }
  },
})

agent.serve({ port: PORT })
console.log(`SAMVAD demo agent running on ${DEMO_URL}`)
