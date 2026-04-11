// SPDX-License-Identifier: Apache-2.0
import { Agent, AgentClient } from '@samvad-protocol/sdk'
import { buildRedTeamSkills } from './critic.js'
import { buildResearchSkill } from './researcher.js'

const TOPIC = process.argv[2] ?? 'AI will replace software engineers'
const RED_TEAM_PORT = 3011
const RESEARCHER_PORT = 3010
const RED_TEAM_URL = `http://localhost:${RED_TEAM_PORT}`
const RESEARCHER_URL = `http://localhost:${RESEARCHER_PORT}`

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`
const cyan   = (s: string) => `\x1b[36m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`
const rule   = () => console.log(dim('─'.repeat(60)))
const divider = (label: string) => {
  const pad = '━'.repeat(4)
  console.log(`\n${pad} ${bold(label)} ${dim('━'.repeat(Math.max(0, 55 - label.length)))}`)
}

async function main() {
  console.log()
  console.log(bold('SAMVAD — Research + Red Team Debate'))
  console.log(dim(`Topic: "${TOPIC}"`))
  console.log(dim(`  research:  ${process.env.OPENROUTER_API_KEY ? 'OpenRouter google/gemma-4-26b-a4b-it:free' : 'mock mode'}`))
  console.log(dim(`  red team:  ${process.env.GROQ_API_KEY ? 'Groq llama-3.1-8b-instant' : 'mock mode'}`))
  console.log()

  // ── Step 1: Pre-generate all keypairs ──────────────────────────────────────
  const runnerClient = await AgentClient.prepare({
    keysDir: '.samvad/runner-keys',
    agentId: 'agent://runner.local',
  })
  const researcherOutboundClient = await AgentClient.prepare({
    keysDir: '.samvad/researcher-outbound-keys',
    agentId: 'agent://researcher-outbound.local',
  })

  // ── Step 2: Build red team agent (two skills: challenge_claim + verdict) ───
  const redTeamAgent = new Agent({
    name: 'Red Team Agent',
    version: '1.0.0',
    description: 'Challenges individual claims and delivers reliability verdicts.',
    url: RED_TEAM_URL,
    keysDir: '.samvad/critic-keys',
    specializations: ['red-team', 'verification'],
    rateLimit: { requestsPerMinute: 20, requestsPerSender: 10, tokensPerSenderPerDay: 100000 },
  })

  redTeamAgent.trustPeer('agent://researcher-outbound.local', researcherOutboundClient.publicKey)
  const { challengeClaimSkill, verdictSkill } = buildRedTeamSkills()
  redTeamAgent.skill('challenge_claim', challengeClaimSkill)
  redTeamAgent.skill('verdict', verdictSkill)

  // ── Step 3: Start red team server ──────────────────────────────────────────
  await redTeamAgent.serve({ port: RED_TEAM_PORT })
  await researcherOutboundClient.connect(RED_TEAM_URL)

  // ── Step 4: Build research assistant agent ────────────────────────────────
  const researcherAgent = new Agent({
    name: 'Research Assistant',
    version: '1.0.0',
    description: 'Researches a topic and debates each claim one-by-one with the Red Team agent.',
    url: RESEARCHER_URL,
    keysDir: '.samvad/researcher-keys',
    specializations: ['research', 'briefing'],
    rateLimit: { requestsPerMinute: 10, requestsPerSender: 5, tokensPerSenderPerDay: 50000 },
  })

  researcherAgent.trustPeer('agent://runner.local', runnerClient.publicKey)
  researcherAgent.skill('brief', buildResearchSkill(researcherOutboundClient))

  // ── Step 5: Start researcher + connect runner ─────────────────────────────
  await researcherAgent.serve({ port: RESEARCHER_PORT })
  await runnerClient.connect(RESEARCHER_URL)

  console.log(dim(`agent://localhost:${RESEARCHER_PORT} → agent://localhost:${RED_TEAM_PORT}`))
  console.log(dim('skills: brief → challenge_claim (×3) → verdict'))
  rule()
  console.log()

  // ── Step 6: Run the debate ────────────────────────────────────────────────
  const result = await runnerClient.call('brief', { topic: TOPIC }) as {
    topic: string
    debates: { claim: string; rebuttal: string }[]
    reliabilityRating: 'high' | 'medium' | 'low'
    verdict: string
    envelopeCount: number
    traceId: string
  }

  // ── Step 7: Print interleaved debate ─────────────────────────────────────
  result.debates.forEach(({ claim, rebuttal }, i) => {
    divider(`CLAIM ${i + 1}`)
    console.log()
    console.log(cyan('RESEARCHER') + '  ' + claim)
    console.log()
    console.log(dim('            [researcher → red_team: signed SAMVAD envelope]'))
    console.log()
    // wrap rebuttal at ~70 chars
    const words = rebuttal.split(' ')
    const lines: string[] = []
    let line = ''
    for (const w of words) {
      if ((line + ' ' + w).length > 70) { lines.push(line); line = w } else { line = line ? line + ' ' + w : w }
    }
    if (line) lines.push(line)
    console.log(yellow('RED TEAM  ') + '  ' + lines.join('\n              '))
    console.log()
  })

  divider('VERDICT')
  console.log()
  console.log(`Reliability: ${result.reliabilityRating.toUpperCase()}`)
  const vwords = result.verdict.split(' ')
  const vlines: string[] = []
  let vline = ''
  for (const w of vwords) {
    if ((vline + ' ' + w).length > 70) { vlines.push(vline); vline = w } else { vline = vline ? vline + ' ' + w : w }
  }
  if (vline) vlines.push(vline)
  console.log(vlines.join('\n'))
  console.log()
  rule()
  console.log(dim(`traceId: ${result.traceId}`))
  console.log(green(`✓ ${result.envelopeCount} SAMVAD envelopes exchanged — all Ed25519-signed`))
  console.log()

  process.exit(0)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
