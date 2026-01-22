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
