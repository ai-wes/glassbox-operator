import json
import threading
import time
import uuid
from datetime import datetime
from typing import Any, Dict

from sqlalchemy.orm import Session as DbSession

from middleware.models import Session, Workflow, WorkflowRun
from middleware.opencode.client import OpenCodeClient
from middleware.services.approvals import create_approval
from middleware.ws import ConnectionManager


class WorkflowRunner:
    def __init__(self, client: OpenCodeClient, ws_manager: ConnectionManager) -> None:
        self.client = client
        self.ws_manager = ws_manager

    def start_run(self, db: DbSession, workflow: Workflow, session: Session | None, params: Dict[str, Any]) -> WorkflowRun:
        run = WorkflowRun(
            id=str(uuid.uuid4()),
            workflow_id=workflow.id,
            session_id=session.id if session else None,
            status="QUEUED",
            progress=0.0,
            meta_json=json.dumps({"params": params, "current_step": 0}),
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        threading.Thread(target=self._execute_run, args=(run.id,), daemon=True).start()
        return run

    def resume_run(self, run_id: str) -> None:
        threading.Thread(target=self._execute_run, args=(run_id,), daemon=True).start()

    def _execute_run(self, run_id: str) -> None:
        from middleware.db import SessionLocal
        db = SessionLocal()
        try:
            run = db.get(WorkflowRun, run_id)
            if not run:
                return
            workflow = db.get(Workflow, run.workflow_id)
            if not workflow:
                return
            definition = json.loads(workflow.definition_json)
            steps = definition.get("steps", [])
            meta = json.loads(run.meta_json or "{}")
            current_step = int(meta.get("current_step", 0))

            run.status = "RUNNING"
            run.started_at = run.started_at or datetime.utcnow()
            db.commit()
            self._broadcast_progress(run)

            for idx in range(current_step, len(steps)):
                step = steps[idx]
                meta["current_step"] = idx
                run.meta_json = json.dumps(meta)
                db.commit()

                if step.get("type") == "approval":
                    meta["current_step"] = idx + 1
                    run.meta_json = json.dumps(meta)
                    db.commit()
                    approval = create_approval(
                        db,
                        action=step.get("action", "approval"),
                        context=step.get("context", {}),
                        risk_level=step.get("risk_level", "medium"),
                        workflow_run_id=run.id,
                        session_id=run.session_id,
                    )
                    run.status = "WAITING_APPROVAL"
                    db.commit()
                    self.ws_manager.broadcast_sync({
                        "type": "approval.requested",
                        "payload": {
                            "approvalId": approval.id,
                            "action": approval.action,
                            "context": json.loads(approval.context_json or "{}"),
                            "riskLevel": approval.risk_level,
                        },
                    })
                    self._broadcast_progress(run)
                    return

                if step.get("type") == "opencode_prompt":
                    session_id = run.session_id
                    if not session_id:
                        session = Session(
                            id=str(uuid.uuid4()),
                            opencode_session_id=self.client.session_create(title=workflow.name).get("id"),
                            title=workflow.name,
                            status="active",
                            created_at=datetime.utcnow(),
                            updated_at=datetime.utcnow(),
                        )
                        db.add(session)
                        db.commit()
                        db.refresh(session)
                        run.session_id = session.id
                        db.commit()
                        session_id = session.id
                    session = db.get(Session, session_id)
                    if session:
                        self.client.session_message(session.opencode_session_id, step.get("prompt", ""))

                if step.get("type") == "delay":
                    time.sleep(int(step.get("seconds", 1)))

                run.progress = float(idx + 1) / float(max(len(steps), 1))
                db.commit()
                self._broadcast_progress(run)

            run.status = "COMPLETED"
            run.ended_at = datetime.utcnow()
            run.progress = 1.0
            db.commit()
            self.ws_manager.broadcast_sync({
                "type": "workflow.completed",
                "payload": {"runId": run.id, "status": run.status},
            })
            self._broadcast_progress(run)
        finally:
            db.close()

    def _broadcast_progress(self, run: WorkflowRun) -> None:
        self.ws_manager.broadcast_sync({
            "type": "workflow.progress",
            "payload": {
                "runId": run.id,
                "status": run.status,
                "progress": run.progress,
                "etaSeconds": run.eta_seconds,
            },
        })
