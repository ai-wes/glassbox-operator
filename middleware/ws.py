import asyncio
from typing import Any, Dict, List

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []
        self.loop = None

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: Dict[str, Any]) -> None:
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

    def broadcast_sync(self, message: Dict[str, Any]) -> None:
        loop = self.loop
        if loop is None:
            return
        if loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(message), loop)
        else:
            loop.run_until_complete(self.broadcast(message))
