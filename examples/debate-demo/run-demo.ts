// SPDX-License-Identifier: Apache-2.0
import { spawn, ChildProcess } from 'child_process'
import { AgentClient } from '@samvad-protocol/sdk'

const RESEARCHER_URL = 'http://localhost:3010'
const CRITIC_URL = 'http://localhost:3011'
const MOCK = process.env.MOCK === 'true'
const TOPIC = process.argv[2] ?? 'AI will replace software engineers'

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const line = () => console.log(dim('─'.repeat(60)))

function startAgent(script: string, env: Record<string, string>): ChildProcess {
  return spawn('tsx', [script], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function waitForHealth(url: string, retries = 20): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${url}/agent/health`)
      if (res.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`Agent at ${url} did not become healthy`)
}

async function main() {
  console.log()
  console.log(bold('SAMVAD Debate Demo'))
  console.log(dim(`Topic: "${TOPIC}"`))
  if (MOCK) console.log(yellow('  [mock mode — set ANTHROPIC_API_KEY to use real Claude]'))
  console.log()

  const mockEnv = MOCK ? { MOCK: 'true' } : {}

  const critic = startAgent('critic.ts', { PORT: '3011', ...mockEnv })
  const researcher = startAgent('researcher.ts', {
    PORT: '3010',
    CRITIC_URL,
    ...mockEnv,
  })

  const procs = [critic, researcher]

  // Graceful shutdown
  const cleanup = () => { procs.forEach(p => p.kill()); process.exit(0) }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  try {
    process.stdout.write(dim('Starting agents'))
    await Promise.all([
      waitForHealth(CRITIC_URL),
      waitForHealth(RESEARCHER_URL),
    ])
    console.log(dim(' ✓'))
    console.log()

    const client = await AgentClient.from(RESEARCHER_URL)

    console.log(dim(`${RESEARCHER_URL}  →  ${CRITIC_URL}`))
    console.log(dim('skill: research → critique'))
    line()
    console.log()

    const result = await client.call('research', { topic: TOPIC }) as {
      topic: string
      claims: string[]
      counterarguments: string[]
      criticAgentId: string
      traceId: string
    }

    console.log(cyan(bold('RESEARCHER')) + dim(` (${RESEARCHER_URL})`))
    result.claims.forEach((claim, i) => {
      console.log(`  ${dim(`${i + 1}.`)} ${claim}`)
    })

    console.log()
    line()
    console.log()

    console.log(yellow(bold('CRITIC')) + dim(` (${result.criticAgentId})`))
    result.counterarguments.forEach((ca, i) => {
      console.log(`  ${dim(`${i + 1}.`)} ${ca}`)
    })

    console.log()
    line()
    console.log(dim(`traceId: ${result.traceId}`))
    console.log(green('✓ SAMVAD handshake complete — both messages Ed25519-signed'))
    console.log()
  } finally {
    procs.forEach(p => p.kill())
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
