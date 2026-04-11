# LangChain Integration

## Overview

LangChain handles LLM orchestration — chains, memory, tools, and agents. SAMVAD handles agent-to-agent communication — signed envelopes, identity, rate limiting, and discovery. The two complement each other naturally: a LangChain chain becomes a callable SAMVAD skill, and a remote SAMVAD agent becomes a LangChain tool that any chain or agent executor can invoke.

---

## Expose a LangChain chain as a SAMVAD skill

Install dependencies:

```bash
npm install @samvad-protocol/sdk langchain @langchain/openai zod
```

Create a SAMVAD agent whose `summarize` skill runs a LangChain summarization chain inside the handler:

```typescript
import { Agent } from '@samvad-protocol/sdk'
import { z } from 'zod'
import { ChatOpenAI } from '@langchain/openai'
import { PromptTemplate } from 'langchain/prompts'
import { LLMChain } from 'langchain/chains'

const model = new ChatOpenAI({ modelName: 'gpt-4o-mini', temperature: 0 })

const prompt = PromptTemplate.fromTemplate(
  'Summarize the following text in two sentences:\n\n{text}'
)

const chain = new LLMChain({ llm: model, prompt })

const agent = new Agent({
  name: 'Summarizer Agent',
  description: 'Summarizes text using a LangChain chain',
  url: 'http://localhost:3010',
  specializations: ['summarization'],
})

agent.skill('summarize', {
  name: 'Summarize',
  description: 'Accepts up to 10,000 characters of text and returns a two-sentence summary',
  input: z.object({ text: z.string().max(10_000) }),
  output: z.object({ summary: z.string() }),
  modes: ['sync'],
  trust: 'public',
  handler: async (input, ctx) => {
    // ctx.sender is the verified agent:// ID of whoever called this skill.
    // You can log it, use it for per-caller rate decisions, or pass it
    // downstream as provenance metadata.
    console.log(`summarize called by ${ctx.sender} (trace: ${ctx.traceId})`)

    const { text } = input as { text: string }
    const result = await chain.call({ text })
    return { summary: result.text as string }
  },
})

await agent.serve({ port: 3010 })
console.log('Summarizer agent listening on http://localhost:3010')
```

Run it:

```bash
npx tsx summarizer-agent.ts
```

The agent card is published automatically at `http://localhost:3010/.well-known/agent.json` and the skill is reachable at `POST /agent/message`. Every inbound call is Ed25519-verified, nonce-checked, and schema-validated before the handler runs — no security boilerplate needed.

---

## Call a SAMVAD agent from a LangChain tool

Wrap a remote SAMVAD agent as a `DynamicTool` so any LangChain agent executor or chain can invoke it:

```typescript
import { AgentClient } from '@samvad-protocol/sdk'
import { DynamicTool } from 'langchain/tools'
import { ChatOpenAI } from '@langchain/openai'
import { initializeAgentExecutorWithOptions } from 'langchain/agents'

// Build the SAMVAD client once — it fetches the remote agent card
// and generates a local Ed25519 keypair for signing outbound calls.
const samvadClient = await AgentClient.from('http://localhost:3010')

const summarizerTool = new DynamicTool({
  name: 'samvad_agent',
  description:
    'Calls a remote SAMVAD summarizer agent. ' +
    'Input must be a JSON string with a "text" field containing the text to summarize. ' +
    'Returns a two-sentence summary.',
  func: async (input: string) => {
    const parsed = JSON.parse(input) as { text: string }
    const result = await samvadClient.call('summarize', parsed)
    return JSON.stringify(result)
  },
})

// Wire the tool into a LangChain agent executor.
const llm = new ChatOpenAI({ modelName: 'gpt-4o-mini', temperature: 0 })
const executor = await initializeAgentExecutorWithOptions([summarizerTool], llm, {
  agentType: 'openai-functions',
  verbose: true,
})

const response = await executor.call({
  input: 'Summarize this for me: ' + JSON.stringify({ text: 'Your long article text here...' }),
})
console.log(response.output)
```

`AgentClient.from()` is async because it fetches the remote agent card on first call to verify the agent's identity and available skills. Reuse a single client instance across multiple tool invocations — do not construct a new client per call.

---

## Try it now

Spin up the SAMVAD example agent locally:

```bash
git clone https://github.com/w3rc/samvad
cd samvad/examples/basic-agent-ts
npm install && npm start   # runs on http://localhost:3002
```

Then call it from LangChain using the pattern from the section above — just swap the URL and skill ID:

```typescript
const samvadClient = await AgentClient.from('http://localhost:3002')

const greetTool = new DynamicTool({
  name: 'samvad_agent',
  description:
    'Calls a remote SAMVAD greeting agent. ' +
    'Input must be a JSON string with a "name" field. ' +
    'Returns a personalised greeting.',
  func: async (input: string) => {
    const parsed = JSON.parse(input) as { name: string }
    const result = await samvadClient.call('greet', parsed)
    return JSON.stringify(result)
  },
})
```

From there you can plug `greetTool` into any LangChain agent executor exactly as shown in the previous section.
