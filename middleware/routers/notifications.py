import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DbSession

from middleware.db import get_db
from middleware.models import User
from middleware.schemas import NotificationRegisterRequest

router = APIRouter(prefix="/notifications")


@router.post("/register")
def register_notification(req: NotificationRegisterRequest, db: DbSession = Depends(get_db)) -> dict:
    user = db.get(User, req.user_id)
    if not user:
        user = User(id=req.user_id, device_tokens=json.dumps([req.device_token]))
        db.add(user)
        db.commit()
        db.refresh(user)
        return {"ok": True}
    tokens = []
    if user.device_tokens:
        try:
            tokens = json.loads(user.device_tokens)
        except json.JSONDecodeError:
            tokens = []
    if req.device_token not in tokens:
        tokens.append(req.device_token)
        user.device_tokens = json.dumps(tokens)
        db.commit()
    return {"ok": True}
