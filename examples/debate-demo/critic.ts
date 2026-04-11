// SPDX-License-Identifier: Apache-2.0
import Anthropic from '@anthropic-ai/sdk'
import { Agent } from '@samvad-protocol/sdk'
import { z } from 'zod'

const PORT = Number(process.env.PORT ?? 3011)
const AGENT_URL = process.env.AGENT_URL ?? `http://localhost:${PORT}`
const MOCK = process.env.MOCK === 'true'

const anthropic = new Anthropic()

const agent = new Agent({
  name: 'Critic Agent',
  version: '1.0.0',
  description: 'Challenges claims with sharp counterarguments. Part of the SAMVAD debate demo.',
  url: AGENT_URL,
  specializations: ['debate', 'critical-analysis'],
  rateLimit: { requestsPerMinute: 10, requestsPerSender: 5, tokensPerSenderPerDay: 50000 },
})

agent.skill('critique', {
  name: 'Critique',
  description: 'Takes a list of claims and returns a counterargument for each one.',
  input: z.object({
    topic: z.string().max(200),
    claims: z.array(z.string().max(300)).min(1).max(5),
  }),
  output: z.object({
    counterarguments: z.array(z.string()),
  }),
  modes: ['sync'],
  trust: 'public',
  handler: async (input, ctx) => {
    const { topic, claims } = input as { topic: string; claims: string[] }
    console.log(`[critic] request from ${ctx.sender} | topic: "${topic}"`)

    if (MOCK) {
      return {
        counterarguments: claims.map((_, i) => [
          'Historical evidence shows this trend regularly reverses under new conditions.',
          'This ignores the adaptive capacity of human workers to shift roles.',
          'The economic incentives here are more complex than a simple cost comparison.',
          'Short-term data is being extrapolated into a long-term structural claim.',
          'This assumes current trajectories continue linearly, which rarely holds.',
        ][i % 5]),
      }
    }

    const claimList = claims.map((c, i) => `${i + 1}. ${c}`).join('\n')
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `You are a sharp devil's advocate debating the topic: "${topic}"\n\nChallenge each of these claims with a concise counterargument (1-2 sentences each). Return ONLY a numbered list matching the input order. No preamble.\n\n${claimList}`,
      }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const counterarguments = text
      .split('\n')
      .filter(line => /^\d+\./.test(line.trim()))
      .map(line => line.replace(/^\d+\.\s*/, '').trim())

    // Fallback: if parsing failed, return the whole text split by newlines
    if (counterarguments.length === 0) {
      return { counterarguments: [text] }
    }

    return { counterarguments }
  },
})

agent.serve({ port: PORT })
console.log(`[critic] listening on ${AGENT_URL}`)
