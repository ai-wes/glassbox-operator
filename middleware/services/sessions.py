import json
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session as DbSession

from middleware.models import Approval, Message, Session, WorkflowRun
from middleware.opencode.client import OpenCodeClient


def create_session(db: DbSession, client: OpenCodeClient, title: Optional[str] = None, user_id: Optional[str] = None) -> Session:
    oc_session = client.session_create(title=title)
    opencode_session_id = oc_session.get("id") or oc_session.get("session_id")
    if not opencode_session_id:
        raise RuntimeError("opencode session id missing")
    session = Session(
        id=str(uuid.uuid4()),
        user_id=user_id,
        opencode_session_id=opencode_session_id,
        title=title,
        status="active",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def add_message(
    db: DbSession,
    client: OpenCodeClient,
    session: Session,
    text: str,
    system_prompt: str | None = None,
    model: str | None = None,
    agent: str | None = None,
) -> tuple[Message, Message]:
    user_msg = Message(
        id=str(uuid.uuid4()),
        session_id=session.id,
        role="user",
        content=text,
        created_at=datetime.utcnow(),
    )
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    is_first = db.query(Message).filter(Message.session_id == session.id).count() == 1
    oc_response = client.session_message(
        session.opencode_session_id,
        text,
        system=system_prompt if is_first else None,
        model=model,
        agent=agent,
    )
    parts = oc_response.get("parts") or []
    assistant_text = _extract_text(parts)
    assistant_msg = Message(
        id=str(uuid.uuid4()),
        session_id=session.id,
        role="assistant",
        content=assistant_text,
        opencode_message_id=(oc_response.get("info") or {}).get("id"),
        created_at=datetime.utcnow(),
    )
    db.add(assistant_msg)
    db.commit()
    db.refresh(assistant_msg)
    session.updated_at = datetime.utcnow()
    db.commit()
    return user_msg, assistant_msg


def _extract_text(parts: list[dict]) -> str:
    out: list[str] = []
    for part in parts:
        if part.get("type") == "text" and isinstance(part.get("text"), str):
            out.append(part["text"])
        elif isinstance(part.get("content"), str):
            out.append(part["content"])
    return "\n".join(out).strip()


def update_session_title(
    db: DbSession,
    client: OpenCodeClient,
    session: Session,
    title: str | None,
) -> Session:
    if title is not None:
        client.session_update(session.opencode_session_id, title=title)
        session.title = title
        session.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(session)
    return session


def delete_session(db: DbSession, client: OpenCodeClient, session: Session) -> None:
    try:
        client.session_delete(session.opencode_session_id)
    except Exception:
        pass
    db.query(WorkflowRun).filter(WorkflowRun.session_id == session.id).update({"session_id": None})
    db.query(Approval).filter(Approval.session_id == session.id).update({"session_id": None})
    db.query(Message).filter(Message.session_id == session.id).delete()
    session.status = "deleted"
    db.delete(session)
    db.commit()
