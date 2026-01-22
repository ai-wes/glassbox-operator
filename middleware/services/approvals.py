import json
from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy.orm import Session as DbSession

from middleware.models import Approval, WorkflowRun


def create_approval(
    db: DbSession,
    action: str,
    context: dict,
    risk_level: str = "medium",
    workflow_run_id: Optional[str] = None,
    session_id: Optional[str] = None,
) -> Approval:
    approval = Approval(
        id=str(uuid.uuid4()),
        workflow_run_id=workflow_run_id,
        session_id=session_id,
        status="pending",
        action=action,
        context_json=json.dumps(context),
        risk_level=risk_level,
        requested_at=datetime.utcnow(),
    )
    db.add(approval)
    db.commit()
    db.refresh(approval)
    return approval


def resolve_approval(db: DbSession, approval: Approval, response: str, resolved_by: Optional[str] = None) -> Approval:
    approval.status = "approved" if response == "approve" else "rejected"
    approval.resolved_at = datetime.utcnow()
    approval.resolved_by = resolved_by
    db.commit()
    db.refresh(approval)
    return approval
