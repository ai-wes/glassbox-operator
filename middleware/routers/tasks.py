import json
import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from middleware.db import get_db
from middleware.models import Approval, Session as SessionModel, Task
from middleware.schemas import (
    AssistantNextResponse,
    TaskArtifactCreateRequest,
    TaskArtifactResponse,
    TaskCreateRequest,
    TaskResponse,
    TaskUpdateRequest,
)
from middleware.services.sessions import create_session
from middleware.services.tasks import (
    apply_approval,
    create_artifact,
    emit_event,
    finish_task_success,
    select_next_task,
    spawn_daily_tasks,
    start_task,
)

router = APIRouter(prefix="/tasks")


def _get_or_create_task_session(db: DbSession, request: Request) -> SessionModel:
    session = db.execute(select(SessionModel).where(SessionModel.title == "Head Assistant")).scalars().first()
    if session:
        return session
    client = request.app.state.opencode_client
    return create_session(db, client, title="Head Assistant")


def _task_to_response(task: Task) -> TaskResponse:
    return TaskResponse(
        id=task.id,
        template_id=task.template_id,
        title=task.title,
        description=task.description,
        lane=task.lane,
        execution_mode=task.execution_mode,
        mcp_action=task.mcp_action,
        publish_mcp_action=task.publish_mcp_action,
        input_json=json.loads(task.input_json) if task.input_json else None,
        approval_state=task.approval_state,
        run_state=task.run_state,
        attempts=task.attempts,
        max_attempts=task.max_attempts,
        day_bucket=task.day_bucket,
        priority=task.priority,
        status_detail=task.status_detail,
        blocked_reason=task.blocked_reason,
        created_at=task.created_at,
        updated_at=task.updated_at,
        completed_at=task.completed_at,
    )


@router.get("", response_model=list[TaskResponse])
def list_tasks(
    lane: str | None = None,
    day_bucket: str | None = None,
    approval_state: str | None = None,
    db: DbSession = Depends(get_db),
) -> list[TaskResponse]:
    query = select(Task)
    if lane:
        query = query.where(Task.lane == lane)
    if day_bucket:
        query = query.where(Task.day_bucket == day_bucket)
    if approval_state:
        query = query.where(Task.approval_state == approval_state)
    tasks = db.execute(query.order_by(Task.created_at.desc())).scalars().all()
    return [_task_to_response(t) for t in tasks]


