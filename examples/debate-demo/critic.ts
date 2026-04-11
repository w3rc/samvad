// SPDX-License-Identifier: Apache-2.0
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

const MOCK_COUNTERARGUMENTS = [
  'Historical evidence shows this trend regularly reverses under new conditions.',
  'This ignores the adaptive capacity of workers to shift into adjacent roles.',
  'The economic incentives here are more complex than a simple cost comparison.',
  'Short-term data is being extrapolated into a long-term structural claim.',
  'This assumes current trajectories continue linearly, which rarely holds in practice.',
]

export const critiqueInputSchema = z.object({
  topic: z.string().max(200),
  claims: z.array(z.string().max(300)).min(1).max(5),
})

export const critiqueOutputSchema = z.object({
  counterarguments: z.array(z.string()),
})

export function buildCriticSkill(mock: boolean) {
  const anthropic = mock ? null : new Anthropic()

  return {
    name: 'Critique',
    description: 'Takes a list of claims and returns a sharp counterargument for each one.',
    input: critiqueInputSchema,
    output: critiqueOutputSchema,
    modes: ['sync'] as const,
    trust: 'public' as const,
    handler: async (input: unknown, ctx: { sender: string; traceId: string; spanId: string }) => {
      const { topic, claims } = input as { topic: string; claims: string[] }
      console.log(`[critic] ← ${ctx.sender} | "${topic}" | ${claims.length} claims`)

      if (mock || !anthropic) {
        return {
          counterarguments: claims.map((_, i) => MOCK_COUNTERARGUMENTS[i % MOCK_COUNTERARGUMENTS.length]),
        }
      }

      const claimList = claims.map((c, i) => `${i + 1}. ${c}`).join('\n')
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `You are a sharp devil's advocate debating: "${topic}"\n\nChallenge each claim with a concise counterargument (1-2 sentences). Return ONLY a numbered list matching the input order. No preamble.\n\n${claimList}`,
        }],
      })

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      const counterarguments = text
        .split('\n')
        .filter(line => /^\d+\.\s/.test(line.trim()))
        .map(line => line.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean)

      return {
        counterarguments: counterarguments.length > 0 ? counterarguments : [text],
      }
    },
  }
}
