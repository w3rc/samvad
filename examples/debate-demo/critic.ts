// SPDX-License-Identifier: Apache-2.0
import OpenAI from 'openai'
import { z } from 'zod'

const MOCK_REBUTTALS = [
  "Benchmark performance ≠ production engineering. Benchmarks are well-specified; real work involves ambiguity, legacy systems, and stakeholder politics.",
  "Jevons Paradox: cheaper code generation historically increases total software demand — expanding the market rather than shrinking it.",
  '"Well-scoped" excludes the hardest parts of engineering. Self-reported gains on cherry-picked tasks do not generalise.',
]

const MOCK_VERDICT = {
  reliabilityRating: 'medium' as const,
  verdict: "Claims are directionally plausible but consistently pick the easiest cases. The hard questions — legacy code, ambiguous requirements, system design — remain unanswered.",
}

// ── challenge_claim ──────────────────────────────────────────────────────────

export const challengeClaimInputSchema = z.object({
  topic: z.string(),
  claim: z.string(),
  claimIndex: z.number().int().min(0),
})

export const challengeClaimOutputSchema = z.object({
  rebuttal: z.string(),
})

// ── verdict ──────────────────────────────────────────────────────────────────

export const verdictInputSchema = z.object({
  topic: z.string(),
  claims: z.array(z.string()),
  rebuttals: z.array(z.string()),
})

export const verdictOutputSchema = z.object({
  reliabilityRating: z.enum(['high', 'medium', 'low']),
  verdict: z.string(),
})

// ── builder ──────────────────────────────────────────────────────────────────

export function buildRedTeamSkills() {
  const openai = process.env.GROQ_API_KEY
    ? new OpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY })
    : null

  const challengeClaimSkill = {
    name: 'Challenge Claim',
    description: 'Challenges a single research claim with a pointed rebuttal.',
    input: challengeClaimInputSchema,
    output: challengeClaimOutputSchema,
    modes: ['sync'] as const,
    trust: 'public' as const,
    handler: async (input: unknown, ctx: { sender: string; traceId: string; spanId: string }) => {
      const { topic, claim, claimIndex } = input as { topic: string; claim: string; claimIndex: number }
      console.log(`[red-team] ← ${ctx.sender} | claim ${claimIndex + 1}: "${claim.slice(0, 55)}…"`)

      let rebuttal: string

      if (!openai) {
        rebuttal = MOCK_REBUTTALS[claimIndex % MOCK_REBUTTALS.length]
      } else {
        const completion = await openai.chat.completions.create({
          model: 'llama-3.1-8b-instant',
          max_tokens: 100,
          messages: [{
            role: 'user',
            content: `You are a sharp red-team analyst. Challenge this research claim in 1-2 sentences. Be specific.\n\nTopic: ${topic}\nClaim: "${claim}"\n\nReturn ONLY the rebuttal. No preamble.`,
          }],
        })
        rebuttal = completion.choices[0]?.message?.content?.trim() ?? MOCK_REBUTTALS[claimIndex % MOCK_REBUTTALS.length]
      }

      return { rebuttal }
    },
  }

  const verdictSkill = {
    name: 'Verdict',
    description: 'Delivers an overall reliability verdict after reviewing all claim/rebuttal pairs.',
    input: verdictInputSchema,
    output: verdictOutputSchema,
    modes: ['sync'] as const,
    trust: 'public' as const,
    handler: async (input: unknown, ctx: { sender: string; traceId: string; spanId: string }) => {
      const { topic, claims, rebuttals } = input as { topic: string; claims: string[]; rebuttals: string[] }
      console.log(`[red-team] ← ${ctx.sender} | verdict on "${topic}"`)

      let reliabilityRating: 'high' | 'medium' | 'low'
      let verdict: string

      if (!openai) {
        reliabilityRating = MOCK_VERDICT.reliabilityRating
        verdict = MOCK_VERDICT.verdict
      } else {
        const pairs = claims.map((c, i) => `Claim: "${c}"\nChallenge: "${rebuttals[i]}"`).join('\n\n')
        const completion = await openai.chat.completions.create({
          model: 'llama-3.1-8b-instant',
          max_tokens: 120,
          messages: [{
            role: 'user',
            content: `Red-team analyst. Overall verdict on this debate.\n\n${pairs}\n\nReturn JSON only: {"reliabilityRating":"high"|"medium"|"low","verdict":"1-2 sentence verdict"}`,
          }],
        })
        try {
          const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}')
          reliabilityRating = ['high', 'medium', 'low'].includes(parsed.reliabilityRating) ? parsed.reliabilityRating : 'medium'
          verdict = parsed.verdict ?? MOCK_VERDICT.verdict
        } catch {
          reliabilityRating = MOCK_VERDICT.reliabilityRating
          verdict = MOCK_VERDICT.verdict
        }
      }

      return { reliabilityRating, verdict }
    },
  }

  return { challengeClaimSkill, verdictSkill }
}
