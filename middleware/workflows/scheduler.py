import json
import threading
import time
from typing import Dict

from sqlalchemy.orm import Session as DbSession

from middleware.db import SessionLocal
from middleware.models import Workflow, WorkflowRun
from middleware.workflows.runner import WorkflowRunner


class WorkflowScheduler:
    def __init__(self, runner: WorkflowRunner, tick_seconds: int = 5) -> None:
        self.runner = runner
        self.tick_seconds = tick_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_run: Dict[str, float] = {}

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            db = SessionLocal()
            try:
                workflows = db.query(Workflow).filter(Workflow.enabled == True).all()
                now = time.time()
                for workflow in workflows:
                    definition = {}
                    try:
                        definition = json.loads(workflow.definition_json)
                    except Exception:
                        definition = {}
                    interval = definition.get("interval_seconds")
                    if not interval:
                        continue
                    last = self._last_run.get(workflow.id, 0)
                    if now - last >= int(interval):
                        self._last_run[workflow.id] = now
                        self.runner.start_run(db, workflow, None, {})
            finally:
                db.close()
            time.sleep(self.tick_seconds)
