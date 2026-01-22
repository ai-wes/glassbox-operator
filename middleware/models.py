from datetime import datetime
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True)
    email = Column(String(255), nullable=True)
    device_tokens = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    sessions = relationship("Session", back_populates="user")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    opencode_session_id = Column(String(64), unique=True, nullable=False)
    title = Column(String(255), nullable=True)
    status = Column(String(32), default="active")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="sessions")
    messages = relationship("Message", back_populates="session")
    workflow_runs = relationship("WorkflowRun", back_populates="session")


class Message(Base):
    __tablename__ = "messages"

    id = Column(String(36), primary_key=True)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=False)
    role = Column(String(32), nullable=False)
    content = Column(Text, nullable=False)
    opencode_message_id = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("Session", back_populates="messages")


class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(String(64), primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(64), nullable=True)
    definition_json = Column(Text, nullable=False)
    enabled = Column(Boolean, default=True)

    runs = relationship("WorkflowRun", back_populates="workflow")


class WorkflowRun(Base):
    __tablename__ = "workflow_runs"

    id = Column(String(64), primary_key=True)
    workflow_id = Column(String(64), ForeignKey("workflows.id"), nullable=False)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=True)
    status = Column(String(32), default="QUEUED")
    progress = Column(Float, default=0.0)
    eta_seconds = Column(Integer, nullable=True)
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    meta_json = Column(Text, nullable=True)

    workflow = relationship("Workflow", back_populates="runs")
    session = relationship("Session", back_populates="workflow_runs")
    approvals = relationship("Approval", back_populates="workflow_run")


class Approval(Base):
    __tablename__ = "approvals"

    id = Column(String(64), primary_key=True)
    workflow_run_id = Column(String(64), ForeignKey("workflow_runs.id"), nullable=True)
    session_id = Column(String(36), ForeignKey("sessions.id"), nullable=True)
    status = Column(String(32), default="pending")
    action = Column(String(255), nullable=False)
    context_json = Column(Text, nullable=True)
    risk_level = Column(String(16), default="medium")
    requested_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)
    resolved_by = Column(String(64), nullable=True)

    workflow_run = relationship("WorkflowRun", back_populates="approvals")
