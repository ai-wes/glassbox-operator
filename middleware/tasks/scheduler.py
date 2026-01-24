import threading
import time
from datetime import date

from middleware.db import SessionLocal
from middleware.services.tasks import spawn_daily_tasks
from middleware.ws import ConnectionManager


class TaskScheduler:
    def __init__(self, ws_manager: ConnectionManager, tick_seconds: int = 60) -> None:
        self.ws_manager = ws_manager
        self.tick_seconds = tick_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_day: str | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            today = date.today().isoformat()
            if today != self._last_day:
                db = SessionLocal()
                try:
                    spawn_daily_tasks(db, self.ws_manager)
                    self._last_day = today
                finally:
                    db.close()
            time.sleep(self.tick_seconds)
