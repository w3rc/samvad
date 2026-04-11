// Public API surface of @samvad-protocol/sdk
export { Agent } from './agent.js'
export type { AgentConfig, AgentSkillOptions, ServeOptions } from './agent.js'

export { AgentClient } from './agent-client.js'
export type { AgentClientOptions } from './agent-client.js'

export { SamvadError, ErrorCode } from './errors.js'
export type { ErrorCodeType } from './errors.js'

export type {
  AgentCard,
  SkillDef,
  MessageEnvelope,
  ResponseEnvelope,
  TaskRecord,
  TaskStatus,
  TrustTier,
  CommunicationMode,
  SkillContext,
  PublicKey,
  RateLimit,
} from './types.js'
