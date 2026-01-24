from datetime import datetime
from typing import Any, Optional
from pydantic import BaseModel, Field


class SessionCreateRequest(BaseModel):
    title: Optional[str] = None
    user_id: Optional[str] = None


class SessionResponse(BaseModel):
    id: str
    opencode_session_id: str
    title: Optional[str] = None
    status: str
    created_at: datetime
    updated_at: datetime


class MessageCreateRequest(BaseModel):
    text: str


class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    created_at: datetime


class WorkflowResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    enabled: bool


class WorkflowRunRequest(BaseModel):
    session_id: Optional[str] = None
    params: dict[str, Any] = Field(default_factory=dict)


class WorkflowRunResponse(BaseModel):
    id: str
    workflow_id: str
    session_id: Optional[str] = None
    status: str
    progress: float
    eta_seconds: Optional[int] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None


class ApprovalResponse(BaseModel):
    id: str
    workflow_run_id: Optional[str] = None
    session_id: Optional[str] = None
    task_id: Optional[str] = None
    status: str
    action: str
    context_json: Optional[str] = None
    risk_level: str
    requested_at: datetime
    resolved_at: Optional[datetime] = None


class ApprovalRespondRequest(BaseModel):
    response: str
    remember: Optional[bool] = None


class HealthResponse(BaseModel):
    ok: bool


class StatusResponse(BaseModel):
    opencode_healthy: bool
    opencode_version: Optional[str] = None
    mcp_status: dict[str, Any] = Field(default_factory=dict)
    active_runs: int = 0


class NotificationRegisterRequest(BaseModel):
    user_id: str
    device_token: str


class TaskCreateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    lane: Optional[str] = "TODAY"
    execution_mode: Optional[str] = "AUTO"
    mcp_action: Optional[str] = None
    publish_mcp_action: Optional[str] = None
    input_json: Optional[dict[str, Any]] = None
    day_bucket: Optional[str] = None
    priority: Optional[int] = 50
    template_id: Optional[str] = None


class TaskUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    lane: Optional[str] = None
    execution_mode: Optional[str] = None
    mcp_action: Optional[str] = None
    publish_mcp_action: Optional[str] = None
    input_json: Optional[dict[str, Any]] = None
    priority: Optional[int] = None
    status_detail: Optional[str] = None
    blocked_reason: Optional[str] = None


class TaskResponse(BaseModel):
    id: str
    template_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    lane: str
    execution_mode: str
    mcp_action: Optional[str] = None
    publish_mcp_action: Optional[str] = None
    input_json: Optional[dict[str, Any]] = None
    approval_state: str
    run_state: str
    attempts: int
    max_attempts: int
    day_bucket: Optional[str] = None
    priority: int
    status_detail: Optional[str] = None
    blocked_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None


class TaskTemplateCreateRequest(BaseModel):
    id: Optional[str] = None
    title: str
    description: Optional[str] = None
    schedule_kind: Optional[str] = "DAILY"
    schedule_time_local: Optional[str] = None
    enabled: Optional[bool] = True
    execution_mode: Optional[str] = "AUTO"
    default_lane: Optional[str] = "TODAY"
    mcp_action: Optional[str] = None
    publish_mcp_action: Optional[str] = None
    default_input_json: Optional[dict[str, Any]] = None


class TaskTemplateResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    schedule_kind: str
    schedule_time_local: Optional[str] = None
    enabled: bool
    execution_mode: str
    default_lane: str
    mcp_action: Optional[str] = None
    publish_mcp_action: Optional[str] = None
    default_input_json: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class TaskArtifactCreateRequest(BaseModel):
    type: Optional[str] = None
    content: str
    metadata: Optional[dict[str, Any]] = None


class TaskArtifactResponse(BaseModel):
    id: str
    task_id: str
    type: Optional[str] = None
    content: str
    metadata: Optional[dict[str, Any]] = None
    version: int
    created_at: datetime


class TaskEventResponse(BaseModel):
    id: str
    ts: datetime
    actor: str
    event_type: str
    task_id: Optional[str] = None
    payload: Optional[dict[str, Any]] = None


class AssistantNextResponse(BaseModel):
    task: Optional[TaskResponse] = None
