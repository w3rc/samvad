// SPDX-License-Identifier: Apache-2.0
import { Agent, AgentClient } from '@samvad-protocol/sdk'
import { buildRedTeamSkill } from './critic.js'
import { buildResearchSkill } from './researcher.js'

const TOPIC = process.argv[2] ?? 'AI will replace software engineers'
const RED_TEAM_PORT = 3011
const RESEARCHER_PORT = 3010
const RED_TEAM_URL = `http://localhost:${RED_TEAM_PORT}`
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
  console.log(bold('SAMVAD — Research + Red Team Demo'))
  console.log(dim(`Topic: "${TOPIC}"`))
  console.log(dim(`  research:  ${process.env.OPENROUTER_API_KEY ? 'OpenRouter google/gemma-3-27b-it:free' : 'mock mode — set OPENROUTER_API_KEY'}`))
  console.log(dim(`  red team:  ${process.env.GROQ_API_KEY ? 'Groq llama-3.1-8b-instant' : 'mock mode — set GROQ_API_KEY'}`))
  console.log()

  // ── Step 1: Pre-generate all keypairs ──────────────────────────────────────
  // Runner key (used by this orchestrator to call researcher)
  const runnerClient = await AgentClient.prepare({
    keysDir: '.samvad/runner-keys',
    agentId: 'agent://runner.local',
  })

  // Researcher-outbound key (used when researcher calls red team)
  // Must be stable across calls, so we pre-generate and register with red team
  const researcherOutboundClient = await AgentClient.prepare({
    keysDir: '.samvad/researcher-outbound-keys',
    agentId: 'agent://researcher-outbound.local',
  })

  // ── Step 2: Build red team agent ───────────────────────────────────────────
  const redTeamAgent = new Agent({
    name: 'Red Team Agent',
    version: '1.0.0',
    description: 'Pressure-tests research briefings by challenging assumptions, identifying gaps, and rating reliability.',
    url: RED_TEAM_URL,
    keysDir: '.samvad/critic-keys',
    specializations: ['red-team', 'verification'],
    rateLimit: { requestsPerMinute: 10, requestsPerSender: 5, tokensPerSenderPerDay: 50000 },
  })

  // Red team trusts researcher's outbound keypair
  redTeamAgent.trustPeer('agent://researcher-outbound.local', researcherOutboundClient.publicKey)
  redTeamAgent.skill('red_team', buildRedTeamSkill())

  // ── Step 3: Start red team server ──────────────────────────────────────────
  await redTeamAgent.serve({ port: RED_TEAM_PORT })

  // ── Step 4: Build red team client (pre-registered key, used by researcher) ─
  await researcherOutboundClient.connect(RED_TEAM_URL)

  // ── Step 5: Build research assistant agent ────────────────────────────────
  const researcherAgent = new Agent({
    name: 'Research Assistant',
    version: '1.0.0',
    description: 'Researches a topic and produces a structured briefing, then routes it to the Red Team agent for verification.',
    url: RESEARCHER_URL,
    keysDir: '.samvad/researcher-keys',
    specializations: ['research', 'briefing'],
    rateLimit: { requestsPerMinute: 10, requestsPerSender: 5, tokensPerSenderPerDay: 50000 },
  })

  // Researcher trusts the runner (this orchestrator)
  researcherAgent.trustPeer('agent://runner.local', runnerClient.publicKey)
  researcherAgent.skill('brief', buildResearchSkill(researcherOutboundClient))

  // ── Step 6: Start researcher server ───────────────────────────────────────
  await researcherAgent.serve({ port: RESEARCHER_PORT })

  // ── Step 7: Connect runner and run the demo ───────────────────────────────
  await runnerClient.connect(RESEARCHER_URL)

  console.log(dim(`agent://localhost:${RESEARCHER_PORT} → agent://localhost:${RED_TEAM_PORT}`))
  console.log(dim('skills: brief → red_team'))
  line()
  console.log()

  const result = await runnerClient.call('brief', { topic: TOPIC }) as {
    topic: string
    keyFacts: string[]
    openQuestions: string[]
    confidenceScore: number
    redTeam: {
      assumptionsChallenged: string[]
      gapsIdentified: string[]
      reliabilityRating: 'high' | 'medium' | 'low'
      verdict: string
    }
    redTeamAgentId: string
    traceId: string
  }

  // ── Pretty print ──────────────────────────────────────────────────────────
  console.log(cyan(bold('RESEARCH ASSISTANT')) + dim(`  (${RESEARCHER_URL})`))
  console.log('Key facts:')
  result.keyFacts.forEach((fact, i) => {
    console.log(`  ${i + 1}. ${fact}`)
  })
  console.log()
  console.log('Open questions:')
  result.openQuestions.forEach((q, i) => {
    console.log(`  ${i + 1}. ${q}`)
  })
  console.log()
  console.log(`Confidence: ${result.confidenceScore}%`)

  console.log()
  line()
  console.log()

  console.log(yellow(bold('RED TEAM AGENT')) + dim(`  (agent://localhost:${RED_TEAM_PORT})`))
  console.log('Assumptions challenged:')
  result.redTeam.assumptionsChallenged.forEach((a, i) => {
    console.log(`  ${i + 1}. ${a}`)
  })
  console.log()
  console.log('Gaps identified:')
  result.redTeam.gapsIdentified.forEach((g, i) => {
    console.log(`  ${i + 1}. ${g}`)
  })
  console.log()
  console.log(`Reliability: ${result.redTeam.reliabilityRating.toUpperCase()}`)
  console.log(`Verdict: ${result.redTeam.verdict}`)

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
