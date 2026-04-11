// SPDX-License-Identifier: Apache-2.0
import OpenAI from 'openai'
import type { AgentClient } from '@samvad-protocol/sdk'
import { z } from 'zod'

const MOCK_BRIEF = {
  keyFacts: [
    'AI systems already outperform humans on standardised coding benchmarks.',
    'The cost of AI-generated code is falling 40% year-over-year.',
    'Early adopters of AI coding tools report 30-50% productivity gains on well-scoped tasks.',
  ],
  openQuestions: [
    'How does AI perform on ambiguous requirements and legacy codebases?',
    'What happens to system design and architecture roles long-term?',
  ],
  confidenceScore: 68,
}

export const briefInputSchema = z.object({
  topic: z.string().min(3).max(200),
})

export const briefOutputSchema = z.object({
  topic: z.string(),
  keyFacts: z.array(z.string()),
  openQuestions: z.array(z.string()),
  confidenceScore: z.number().min(0).max(100),
  redTeam: z.object({
    assumptionsChallenged: z.array(z.string()),
    gapsIdentified: z.array(z.string()),
    reliabilityRating: z.enum(['high', 'medium', 'low']),
    verdict: z.string(),
  }),
  redTeamAgentId: z.string(),
  traceId: z.string(),
})

export function buildResearchSkill(mock: boolean, redTeamClient: AgentClient) {
  const openai = mock ? null : new OpenAI()

  return {
    name: 'Brief',
    description: 'Researches a topic and returns a structured briefing with key facts, open questions, and a confidence score — then automatically pressure-tests it with the Red Team agent.',
    input: briefInputSchema,
    output: briefOutputSchema,
    modes: ['sync'] as const,
    trust: 'public' as const,
    handler: async (input: unknown, ctx: { sender: string; traceId: string; spanId: string }) => {
      const { topic } = input as { topic: string }
      console.log(`[researcher] ← ${ctx.sender} | "${topic}"`)

      let keyFacts: string[]
      let openQuestions: string[]
      let confidenceScore: number

      if (mock || !openai) {
        keyFacts = MOCK_BRIEF.keyFacts
        openQuestions = MOCK_BRIEF.openQuestions
        confidenceScore = MOCK_BRIEF.confidenceScore
      } else {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o',
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: `Research the topic: "${topic}"\n\nReturn a structured briefing with exactly:\n- 3 key facts (concrete, specific)\n- 2 open questions that remain unresolved\n- A confidence score 0-100\n\nFormat as JSON:\n{\n  "keyFacts": ["...", "...", "..."],\n  "openQuestions": ["...", "..."],\n  "confidenceScore": 75\n}\nReturn ONLY the JSON object. No preamble.`,
          }],
        })

        const text = completion.choices[0]?.message?.content ?? ''
        try {
          const parsed = JSON.parse(text)
          keyFacts = Array.isArray(parsed.keyFacts) ? parsed.keyFacts.slice(0, 3) : MOCK_BRIEF.keyFacts
          openQuestions = Array.isArray(parsed.openQuestions) ? parsed.openQuestions.slice(0, 2) : MOCK_BRIEF.openQuestions
          confidenceScore = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : MOCK_BRIEF.confidenceScore
        } catch {
          keyFacts = MOCK_BRIEF.keyFacts
          openQuestions = MOCK_BRIEF.openQuestions
          confidenceScore = MOCK_BRIEF.confidenceScore
        }
      }

      console.log(`[researcher] → red-team | calling red_team skill via SAMVAD`)
      const redTeamResult = await redTeamClient.call('red_team', { topic, keyFacts, openQuestions }) as {
        assumptionsChallenged: string[]
        gapsIdentified: string[]
        reliabilityRating: 'high' | 'medium' | 'low'
        verdict: string
      }

      return {
        topic,
        keyFacts,
        openQuestions,
        confidenceScore,
        redTeam: redTeamResult,
        redTeamAgentId: redTeamClient.card?.id ?? 'unknown',
        traceId: ctx.traceId,
      }
    },
  }
}
