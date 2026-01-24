import json
import uuid
from datetime import datetime, date
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from middleware.models import Task, TaskArtifact, TaskEvent, TaskTemplate
from middleware.services.approvals import create_approval
from middleware.ws import ConnectionManager

LANES = {"TODAY", "DOING", "NEEDS_APPROVAL", "QUEUED", "DONE", "BLOCKED", "CANCELLED"}
EXECUTION_MODES = {"AUTO", "APPROVAL_REQUIRED", "APPROVAL_THEN_EXECUTE"}
APPROVAL_STATES = {"NONE", "PENDING", "APPROVED", "REJECTED"}
RUN_STATES = {"IDLE", "RUNNING", "SUCCEEDED", "FAILED"}


def emit_event(
    db: DbSession,
    ws: Optional[ConnectionManager],
    event_type: str,
    task: Optional[Task] = None,
    actor: str = "SYSTEM",
    payload: Optional[dict[str, Any]] = None,
) -> TaskEvent:
    evt = TaskEvent(
        id=str(uuid.uuid4()),
        ts=datetime.utcnow(),
        actor=actor,
        event_type=event_type,
        task_id=task.id if task else None,
        payload_json=json.dumps(payload or {}),
    )
    db.add(evt)
    db.commit()
    db.refresh(evt)
    if ws:
        ws.broadcast_sync({
            "type": "task.event",
            "payload": {
                "id": evt.id,
                "ts": evt.ts.isoformat(),
                "actor": evt.actor,
                "eventType": evt.event_type,
                "taskId": evt.task_id,
                "payload": payload or {},
            },
        })
    return evt


def create_artifact(
    db: DbSession,
    ws: Optional[ConnectionManager],
    task: Task,
    content: str,
    type: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> TaskArtifact:
    latest_version = 0
    for art in task.artifacts:
        latest_version = max(latest_version, art.version)
    artifact = TaskArtifact(
        id=str(uuid.uuid4()),
        task_id=task.id,
        type=type,
        content=content,
        metadata_json=json.dumps(metadata or {}),
        version=latest_version + 1,
        created_at=datetime.utcnow(),
    )
    db.add(artifact)
    db.commit()
    db.refresh(artifact)
    emit_event(
        db,
        ws,
        "ARTIFACT_CREATED" if artifact.version == 1 else "ARTIFACT_UPDATED",
        task,
        actor="ASSISTANT",
        payload={"artifactId": artifact.id, "version": artifact.version, "type": type},
    )
    return artifact


def spawn_daily_tasks(db: DbSession, ws: Optional[ConnectionManager]) -> list[Task]:
    today = date.today().isoformat()
    templates = db.execute(select(TaskTemplate).where(TaskTemplate.enabled == True)).scalars().all()
    spawned: list[Task] = []
    for tmpl in templates:
        if tmpl.schedule_kind != "DAILY":
            continue
        existing = db.execute(
            select(Task).where(Task.template_id == tmpl.id, Task.day_bucket == today)
        ).scalars().first()
        if existing:
            continue
        task = Task(
            id=str(uuid.uuid4()),
            template_id=tmpl.id,
            title=tmpl.title,
            description=tmpl.description,
            lane=tmpl.default_lane or "TODAY",
            execution_mode=tmpl.execution_mode or "AUTO",
            mcp_action=tmpl.mcp_action,
            publish_mcp_action=tmpl.publish_mcp_action,
            input_json=tmpl.default_input_json,
            approval_state="NONE",
            run_state="IDLE",
            attempts=0,
            max_attempts=1,
            day_bucket=today,
            priority=50,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        emit_event(db, ws, "TASK_SPAWNED", task, actor="SYSTEM", payload={"dayBucket": today})
        spawned.append(task)
    return spawned


def select_next_task(db: DbSession) -> Optional[Task]:
    queued = db.execute(
        select(Task)
        .where(Task.lane == "QUEUED")
        .where(Task.run_state == "IDLE")
        .order_by(Task.priority.desc(), Task.created_at.asc())
    ).scalars().first()
    if queued:
        return queued
    today = db.execute(
        select(Task)
        .where(Task.lane == "TODAY")
        .where(Task.run_state == "IDLE")
        .order_by(Task.priority.desc(), Task.created_at.asc())
    ).scalars().first()
    return today


def start_task(db: DbSession, ws: Optional[ConnectionManager], task: Task) -> Task:
    task.lane = "DOING"
    task.run_state = "RUNNING"
    task.attempts = (task.attempts or 0) + 1
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    emit_event(db, ws, "TASK_STARTED", task, actor="ASSISTANT")
    return task


def finish_task_success(
    db: DbSession,
    ws: Optional[ConnectionManager],
    task: Task,
    artifact: Optional[TaskArtifact] = None,
) -> Task:
    task.run_state = "SUCCEEDED"
    task.updated_at = datetime.utcnow()
    if task.execution_mode == "AUTO":
        task.lane = "DONE"
        task.completed_at = datetime.utcnow()
        emit_event(db, ws, "TASK_COMPLETED", task, actor="ASSISTANT")
    elif task.execution_mode == "APPROVAL_THEN_EXECUTE" and task.approval_state == "APPROVED":
        task.lane = "DONE"
        task.completed_at = datetime.utcnow()
        emit_event(db, ws, "TASK_COMPLETED", task, actor="ASSISTANT")
    elif task.execution_mode in {"APPROVAL_REQUIRED", "APPROVAL_THEN_EXECUTE"}:
        task.lane = "NEEDS_APPROVAL"
        task.approval_state = "PENDING"
    db.commit()
    db.refresh(task)
    return task


def create_task_approval(db: DbSession, ws: Optional[ConnectionManager], task: Task) -> None:
    approval = create_approval(
        db,
        action=task.mcp_action or "approval",
        context={"taskId": task.id, "title": task.title},
        risk_level="medium",
        task_id=task.id,
    )
    emit_event(
        db,
        ws,
        "APPROVAL_REQUESTED",
        task,
        actor="ASSISTANT",
        payload={"approvalId": approval.id},
    )


def apply_approval(db: DbSession, ws: Optional[ConnectionManager], task: Task, status: str, notes: Optional[str]) -> Task:
    task.approval_state = "APPROVED" if status == "approved" else "REJECTED"
    task.updated_at = datetime.utcnow()
    if status == "approved":
        if task.execution_mode == "APPROVAL_REQUIRED":
            task.lane = "DONE"
            task.completed_at = datetime.utcnow()
            emit_event(db, ws, "APPROVAL_GRANTED", task, actor="USER", payload={"notes": notes})
            emit_event(db, ws, "TASK_COMPLETED", task, actor="SYSTEM")
        elif task.execution_mode == "APPROVAL_THEN_EXECUTE":
            task.lane = "QUEUED"
            emit_event(db, ws, "APPROVAL_GRANTED", task, actor="USER", payload={"notes": notes})
            emit_event(db, ws, "TASK_QUEUED", task, actor="SYSTEM")
    else:
        task.lane = "CANCELLED"
        emit_event(db, ws, "APPROVAL_REJECTED", task, actor="USER", payload={"notes": notes})
    db.commit()
    db.refresh(task)
    return task
