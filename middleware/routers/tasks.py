import json
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from middleware.db import get_db
from middleware.models import Task
from middleware.schemas import TaskCreateRequest, TaskResponse, TaskUpdateRequest

router = APIRouter(prefix="/tasks")

@router.get("", response_model=list[TaskResponse])
def list_tasks(
    status: str | None = None,
    queue: str | None = None,
    db: DbSession = Depends(get_db)
) -> list[TaskResponse]:
    query = select(Task)
    if status:
        query = query.where(Task.status == status)
    if queue:
        query = query.where(Task.queue == queue)
    
    tasks = db.execute(query).scalars().all()
    return [
        TaskResponse(
            id=t.id,
            title=t.title,
            description=t.description,
            status=t.status,
            queue=t.queue,
            priority=t.priority,
            owner_id=t.owner_id,
            tags=json.loads(t.tags_json) if t.tags_json else [],
            due_date=t.due_date,
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in tasks
    ]

@router.post("", response_model=TaskResponse)
def create_task(req: TaskCreateRequest, db: DbSession = Depends(get_db)) -> TaskResponse:
    task_id = str(uuid.uuid4())
    task = Task(
        id=task_id,
        title=req.title,
        description=req.description,
        status="todo",
        queue=req.queue,
        priority=req.priority,
        tags_json=json.dumps(req.tags),
        due_date=req.due_date,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return TaskResponse(
        id=task.id,
        title=task.title,
        description=task.description,
        status=task.status,
        queue=task.queue,
        priority=task.priority,
        owner_id=task.owner_id,
        tags=json.loads(task.tags_json) if task.tags_json else [],
        due_date=task.due_date,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )

@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(task_id: str, req: TaskUpdateRequest, db: DbSession = Depends(get_db)) -> TaskResponse:
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if req.title is not None:
        task.title = req.title
    if req.description is not None:
        task.description = req.description
    if req.status is not None:
        task.status = req.status
    if req.queue is not None:
        task.queue = req.queue
    if req.priority is not None:
        task.priority = req.priority
    if req.owner_id is not None:
        task.owner_id = req.owner_id
    if req.tags is not None:
        task.tags_json = json.dumps(req.tags)
    if req.due_date is not None:
        task.due_date = req.due_date
        
    db.commit()
    db.refresh(task)
    
    return TaskResponse(
        id=task.id,
        title=task.title,
        description=task.description,
        status=task.status,
        queue=task.queue,
        priority=task.priority,
        owner_id=task.owner_id,
        tags=json.loads(task.tags_json) if task.tags_json else [],
        due_date=task.due_date,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )

@router.delete("/{task_id}")
def delete_task(task_id: str, db: DbSession = Depends(get_db)):
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return {"ok": True}
