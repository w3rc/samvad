// SPDX-License-Identifier: Apache-2.0
// Public API surface of @samvad-protocol/sdk
export { Agent } from './agent.js'
export type { AgentConfig, AgentSkillOptions, ServeOptions } from './agent.js'

export { AgentClient } from './agent-client.js'
export type { AgentClientOptions } from './agent-client.js'

export { BrowserAgentClient } from './browser-client.js'
export type { BrowserAgentClientOptions } from './browser-client.js'

export { SamvadError, ErrorCode } from './errors.js'
export type { ErrorCodeType } from './errors.js'

export { generateKeypair, saveKeypair, loadKeypair, encodePublicKey, decodePublicKey } from './keys.js'
export type { Keypair } from './keys.js'

export { computeContentDigest, parseKeyId, signRequest, verifyRequest } from './signing.js'
export type { RequestSignatureHeaders } from './signing.js'

export { NonceStore, InMemoryNonceStore, UpstashRedisNonceStore } from './nonce-store.js'
export type { NonceCheckResult, NonceStoreAdapter, UpstashRedisClient } from './nonce-store.js'

export { scanObjectForInjection, wrapWithContentBoundary } from './injection-scanner.js'

export { createVerifyMiddleware } from './verify-middleware.js'
export type { VerifyMiddlewareConfig, VerifiedRequest, VerifyError, VerifyResult } from './verify-middleware.js'

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
  InjectionClassifier,
} from './types.js'
