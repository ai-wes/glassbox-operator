import json
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from middleware.db import get_db
from middleware.models import Session as SessionModel, Workflow, WorkflowRun
from middleware.schemas import WorkflowResponse, WorkflowRunRequest, WorkflowRunResponse

router = APIRouter(prefix="/workflows")


@router.get("", response_model=list[WorkflowResponse])
def list_workflows(db: DbSession = Depends(get_db)) -> list[WorkflowResponse]:
    workflows = db.execute(select(Workflow)).scalars().all()
    return [
        WorkflowResponse(
            id=w.id,
            name=w.name,
            description=w.description,
            category=w.category,
            enabled=bool(w.enabled),
        )
        for w in workflows
    ]


@router.post("/{workflow_id}/run", response_model=WorkflowRunResponse)
def run_workflow(
    workflow_id: str,
    req: WorkflowRunRequest,
    request: Request,
    db: DbSession = Depends(get_db),
) -> WorkflowRunResponse:
    workflow = db.get(Workflow, workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="workflow not found")
    session = db.get(SessionModel, req.session_id) if req.session_id else None
    runner = request.app.state.workflow_runner
    run = runner.start_run(db, workflow, session, req.params)
    return WorkflowRunResponse(
        id=run.id,
        workflow_id=run.workflow_id,
        session_id=run.session_id,
        status=run.status,
        progress=run.progress,
        eta_seconds=run.eta_seconds,
        started_at=run.started_at,
        ended_at=run.ended_at,
    )


@router.get("/runs/{run_id}", response_model=WorkflowRunResponse)
def get_run(run_id: str, db: DbSession = Depends(get_db)) -> WorkflowRunResponse:
    run = db.get(WorkflowRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="run not found")
    return WorkflowRunResponse(
        id=run.id,
        workflow_id=run.workflow_id,
        session_id=run.session_id,
        status=run.status,
        progress=run.progress,
        eta_seconds=run.eta_seconds,
        started_at=run.started_at,
        ended_at=run.ended_at,
    )
