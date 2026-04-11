// SPDX-License-Identifier: Apache-2.0
import Anthropic from '@anthropic-ai/sdk'
import type { AgentClient } from '@samvad-protocol/sdk'
import { z } from 'zod'

const MOCK_CLAIMS = [
  'AI systems already outperform humans on standardised coding benchmarks.',
  'The cost of AI-generated code is falling faster than developer salaries.',
  'Early adopters of AI coding tools report 30–50% productivity gains.',
]

export const researchInputSchema = z.object({
  topic: z.string().min(3).max(200),
})

export const researchOutputSchema = z.object({
  topic: z.string(),
  claims: z.array(z.string()),
  counterarguments: z.array(z.string()),
  criticId: z.string(),
  traceId: z.string(),
})

export function buildResearcherSkill(mock: boolean, criticClient: AgentClient) {
  const anthropic = mock ? null : new Anthropic()

  return {
    name: 'Research',
    description: 'Researches a topic, generates key claims, then debates them with a critic agent via SAMVAD.',
    input: researchInputSchema,
    output: researchOutputSchema,
    modes: ['sync'] as const,
    trust: 'public' as const,
    handler: async (input: unknown, ctx: { sender: string; traceId: string; spanId: string }) => {
      const { topic } = input as { topic: string }
      console.log(`[researcher] ← ${ctx.sender} | "${topic}"`)

      let claims: string[]

      if (mock || !anthropic) {
        claims = MOCK_CLAIMS
      } else {
        const message = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 384,
          messages: [{
            role: 'user',
            content: `Generate exactly 3 bold, arguable claims about: "${topic}"\n\nReturn ONLY a numbered list (1. 2. 3.). No preamble.`,
          }],
        })

        const text = message.content[0].type === 'text' ? message.content[0].text : ''
        claims = text
          .split('\n')
          .filter(line => /^\d+\.\s/.test(line.trim()))
          .map(line => line.replace(/^\d+\.\s*/, '').trim())
          .filter(Boolean)
          .slice(0, 3)

        if (claims.length === 0) claims = [text]
      }

      console.log(`[researcher] → critic | calling critique skill via SAMVAD`)
      const critiqueResult = await criticClient.call('critique', { topic, claims }) as {
        counterarguments: string[]
      }

      return {
        topic,
        claims,
        counterarguments: critiqueResult.counterarguments,
        criticId: criticClient.card?.id ?? 'unknown',
        traceId: ctx.traceId,
      }
    },
  }
}
