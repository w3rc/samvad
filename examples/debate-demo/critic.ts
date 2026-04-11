// SPDX-License-Identifier: Apache-2.0
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

const MOCK_RED_TEAM = {
  assumptionsChallenged: [
    '"Well-defined tasks" covers roughly 20% of real engineering work — the rest involves ambiguity, stakeholder negotiation, and architectural judgment.',
    'Productivity gains are measured on greenfield tasks; debugging AI-generated code in production adds hidden cost.',
  ],
  gapsIdentified: [
    'No longitudinal data on AI performance as codebases age and complexity compounds.',
    'Regulatory constraints in finance, healthcare, and defence create sectors where AI substitution faces hard limits.',
  ],
  reliabilityRating: 'medium' as const,
  verdict: 'Briefing is directionally correct but overstates certainty — treat as a starting hypothesis, not a conclusion.',
}

export const redTeamInputSchema = z.object({
  topic: z.string().max(200),
  keyFacts: z.array(z.string()).min(1).max(5),
  openQuestions: z.array(z.string()).min(0).max(5),
})

export const redTeamOutputSchema = z.object({
  assumptionsChallenged: z.array(z.string()),
  gapsIdentified: z.array(z.string()),
  reliabilityRating: z.enum(['high', 'medium', 'low']),
  verdict: z.string(),
})

export function buildRedTeamSkill(mock: boolean) {
  const anthropic = mock ? null : new Anthropic()

  return {
    name: 'Red Team',
    description: 'Pressure-tests a research briefing — challenges assumptions, identifies gaps, and rates overall reliability.',
    input: redTeamInputSchema,
    output: redTeamOutputSchema,
    modes: ['sync'] as const,
    trust: 'public' as const,
    handler: async (input: unknown, ctx: { sender: string; traceId: string; spanId: string }) => {
      const { topic, keyFacts, openQuestions } = input as {
        topic: string
        keyFacts: string[]
        openQuestions: string[]
      }
      console.log(`[red-team] ← ${ctx.sender} | "${topic}" | ${keyFacts.length} facts`)

      if (mock || !anthropic) {
        return MOCK_RED_TEAM
      }

      const factList = keyFacts.map((f, i) => `${i + 1}. ${f}`).join('\n')
      const questionList = openQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')

      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `You are a rigorous red team analyst. A research briefing on "${topic}" has been submitted for review.\n\nKey facts claimed:\n${factList}\n\nOpen questions:\n${questionList}\n\nReturn your analysis as JSON:\n{\n  "assumptionsChallenged": ["...", "..."],\n  "gapsIdentified": ["...", "..."],\n  "reliabilityRating": "high" | "medium" | "low",\n  "verdict": "One sentence verdict."\n}\nReturn ONLY the JSON object. No preamble.`,
        }],
      })

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      try {
        const parsed = JSON.parse(text)
        return redTeamOutputSchema.parse(parsed)
      } catch {
        return MOCK_RED_TEAM
      }
    },
  }
}
