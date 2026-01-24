import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from middleware.db import get_db
from middleware.models import Approval, Task, WorkflowRun
from middleware.schemas import ApprovalRespondRequest, ApprovalResponse, TaskResponse
from middleware.services.approvals import resolve_approval
from middleware.services.tasks import apply_approval

router = APIRouter(prefix="/approvals")


@router.get("", response_model=list[ApprovalResponse])
def list_approvals(db: DbSession = Depends(get_db)) -> list[ApprovalResponse]:
    approvals = db.execute(select(Approval)).scalars().all()
    return [
        ApprovalResponse(
            id=a.id,
            workflow_run_id=a.workflow_run_id,
            session_id=a.session_id,
            task_id=a.task_id,
            status=a.status,
            action=a.action,
            context_json=a.context_json,
            risk_level=a.risk_level,
            requested_at=a.requested_at,
            resolved_at=a.resolved_at,
        )
        for a in approvals
    ]


@router.get("/inbox", response_model=list[TaskResponse])
def approval_inbox(db: DbSession = Depends(get_db)) -> list[TaskResponse]:
    tasks = db.execute(
        select(Task).where(Task.lane == "NEEDS_APPROVAL").where(Task.approval_state == "PENDING")
    ).scalars().all()
    return [
        TaskResponse(
            id=t.id,
            template_id=t.template_id,
            title=t.title,
            description=t.description,
            lane=t.lane,
            execution_mode=t.execution_mode,
            mcp_action=t.mcp_action,
            publish_mcp_action=t.publish_mcp_action,
            input_json=json.loads(t.input_json) if t.input_json else None,
            approval_state=t.approval_state,
            run_state=t.run_state,
            attempts=t.attempts,
            max_attempts=t.max_attempts,
            day_bucket=t.day_bucket,
            priority=t.priority,
            status_detail=t.status_detail,
            blocked_reason=t.blocked_reason,
            created_at=t.created_at,
            updated_at=t.updated_at,
            completed_at=t.completed_at,
        )
        for t in tasks
    ]


@router.post("/{approval_id}/respond", response_model=ApprovalResponse)
def respond_approval(
    approval_id: str,
    req: ApprovalRespondRequest,
    request: Request,
    db: DbSession = Depends(get_db),
) -> ApprovalResponse:
    approval = db.get(Approval, approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="approval not found")
    resolved = resolve_approval(db, approval, req.response)

    if resolved.workflow_run_id and resolved.status == "approved":
        run = db.get(WorkflowRun, resolved.workflow_run_id)
        if run:
            run.status = "RUNNING"
            db.commit()
            request.app.state.workflow_runner.resume_run(run.id)
    if resolved.task_id:
        task = db.get(Task, resolved.task_id)
        if task:
            apply_approval(
                db,
                request.app.state.ws_manager,
                task,
                "approved" if resolved.status == "approved" else "rejected",
                None,
            )

    return ApprovalResponse(
        id=resolved.id,
        workflow_run_id=resolved.workflow_run_id,
        session_id=resolved.session_id,
        task_id=resolved.task_id,
        status=resolved.status,
        action=resolved.action,
        context_json=resolved.context_json,
        risk_level=resolved.risk_level,
        requested_at=resolved.requested_at,
        resolved_at=resolved.resolved_at,
    )
