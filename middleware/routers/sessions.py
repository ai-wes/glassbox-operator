from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from middleware.db import get_db
from middleware.models import Message, Session as SessionModel
from middleware.schemas import MessageCreateRequest, MessageResponse, SessionCreateRequest, SessionResponse
from middleware.services.sessions import add_message, create_session, delete_session, update_session_title

router = APIRouter(prefix="/sessions")


@router.get("", response_model=list[SessionResponse])
def list_sessions(db: DbSession = Depends(get_db)) -> list[SessionResponse]:
    sessions = db.execute(select(SessionModel)).scalars().all()
    return [
        SessionResponse(
            id=s.id,
            opencode_session_id=s.opencode_session_id,
            title=s.title,
            status=s.status,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )
        for s in sessions
    ]


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: str, db: DbSession = Depends(get_db)) -> SessionResponse:
    session = db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    return SessionResponse(
        id=session.id,
        opencode_session_id=session.opencode_session_id,
        title=session.title,
        status=session.status,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.post("", response_model=SessionResponse)
def create_session_endpoint(
    req: SessionCreateRequest,
    request: Request,
    db: DbSession = Depends(get_db),
) -> SessionResponse:
    client = request.app.state.opencode_client
    session = create_session(db, client, title=req.title, user_id=req.user_id)
    return SessionResponse(
        id=session.id,
        opencode_session_id=session.opencode_session_id,
        title=session.title,
        status=session.status,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.patch("/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: str,
    req: SessionCreateRequest,
    request: Request,
    db: DbSession = Depends(get_db),
) -> SessionResponse:
    session = db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    client = request.app.state.opencode_client
    session = update_session_title(db, client, session, req.title)
    return SessionResponse(
        id=session.id,
        opencode_session_id=session.opencode_session_id,
        title=session.title,
        status=session.status,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.delete("/{session_id}")
def delete_session_endpoint(
    session_id: str,
    request: Request,
    db: DbSession = Depends(get_db),
) -> dict:
    session = db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    client = request.app.state.opencode_client
    delete_session(db, client, session)
    return {"ok": True}


@router.get("/{session_id}/messages", response_model=list[MessageResponse])
def list_messages(session_id: str, db: DbSession = Depends(get_db)) -> list[MessageResponse]:
    session = db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    messages = db.execute(
        select(Message).where(Message.session_id == session_id).order_by(Message.created_at.asc())
    ).scalars().all()
    return [
        MessageResponse(
            id=m.id,
            session_id=m.session_id,
            role=m.role,
            content=m.content,
            created_at=m.created_at,
        )
        for m in messages
    ]


@router.post("/{session_id}/messages", response_model=list[MessageResponse])
def send_message(
    session_id: str,
    req: MessageCreateRequest,
    request: Request,
    db: DbSession = Depends(get_db),
) -> list[MessageResponse]:
    session = db.get(SessionModel, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="session not found")
    client = request.app.state.opencode_client
    user_msg, assistant_msg = add_message(
        db,
        client,
        session,
        req.text,
        system_prompt=request.app.state.system_prompt,
        model=request.app.state.settings.opencode_model,
        agent=request.app.state.settings.opencode_agent,
    )
    return [
        MessageResponse(
            id=user_msg.id,
            session_id=user_msg.session_id,
            role=user_msg.role,
            content=user_msg.content,
            created_at=user_msg.created_at,
        ),
        MessageResponse(
            id=assistant_msg.id,
            session_id=assistant_msg.session_id,
            role=assistant_msg.role,
            content=assistant_msg.content,
            created_at=assistant_msg.created_at,
        ),
    ]
