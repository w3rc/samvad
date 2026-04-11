// SPDX-License-Identifier: Apache-2.0
import OpenAI from 'openai'
import type { AgentClient } from '@samvad-protocol/sdk'
import { z } from 'zod'

const MOCK_CLAIMS = [
  'AI systems already outperform humans on standardised coding benchmarks.',
  'The cost of AI-generated code is falling 40% year-over-year.',
  'Early adopters of AI coding tools report 30-50% productivity gains on well-scoped tasks.',
]

export const briefInputSchema = z.object({
  topic: z.string().min(3).max(200),
})

export const briefOutputSchema = z.object({
  topic: z.string(),
  debates: z.array(z.object({
    claim: z.string(),
    rebuttal: z.string(),
  })),
  reliabilityRating: z.enum(['high', 'medium', 'low']),
  verdict: z.string(),
  envelopeCount: z.number(),
  traceId: z.string(),
})

export function buildResearchSkill(redTeamClient: AgentClient) {
  const openai = process.env.OPENROUTER_API_KEY
    ? new OpenAI({ baseURL: 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY })
    : null

  return {
    name: 'Brief',
    description: 'Researches a topic and debates each claim one-by-one with the Red Team agent via signed SAMVAD envelopes.',
    input: briefInputSchema,
    output: briefOutputSchema,
    modes: ['sync'] as const,
    trust: 'public' as const,
    handler: async (input: unknown, ctx: { sender: string; traceId: string; spanId: string }) => {
      const { topic } = input as { topic: string }
      console.log(`[researcher] ← ${ctx.sender} | "${topic}"`)

      // ── Step 1: Generate claims ──────────────────────────────────────────
      let claims: string[]

      if (!openai) {
        claims = MOCK_CLAIMS
      } else {
        const completion = await openai.chat.completions.create({
          model: 'google/gemma-4-26b-a4b-it:free',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `Research: "${topic}"\n\nReturn exactly 3 concrete, specific, debatable claims.\n\nFormat as JSON:\n{"claims": ["...", "...", "..."]}\nReturn ONLY the JSON.`,
          }],
        })
        try {
          const parsed = JSON.parse(completion.choices[0]?.message?.content ?? '{}')
          claims = Array.isArray(parsed.claims) ? parsed.claims.slice(0, 3) : MOCK_CLAIMS
        } catch {
          claims = MOCK_CLAIMS
        }
      }

      // ── Step 2: Challenge each claim individually via SAMVAD ─────────────
      const debates: { claim: string; rebuttal: string }[] = []
      for (let i = 0; i < claims.length; i++) {
        console.log(`[researcher] → red-team | challenge_claim ${i + 1}/${claims.length}`)
        const { rebuttal } = await redTeamClient.call('challenge_claim', {
          topic,
          claim: claims[i],
          claimIndex: i,
        }) as { rebuttal: string }
        debates.push({ claim: claims[i], rebuttal })
      }

      // ── Step 3: Request overall verdict ──────────────────────────────────
      console.log(`[researcher] → red-team | verdict`)
      const { reliabilityRating, verdict } = await redTeamClient.call('verdict', {
        topic,
        claims,
        rebuttals: debates.map(d => d.rebuttal),
      }) as { reliabilityRating: 'high' | 'medium' | 'low'; verdict: string }

      return {
        topic,
        debates,
        reliabilityRating,
        verdict,
        envelopeCount: claims.length + 1,
        traceId: ctx.traceId,
      }
    },
  }
}
