// SPDX-License-Identifier: Apache-2.0
import { Agent, AgentClient } from '@samvad-protocol/sdk'
import { buildCriticSkill } from './critic.js'
import { buildResearcherSkill } from './researcher.js'

const TOPIC = process.argv[2] ?? 'AI will replace software engineers'
const MOCK = process.env.MOCK === 'true'
const CRITIC_PORT = 3011
const RESEARCHER_PORT = 3010
const CRITIC_URL = `http://localhost:${CRITIC_PORT}`
const RESEARCHER_URL = `http://localhost:${RESEARCHER_PORT}`

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const line = () => console.log(dim('─'.repeat(60)))

async function main() {
  console.log()
  console.log(bold('SAMVAD Debate Demo'))
  console.log(dim(`Topic: "${TOPIC}"`))
  if (MOCK) console.log(yellow('  [mock mode — set ANTHROPIC_API_KEY to use real Claude]'))
  console.log()

  // ── Step 1: Pre-generate all keypairs ──────────────────────────────────────
  // Runner key (used by this orchestrator to call researcher)
  const runnerClient = await AgentClient.prepare({
    keysDir: '.samvad/runner-keys',
    agentId: 'agent://runner.local',
  })

  // Researcher-outbound key (used when researcher calls critic)
  // Must be stable across calls, so we pre-generate and register with critic
  const researcherOutboundClient = await AgentClient.prepare({
    keysDir: '.samvad/researcher-outbound-keys',
    agentId: 'agent://researcher-outbound.local',
  })

  // ── Step 2: Build critic agent ─────────────────────────────────────────────
  const criticAgent = new Agent({
    name: 'Critic Agent',
    version: '1.0.0',
    description: 'Challenges claims with sharp counterarguments.',
    url: CRITIC_URL,
    keysDir: '.samvad/critic-keys',
    specializations: ['debate', 'critical-analysis'],
    rateLimit: { requestsPerMinute: 10, requestsPerSender: 5, tokensPerSenderPerDay: 50000 },
  })

  // Critic trusts researcher's outbound keypair
  criticAgent.trustPeer('agent://researcher-outbound.local', researcherOutboundClient.publicKey)
  criticAgent.skill('critique', buildCriticSkill(MOCK))

  // ── Step 3: Start critic server ────────────────────────────────────────────
  await criticAgent.serve({ port: CRITIC_PORT })

  // ── Step 4: Build critic client (pre-registered key, used by researcher) ───
  await researcherOutboundClient.connect(CRITIC_URL)

  // ── Step 5: Build researcher agent ────────────────────────────────────────
  const researcherAgent = new Agent({
    name: 'Researcher Agent',
    version: '1.0.0',
    description: 'Researches a topic and debates it with a critic agent via SAMVAD.',
    url: RESEARCHER_URL,
    keysDir: '.samvad/researcher-keys',
    specializations: ['debate', 'research'],
    rateLimit: { requestsPerMinute: 10, requestsPerSender: 5, tokensPerSenderPerDay: 50000 },
  })

  // Researcher trusts the runner (this orchestrator)
  researcherAgent.trustPeer('agent://runner.local', runnerClient.publicKey)
  researcherAgent.skill('research', buildResearcherSkill(MOCK, researcherOutboundClient))

  // ── Step 6: Start researcher server ───────────────────────────────────────
  await researcherAgent.serve({ port: RESEARCHER_PORT })

  // ── Step 7: Connect runner and run the debate ─────────────────────────────
  await runnerClient.connect(RESEARCHER_URL)

  console.log(dim(`runner → researcher (${RESEARCHER_URL}) → critic (${CRITIC_URL})`))
  console.log(dim('skills: research → critique'))
  line()
  console.log()

  const result = await runnerClient.call('research', { topic: TOPIC }) as {
    topic: string
    claims: string[]
    counterarguments: string[]
    criticId: string
    traceId: string
  }

  // ── Pretty print ──────────────────────────────────────────────────────────
  console.log(cyan(bold('RESEARCHER')) + dim(` (${RESEARCHER_URL})`))
  result.claims.forEach((claim, i) => {
    console.log(`  ${dim(`${i + 1}.`)} ${claim}`)
  })

  console.log()
  line()
  console.log()

  console.log(yellow(bold('CRITIC')) + dim(` (${result.criticId})`))
  result.counterarguments.forEach((ca, i) => {
    console.log(`  ${dim(`${i + 1}.`)} ${ca}`)
  })

  console.log()
  line()
  console.log(dim(`traceId: ${result.traceId}`))
  console.log(green('✓ SAMVAD handshake complete — both envelopes Ed25519-signed'))
  console.log()

  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
