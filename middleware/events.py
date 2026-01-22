import threading
from typing import Any, Dict

from middleware.opencode.client import OpenCodeClient
from middleware.ws import ConnectionManager


class EventBridge:
    def __init__(self, client: OpenCodeClient, ws_manager: ConnectionManager) -> None:
        self.client = client
        self.ws_manager = ws_manager
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        for event in self.client.stream_events():
            if self._stop.is_set():
                break
            self._handle_event(event)

    def _handle_event(self, event: Dict[str, Any]) -> None:
        payload = {"type": "opencode.event", "payload": event}
        try:
            self.ws_manager.broadcast_sync(payload)
        except Exception:
            pass
