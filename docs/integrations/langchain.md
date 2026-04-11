# SAMVAD + LangChain Integration

SAMVAD handles agent-to-agent communication; LangChain handles LLM orchestration. The two complement each other cleanly: expose a LangChain chain as a SAMVAD skill so other agents can call it, or call a remote SAMVAD agent from a LangChain tool.

---

## Expose a LangChain chain as a SAMVAD skill

Install dependencies:

```bash
npm install @samvad-protocol/sdk @langchain/openai @langchain/core zod
```

Create an agent that wraps a summarization chain as a public SAMVAD skill:

```typescript
// summarizer-agent.ts
import { Agent } from '@samvad-protocol/sdk'
import { ChatOpenAI } from '@langchain/openai'
import { PromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { z } from 'zod'

const model = new ChatOpenAI({ model: 'gpt-4o-mini' })
const prompt = PromptTemplate.fromTemplate(
  'Summarise the following text in 2–3 sentences:\n\n{text}'
)
const chain = prompt.pipe(model).pipe(new StringOutputParser())

const agent = new Agent({
  name: 'Summarizer Agent',
  version: '1.0.0',
  description: 'Summarises text using GPT-4o-mini via SAMVAD',
  url: process.env.AGENT_URL ?? 'http://localhost:3000',
})

agent.skill('summarize', {
  name: 'Summarize',
  description: 'Summarises up to 10,000 characters of text',
  input: z.object({ text: z.string().max(10_000) }),
  output: z.object({ summary: z.string() }),
  modes: ['sync'],
  trust: 'public',
  handler: async (input, ctx) => {
    const { text } = input as { text: string }
    console.log(`Request from ${ctx.sender} (trace: ${ctx.traceId})`)
    const summary = await chain.invoke({ text })
    return { summary }
  },
})

agent.serve({ port: 3000 })
```

Run it with `tsx summarizer-agent.ts`. The SDK generates an Ed25519 keypair on first start and publishes the agent card at `/.well-known/agent.json`.

---

## Call a SAMVAD agent from a LangChain tool

Install dependencies:

```bash
npm install @samvad-protocol/sdk @langchain/openai @langchain/core langchain zod
```

Wrap a remote SAMVAD agent as a LangChain tool and wire it into an agent:

```typescript
// caller.ts
import { AgentClient } from '@samvad-protocol/sdk'
import { ChatOpenAI } from '@langchain/openai'
import { DynamicTool } from '@langchain/core/tools'
import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents'
import { ChatPromptTemplate } from '@langchain/core/prompts'

const client = await AgentClient.from('http://localhost:3000')

const summarizerTool = new DynamicTool({
  name: 'summarize',
  description: 'Summarises a long piece of text. Input: the text to summarise.',
  func: async (text: string) => {
    const result = await client.call('summarize', { text })
    return JSON.stringify(result)
  },
})

const llm = new ChatOpenAI({ model: 'gpt-4o-mini' })
const prompt = ChatPromptTemplate.fromMessages([
  ['system', 'You are a helpful assistant with access to a summarization tool.'],
  ['human', '{input}'],
  ['placeholder', '{agent_scratchpad}'],
])

const agentInstance = await createOpenAIFunctionsAgent({ llm, tools: [summarizerTool], prompt })
const executor = new AgentExecutor({ agent: agentInstance, tools: [summarizerTool] })

const result = await executor.invoke({ input: 'Summarise this article: [paste article here]' })
console.log(result.output)
```

---

## Try it now

Spin up the example agent locally (no cloud setup needed):

```bash
git clone https://github.com/w3rc/samvad
cd samvad/examples/basic-agent-ts
npm install && npm start   # starts on http://localhost:3002
```

Then swap `'http://localhost:3000'` in the caller example for `'http://localhost:3002'` and call the `greet` skill:

```typescript
const client = await AgentClient.from('http://localhost:3002')
const result = await client.call('greet', { name: 'Ada', language: 'en' })
console.log(result) // { greeting: 'Hello, Ada! Welcome to SAMVAD.' }
```
