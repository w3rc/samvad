# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from typing import Any, Awaitable, Callable, Literal

from pydantic import BaseModel, ConfigDict, Field

TrustTier = Literal["public", "authenticated", "trusted-peers"]
CommunicationMode = Literal["sync", "async", "stream"]
TaskStatus = Literal["pending", "running", "done", "failed"]

# Developer-supplied classifier for LLM-based injection detection.
# Return True = injection detected → request rejected with INJECTION_DETECTED.
# Return False = clean → request proceeds.
# Raise = fail open (warning logged, request proceeds).
InjectionClassifier = Callable[[dict[str, Any]], "Awaitable[bool] | bool"]


class PublicKey(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kid: str
    key: str  # base64-encoded Ed25519 public key
    active: bool


class RateLimit(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    requests_per_minute: int = Field(..., alias="requestsPerMinute")
    requests_per_sender: int = Field(..., alias="requestsPerSender")
    tokens_per_sender_per_day: int | None = Field(None, alias="tokensPerSenderPerDay")


class SkillDef(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    description: str
    input_schema: dict[str, Any] = Field(..., alias="inputSchema")
    output_schema: dict[str, Any] = Field(..., alias="outputSchema")
    modes: list[CommunicationMode]
    trust: TrustTier
    allowed_peers: list[str] | None = Field(None, alias="allowedPeers")


class AgentCardModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider: str
    model: str


class AgentCardAuth(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schemes: list[str]


class AgentCardEndpoints(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    intro: str
    message: str
    task: str
    task_status: str = Field(..., alias="taskStatus")
    stream: str
    health: str


class AgentCard(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str  # agent://domain
    name: str
    version: str
    description: str
    url: str
    protocol_version: str = Field(..., alias="protocolVersion")
    specializations: list[str]
    models: list[AgentCardModel]
    skills: list[SkillDef]
    public_keys: list[PublicKey] = Field(..., alias="publicKeys")
    auth: AgentCardAuth
    rate_limit: RateLimit = Field(..., alias="rateLimit")
    card_ttl: int = Field(..., alias="cardTTL")
    endpoints: AgentCardEndpoints


class MessageEnvelopeAuth(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    scheme: str
    token: str


class MessageEnvelope(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(..., alias="from")
    to: str
    skill: str
    mode: CommunicationMode
    nonce: str
    timestamp: str
    trace_id: str = Field(..., alias="traceId")
    span_id: str = Field(..., alias="spanId")
    parent_span_id: str | None = Field(None, alias="parentSpanId")
    delegation_token: str | None = Field(None, alias="delegationToken")
    auth: MessageEnvelopeAuth | None = None
    payload: dict[str, Any]


class ResponseEnvelopeError(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str
    message: str


class ResponseEnvelope(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    trace_id: str = Field(..., alias="traceId")
    span_id: str = Field(..., alias="spanId")
    status: Literal["ok", "error"]
    result: dict[str, Any] | None = None
    error: ResponseEnvelopeError | None = None


class TaskRecordError(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    code: str
    message: str


class TaskRecord(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    task_id: str = Field(..., alias="taskId")
    status: TaskStatus
    progress: float | None = None
    result: dict[str, Any] | None = None
    error: TaskRecordError | None = None
    created_at: int = Field(..., alias="createdAt")
    completed_at: int | None = Field(None, alias="completedAt")


class SkillContext(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    sender: str  # verified agent:// ID of caller
    trace_id: str = Field(..., alias="traceId")
    span_id: str = Field(..., alias="spanId")
    delegation_token: str | None = Field(None, alias="delegationToken")
