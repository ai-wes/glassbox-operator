from fastapi import APIRouter, Depends, Request
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from middleware.db import get_db
from middleware.models import WorkflowRun
from middleware.schemas import HealthResponse, StatusResponse

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(ok=True)


@router.get("/status", response_model=StatusResponse)
def status(request: Request, db: Session = Depends(get_db)) -> StatusResponse:
    client = request.app.state.opencode_client
    opencode_healthy = False
    opencode_version = None
    mcp_status = {}
    try:
        health_data = client.health()
        opencode_healthy = bool(health_data.get("healthy"))
        opencode_version = health_data.get("version")
    except Exception:
        opencode_healthy = False

    try:
        mcp_status = client.mcp_status()
    except Exception:
        mcp_status = {}

    active_runs = db.execute(
        select(func.count())
        .select_from(WorkflowRun)
        .where(WorkflowRun.status.notin_(["COMPLETED", "FAILED", "ABORTED"]))
    ).scalar_one()

    return StatusResponse(
        opencode_healthy=opencode_healthy,
        opencode_version=opencode_version,
        mcp_status=mcp_status,
        active_runs=int(active_runs or 0),
    )
