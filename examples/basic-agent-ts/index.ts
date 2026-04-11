import { Agent } from '@samvad/sdk'
import { z } from 'zod'

const agent = new Agent({
  name: 'Hello Agent',
  version: '1.0.0',
  description: 'A simple greeting agent to demonstrate the SAMVAD protocol',
  url: 'http://localhost:3002',
  specializations: ['greetings'],
  models: [{ provider: 'anthropic', model: 'claude-opus-4-6' }],
  keysDir: '.samvad/keys',
  rateLimit: {
    requestsPerMinute: 60,
    requestsPerSender: 10,
    tokensPerSenderPerDay: 50000,
  },
})

agent.skill('greet', {
  name: 'Greet',
  description: 'Returns a personalised greeting',
  input: z.object({
    name: z.string().max(100),
    language: z.enum(['en', 'es', 'fr']).optional(),
  }),
  output: z.object({ greeting: z.string() }),
  modes: ['sync', 'stream'],
  trust: 'public',
  handler: async (input) => {
    const { name, language } = input as { name: string; language?: 'en' | 'es' | 'fr' }
    const greetings: Record<string, string> = { en: 'Hello', es: 'Hola', fr: 'Bonjour' }
    const word = greetings[language ?? 'en']
    return { greeting: `${word}, ${name}! Welcome to SAMVAD.` }
  },
})

agent.serve({ port: 3002 })
