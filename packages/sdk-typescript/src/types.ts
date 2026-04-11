import type { ZodTypeAny } from 'zod'

export type TrustTier = 'public' | 'authenticated' | 'trusted-peers'
export type CommunicationMode = 'sync' | 'async' | 'stream'
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed'

export interface PublicKey {
  kid: string
  key: string   // base64-encoded Ed25519 public key
  active: boolean
}

export interface RateLimit {
  requestsPerMinute: number
  requestsPerSender: number
  tokensPerSenderPerDay?: number
}

export interface SkillDef {
  id: string
  name: string
  description: string
  inputSchema: Record<string, unknown>   // JSON Schema object
  outputSchema: Record<string, unknown>  // JSON Schema object
  modes: CommunicationMode[]
  trust: TrustTier
  allowedPeers?: string[]  // agent:// URIs, only when trust === 'trusted-peers'
}

export interface AgentCard {
  id: string              // agent://domain
  name: string
  version: string
  description: string
  url: string
  protocolVersion: string
  specializations: string[]
  models: Array<{ provider: string; model: string }>
  skills: SkillDef[]
  publicKeys: PublicKey[]
  auth: { schemes: string[] }
  rateLimit: RateLimit
  cardTTL: number
  endpoints: {
    intro: string
    message: string
    task: string
    taskStatus: string
    stream: string
    health: string
  }
}

export interface MessageEnvelope {
  from: string
  to: string
  skill: string
  mode: CommunicationMode
  nonce: string
  timestamp: string
  kid: string
  signature: string
  traceId: string
  spanId: string
  parentSpanId?: string
  delegationToken?: string
  auth?: { scheme: string; token: string }
  payload: Record<string, unknown>
}

export interface ResponseEnvelope {
  traceId: string
  spanId: string
  status: 'ok' | 'error'
  result?: Record<string, unknown>
  error?: { code: string; message: string }
}

export interface TaskRecord {
  taskId: string
  status: TaskStatus
  progress?: number
  result?: Record<string, unknown>
  error?: { code: string; message: string }
  createdAt: number
  completedAt?: number
}

// Internal: skill handler context passed to developer-defined handlers
export interface SkillContext {
  sender: string        // verified agent:// ID of caller
  traceId: string
  spanId: string
  delegationToken?: string
}

// Internal: registered skill with Zod schemas + handler
export interface RegisteredSkill {
  def: SkillDef
  inputZod: ZodTypeAny
  handler: (input: unknown, ctx: SkillContext) => Promise<unknown>
}
