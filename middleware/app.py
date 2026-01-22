from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from middleware.config import load_settings
from middleware.db import SessionLocal
from middleware.events import EventBridge
from middleware.opencode.client import OpenCodeClient
from middleware.routers import approvals, health, notifications, sessions, workflows
from middleware.services.sessions import add_message
from middleware.services.prompt import build_system_prompt, ensure_skills_installed, load_agents_md, load_skills
from middleware.ws import ConnectionManager
from middleware.workflows.registry import load_workflows_from_file
from middleware.workflows.runner import WorkflowRunner
from middleware.workflows.scheduler import WorkflowScheduler
from middleware.models import Approval, Session as SessionModel, Workflow, WorkflowRun
from middleware.services.approvals import resolve_approval

settings = load_settings()


app = FastAPI()

app.include_router(health.router)
app.include_router(sessions.router)
app.include_router(workflows.router)
app.include_router(approvals.router)
app.include_router(notifications.router)


@app.on_event("startup")
def on_startup() -> None:
    app.state.settings = settings
    app.state.opencode_client = OpenCodeClient(
        settings.opencode_url,
        settings.opencode_username,
        settings.opencode_password,
        settings.opencode_timeout,
    )
    if settings.install_skills:
        ensure_skills_installed(settings.skill_paths, settings.repo_root)
    agents_text = load_agents_md(settings.agents_path) if settings.inject_agents else ""
    skills_text = load_skills(settings.skill_paths)
    app.state.system_prompt = build_system_prompt(settings.system_prompt, agents_text, skills_text)
    if settings.operator_mcp_url:
        mcp_cfg = {"type": "http", "url": settings.operator_mcp_url}
        if settings.operator_api_key:
            mcp_cfg["headers"] = {"Authorization": f"Bearer {settings.operator_api_key}"}
        app.state.opencode_client.ensure_mcp_server("operator", mcp_cfg)
    app.state.ws_manager = ConnectionManager()
    try:
        import asyncio
        app.state.ws_manager.loop = asyncio.get_event_loop()
    except Exception:
        app.state.ws_manager.loop = None
    app.state.workflow_runner = WorkflowRunner(app.state.opencode_client, app.state.ws_manager)
    app.state.scheduler = WorkflowScheduler(app.state.workflow_runner, settings.scheduler_tick_seconds)
    app.state.scheduler.start()
    if settings.workflows_json:
        db = SessionLocal()
        try:
            load_workflows_from_file(db, settings.workflows_json)
        finally:
            db.close()
    app.state.event_bridge = None
    if settings.enable_events:
        app.state.event_bridge = EventBridge(app.state.opencode_client, app.state.ws_manager)
        app.state.event_bridge.start()


@app.on_event("shutdown")
def on_shutdown() -> None:
    bridge = getattr(app.state, "event_bridge", None)
    if bridge:
        bridge.stop()
    scheduler = getattr(app.state, "scheduler", None)
    if scheduler:
        scheduler.stop()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    manager: ConnectionManager = app.state.ws_manager
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            payload = data.get("payload", {})

            if msg_type == "chat.send":
                session_id = payload.get("sessionId")
                text = payload.get("text")
                if not session_id or not text:
                    await websocket.send_json({"type": "error", "payload": {"message": "sessionId and text required"}})
                    continue
                db = SessionLocal()
                try:
                    session = db.get(SessionModel, session_id)
                    if not session:
                        await websocket.send_json({"type": "error", "payload": {"message": "session not found"}})
                        continue
                    user_msg, assistant_msg = add_message(
                        db,
                        app.state.opencode_client,
                        session,
                        text,
                        system_prompt=app.state.system_prompt,
                        model=settings.opencode_model,
                        agent=settings.opencode_agent,
                    )
                    await manager.broadcast({
                        "type": "chat.message",
                        "payload": {
                            "sessionId": session_id,
                            "messageId": user_msg.id,
                            "role": user_msg.role,
                            "content": user_msg.content,
                            "createdAt": user_msg.created_at.isoformat(),
                        },
                    })
                    await manager.broadcast({
                        "type": "chat.message",
                        "payload": {
                            "sessionId": session_id,
                            "messageId": assistant_msg.id,
                            "role": assistant_msg.role,
                            "content": assistant_msg.content,
                            "createdAt": assistant_msg.created_at.isoformat(),
                        },
                    })
                finally:
                    db.close()

            elif msg_type == "workflow.run":
                workflow_id = payload.get("workflowId")
                session_id = payload.get("sessionId")
                params = payload.get("params") or {}
                if not workflow_id:
                    await websocket.send_json({"type": "error", "payload": {"message": "workflowId required"}})
                    continue
                db = SessionLocal()
                try:
                    workflow = db.get(Workflow, workflow_id)
                    if not workflow:
                        await websocket.send_json({"type": "error", "payload": {"message": "workflow not found"}})
                        continue
                    session = db.get(SessionModel, session_id) if session_id else None
                    run = app.state.workflow_runner.start_run(db, workflow, session, params)
                    await manager.broadcast({
                        "type": "workflow.progress",
                        "payload": {
                            "runId": run.id,
                            "status": run.status,
                            "progress": run.progress,
                            "etaSeconds": run.eta_seconds,
                        },
                    })
                finally:
                    db.close()

            elif msg_type == "approval.respond":
                approval_id = payload.get("approvalId")
                response = payload.get("response")
                if not approval_id or not response:
                    await websocket.send_json({"type": "error", "payload": {"message": "approvalId and response required"}})
                    continue
                db = SessionLocal()
                try:
                    approval = db.get(Approval, approval_id)
                    if not approval:
                        await websocket.send_json({"type": "error", "payload": {"message": "approval not found"}})
                        continue
                    resolved = resolve_approval(db, approval, response)
                    if resolved.workflow_run_id and resolved.status == "approved":
                        run = db.get(WorkflowRun, resolved.workflow_run_id)
                        if run:
                            run.status = "RUNNING"
                            db.commit()
                            app.state.workflow_runner.resume_run(run.id)
                    await manager.broadcast({
                        "type": "approval.resolved",
                        "payload": {
                            "approvalId": resolved.id,
                            "status": resolved.status,
                        },
                    })
                finally:
                    db.close()
            else:
                await websocket.send_json({"type": "error", "payload": {"message": "unknown message type"}})
    except WebSocketDisconnect:
        manager.disconnect(websocket)
