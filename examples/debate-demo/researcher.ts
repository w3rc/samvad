// SPDX-License-Identifier: Apache-2.0
import Anthropic from '@anthropic-ai/sdk'
import { Agent, AgentClient } from '@samvad-protocol/sdk'
import { z } from 'zod'

const PORT = Number(process.env.PORT ?? 3010)
const AGENT_URL = process.env.AGENT_URL ?? `http://localhost:${PORT}`
const CRITIC_URL = process.env.CRITIC_URL ?? 'http://localhost:3011'
const MOCK = process.env.MOCK === 'true'

const anthropic = new Anthropic()

const agent = new Agent({
  name: 'Researcher Agent',
  version: '1.0.0',
  description: 'Researches a topic, generates key claims, then debates them with a critic agent via SAMVAD.',
  url: AGENT_URL,
  specializations: ['debate', 'research'],
  rateLimit: { requestsPerMinute: 10, requestsPerSender: 5, tokensPerSenderPerDay: 50000 },
})

agent.skill('research', {
  name: 'Research',
  description: 'Takes a topic, generates 3 key claims, then calls the critic agent to challenge them. Returns the full debate.',
  input: z.object({
    topic: z.string().min(3).max(200),
  }),
  output: z.object({
    topic: z.string(),
    claims: z.array(z.string()),
    counterarguments: z.array(z.string()),
    criticAgentId: z.string(),
    traceId: z.string(),
  }),
  modes: ['sync'],
  trust: 'public',
  handler: async (input, ctx) => {
    const { topic } = input as { topic: string }
    console.log(`[researcher] request from ${ctx.sender} | topic: "${topic}"`)

    let claims: string[]

    if (MOCK) {
      claims = [
        'AI systems can now outperform humans on standardised coding benchmarks.',
        'The cost of AI-generated code is falling faster than developer salaries.',
        'Early adopters of AI coding tools report 40%+ productivity gains.',
      ]
    } else {
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 384,
        messages: [{
          role: 'user',
          content: `Generate exactly 3 bold, arguable claims about this topic: "${topic}"\n\nReturn ONLY a numbered list (1. 2. 3.). No preamble, no explanation.`,
        }],
      })

      const text = message.content[0].type === 'text' ? message.content[0].text : ''
      claims = text
        .split('\n')
        .filter(line => /^\d+\./.test(line.trim()))
        .map(line => line.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 3)

      if (claims.length === 0) claims = [text]
    }

    // Call the critic agent via SAMVAD
    console.log(`[researcher] calling critic at ${CRITIC_URL} via SAMVAD...`)
    const criticClient = await AgentClient.from(CRITIC_URL)
    const critiqueResult = await criticClient.call('critique', { topic, claims }) as {
      counterarguments: string[]
    }

    return {
      topic,
      claims,
      counterarguments: critiqueResult.counterarguments,
      criticAgentId: criticClient.card?.id ?? CRITIC_URL,
      traceId: ctx.traceId,
    }
  },
})

agent.serve({ port: PORT })
console.log(`[researcher] listening on ${AGENT_URL}`)