@router.post("", response_model=TaskResponse)
def create_task(req: TaskCreateRequest, request: Request, db: DbSession = Depends(get_db)) -> TaskResponse:
    day_bucket = req.day_bucket or date.today().isoformat()
    task = Task(
        id=str(uuid.uuid4()),
        template_id=req.template_id,
        title=req.title,
        description=req.description,
        lane=req.lane or "TODAY",
        execution_mode=req.execution_mode or "AUTO",
        mcp_action=req.mcp_action,
        publish_mcp_action=req.publish_mcp_action,
        input_json=json.dumps(req.input_json) if req.input_json else None,
        approval_state="NONE",
        run_state="IDLE",
        attempts=0,
        max_attempts=1,
        day_bucket=day_bucket,
        priority=req.priority or 50,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    emit_event(db, request.app.state.ws_manager, "TASK_CREATED", task, actor="USER")
    return _task_to_response(task)


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(task_id: str, req: TaskUpdateRequest, request: Request, db: DbSession = Depends(get_db)) -> TaskResponse:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if req.title is not None:
        task.title = req.title
    if req.description is not None:
        task.description = req.description
    if req.lane is not None:
        task.lane = req.lane
    if req.execution_mode is not None:
        task.execution_mode = req.execution_mode
    if req.mcp_action is not None:
        task.mcp_action = req.mcp_action
    if req.publish_mcp_action is not None:
        task.publish_mcp_action = req.publish_mcp_action
    if req.input_json is not None:
        task.input_json = json.dumps(req.input_json)
    if req.priority is not None:
        task.priority = req.priority
    if req.status_detail is not None:
        task.status_detail = req.status_detail
    if req.blocked_reason is not None:
        task.blocked_reason = req.blocked_reason
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    emit_event(db, request.app.state.ws_manager, "TASK_UPDATED", task, actor="USER")
    return _task_to_response(task)


@router.post("/spawn/daily", response_model=list[TaskResponse])
def spawn_daily(request: Request, db: DbSession = Depends(get_db)) -> list[TaskResponse]:
    spawned = spawn_daily_tasks(db, request.app.state.ws_manager)
    return [_task_to_response(t) for t in spawned]


@router.post("/{task_id}/start", response_model=TaskResponse)
def start(task_id: str, request: Request, db: DbSession = Depends(get_db)) -> TaskResponse:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task = start_task(db, request.app.state.ws_manager, task)
    return _task_to_response(task)


@router.post("/{task_id}/execute", response_model=TaskResponse)
def execute_task(task_id: str, request: Request, db: DbSession = Depends(get_db)) -> TaskResponse:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.run_state == "RUNNING":
        raise HTTPException(status_code=409, detail="Task already running")
    task = start_task(db, request.app.state.ws_manager, task)
    emit_event(db, request.app.state.ws_manager, "MCP_CALL_REQUESTED", task, actor="ASSISTANT")

    client = request.app.state.opencode_client
    system_prompt = request.app.state.system_prompt
    session = _get_or_create_task_session(db, request)
    input_payload = json.loads(task.input_json) if task.input_json else {}
    action = task.publish_mcp_action if task.lane == "QUEUED" and task.publish_mcp_action else task.mcp_action
    prompt = (
        f"Execute MCP action `{action}` with input JSON:\n"
        f"{json.dumps(input_payload)}\n\n"
        "Return the result as plain text."
    )
    try:
        response = client.session_message(
            session.opencode_session_id,
            prompt,
            system=system_prompt,
            model=request.app.state.settings.opencode_model,
            agent=request.app.state.settings.opencode_agent,
        )
    except Exception as exc:
        task.run_state = "FAILED"
        task.lane = "BLOCKED"
        task.blocked_reason = str(exc)
        db.commit()
        emit_event(db, request.app.state.ws_manager, "MCP_CALL_FAILED", task, actor="ASSISTANT", payload={"error": str(exc)})
        raise
    parts = response.get("parts") or []
    content = ""
    for part in parts:
        if part.get("type") == "text" and isinstance(part.get("text"), str):
            content += part["text"]
    artifact = None
    if content.strip():
        artifact = create_artifact(db, request.app.state.ws_manager, task, content.strip(), type="RESULT")
    emit_event(db, request.app.state.ws_manager, "MCP_CALL_SUCCEEDED", task, actor="ASSISTANT")
    if action and task.lane == "DOING" and task.approval_state == "APPROVED":
        emit_event(db, request.app.state.ws_manager, "TASK_PUBLISHED", task, actor="ASSISTANT", payload={"action": action})
    task = finish_task_success(db, request.app.state.ws_manager, task, artifact)
    if task.execution_mode in {"APPROVAL_REQUIRED", "APPROVAL_THEN_EXECUTE"}:
        approval = Approval(
            id=str(uuid.uuid4()),
            task_id=task.id,
            status="pending",
            action=task.mcp_action or "approval",
            context_json=json.dumps(input_payload),
            risk_level="medium",
        )
        db.add(approval)
        db.commit()
        emit_event(
            db,
            request.app.state.ws_manager,
            "APPROVAL_REQUESTED",
            task,
            actor="SYSTEM",
            payload={"approvalId": approval.id, "artifactId": artifact.id if artifact else None},
        )
    return _task_to_response(task)


@router.post("/{task_id}/artifacts", response_model=TaskArtifactResponse)
def create_task_artifact(
    task_id: str,
    req: TaskArtifactCreateRequest,
    request: Request,
    db: DbSession = Depends(get_db),
) -> TaskArtifactResponse:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    artifact = create_artifact(db, request.app.state.ws_manager, task, req.content, req.type, req.metadata)
    return TaskArtifactResponse(
        id=artifact.id,
        task_id=artifact.task_id,
        type=artifact.type,
        content=artifact.content,
        metadata=json.loads(artifact.metadata_json) if artifact.metadata_json else None,
        version=artifact.version,
        created_at=artifact.created_at,
    )


@router.get("/{task_id}/artifacts", response_model=list[TaskArtifactResponse])
def list_task_artifacts(task_id: str, db: DbSession = Depends(get_db)) -> list[TaskArtifactResponse]:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return [
        TaskArtifactResponse(
            id=a.id,
            task_id=a.task_id,
            type=a.type,
            content=a.content,
            metadata=json.loads(a.metadata_json) if a.metadata_json else None,
            version=a.version,
            created_at=a.created_at,
        )
        for a in task.artifacts
    ]


@router.post("/{task_id}/approve", response_model=TaskResponse)
def approve_task(task_id: str, request: Request, notes: str | None = None, db: DbSession = Depends(get_db)) -> TaskResponse:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task = apply_approval(db, request.app.state.ws_manager, task, "approved", notes)
    return _task_to_response(task)


@router.post("/{task_id}/reject", response_model=TaskResponse)
def reject_task(task_id: str, request: Request, notes: str | None = None, db: DbSession = Depends(get_db)) -> TaskResponse:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task = apply_approval(db, request.app.state.ws_manager, task, "rejected", notes)
    return _task_to_response(task)


@router.post("/{task_id}/request-revision", response_model=TaskResponse)
def request_revision(task_id: str, request: Request, notes: str | None = None, db: DbSession = Depends(get_db)) -> TaskResponse:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task.approval_state = "PENDING"
    task.lane = "NEEDS_APPROVAL"
    task.status_detail = notes
    db.commit()
    emit_event(db, request.app.state.ws_manager, "APPROVAL_REVISION_REQUESTED", task, actor="USER", payload={"notes": notes})
    db.refresh(task)
    return _task_to_response(task)


@router.post("/assistant/next", response_model=AssistantNextResponse)
def assistant_next(db: DbSession = Depends(get_db)) -> AssistantNextResponse:
    task = select_next_task(db)
    return AssistantNextResponse(task=_task_to_response(task) if task else None)
