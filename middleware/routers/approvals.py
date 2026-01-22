from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from middleware.db import get_db
from middleware.models import Approval, WorkflowRun
from middleware.schemas import ApprovalRespondRequest, ApprovalResponse
from middleware.services.approvals import resolve_approval

router = APIRouter(prefix="/approvals")


@router.get("", response_model=list[ApprovalResponse])
def list_approvals(db: DbSession = Depends(get_db)) -> list[ApprovalResponse]:
    approvals = db.execute(select(Approval)).scalars().all()
    return [
        ApprovalResponse(
            id=a.id,
            workflow_run_id=a.workflow_run_id,
            session_id=a.session_id,
            status=a.status,
            action=a.action,
            context_json=a.context_json,
            risk_level=a.risk_level,
            requested_at=a.requested_at,
            resolved_at=a.resolved_at,
        )
        for a in approvals
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

    return ApprovalResponse(
        id=resolved.id,
        workflow_run_id=resolved.workflow_run_id,
        session_id=resolved.session_id,
        status=resolved.status,
        action=resolved.action,
        context_json=resolved.context_json,
        risk_level=resolved.risk_level,
        requested_at=resolved.requested_at,
        resolved_at=resolved.resolved_at,
    )
