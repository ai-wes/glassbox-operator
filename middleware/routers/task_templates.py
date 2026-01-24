import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from middleware.db import get_db
from middleware.models import TaskTemplate
from middleware.schemas import TaskTemplateCreateRequest, TaskTemplateResponse

router = APIRouter(prefix="/task-templates")


@router.get("", response_model=list[TaskTemplateResponse])
def list_templates(db: DbSession = Depends(get_db)) -> list[TaskTemplateResponse]:
    templates = db.execute(select(TaskTemplate)).scalars().all()
    return [
        TaskTemplateResponse(
            id=t.id,
            title=t.title,
            description=t.description,
            schedule_kind=t.schedule_kind,
            schedule_time_local=t.schedule_time_local,
            enabled=t.enabled,
            execution_mode=t.execution_mode,
            default_lane=t.default_lane,
            mcp_action=t.mcp_action,
            publish_mcp_action=t.publish_mcp_action,
            default_input_json=json.loads(t.default_input_json) if t.default_input_json else None,
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in templates
    ]


@router.post("", response_model=TaskTemplateResponse)
def upsert_template(req: TaskTemplateCreateRequest, db: DbSession = Depends(get_db)) -> TaskTemplateResponse:
    template = db.get(TaskTemplate, req.id) if req.id else None
    if not template:
        template = TaskTemplate(id=req.id or str(uuid.uuid4()))
        db.add(template)
    template.title = req.title
    template.description = req.description
    template.schedule_kind = req.schedule_kind or "DAILY"
    template.schedule_time_local = req.schedule_time_local
    template.enabled = bool(req.enabled)
    template.execution_mode = req.execution_mode or "AUTO"
    template.default_lane = req.default_lane or "TODAY"
    template.mcp_action = req.mcp_action
    template.publish_mcp_action = req.publish_mcp_action
    template.default_input_json = json.dumps(req.default_input_json) if req.default_input_json else None
    if not template.created_at:
        template.created_at = datetime.utcnow()
    template.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(template)
    return TaskTemplateResponse(
        id=template.id,
        title=template.title,
        description=template.description,
        schedule_kind=template.schedule_kind,
        schedule_time_local=template.schedule_time_local,
        enabled=template.enabled,
        execution_mode=template.execution_mode,
        default_lane=template.default_lane,
        mcp_action=template.mcp_action,
        publish_mcp_action=template.publish_mcp_action,
        default_input_json=json.loads(template.default_input_json) if template.default_input_json else None,
        created_at=template.created_at,
        updated_at=template.updated_at,
    )
