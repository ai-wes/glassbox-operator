import json
import time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from middleware.db import get_db, SessionLocal
from middleware.models import TaskEvent
from middleware.schemas import TaskEventResponse

router = APIRouter(prefix="/events")


@router.get("", response_model=list[TaskEventResponse])
def list_events(
    since: Optional[str] = None,
    limit: int = 200,
    db: DbSession = Depends(get_db),
) -> list[TaskEventResponse]:
    query = select(TaskEvent)
    if since:
        try:
            since_dt = datetime.fromisoformat(since)
            query = query.where(TaskEvent.ts > since_dt)
        except ValueError:
            pass
    events = db.execute(query.order_by(TaskEvent.ts.desc()).limit(limit)).scalars().all()
    return [
        TaskEventResponse(
            id=e.id,
            ts=e.ts,
            actor=e.actor,
            event_type=e.event_type,
            task_id=e.task_id,
            payload=json.loads(e.payload_json) if e.payload_json else None,
        )
        for e in events
    ]


@router.get("/stream")
def stream_events(request: Request, since: Optional[str] = None):
    def event_stream():
        last_ts = None
        if since:
            try:
                last_ts = datetime.fromisoformat(since)
            except ValueError:
                last_ts = None
        while True:
            if request.client is None:
                break
            db = SessionLocal()
            try:
                query = select(TaskEvent)
                if last_ts:
                    query = query.where(TaskEvent.ts > last_ts)
                events = db.execute(query.order_by(TaskEvent.ts.asc()).limit(200)).scalars().all()
                for e in events:
                    last_ts = e.ts
                    payload = {
                        "id": e.id,
                        "ts": e.ts.isoformat(),
                        "actor": e.actor,
                        "eventType": e.event_type,
                        "taskId": e.task_id,
                        "payload": json.loads(e.payload_json) if e.payload_json else {},
                    }
                    yield f"data: {json.dumps(payload)}\n\n"
            finally:
                db.close()
            time.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
