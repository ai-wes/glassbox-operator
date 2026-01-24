import json
from typing import Any, Dict, Optional, Tuple

import requests


class OpenCodeClient:
    def __init__(self, base_url: str, username: Optional[str], password: Optional[str], timeout: int = 60):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.auth: Optional[Tuple[str, str]] = None
        if username and password:
            self.auth = (username, password)

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def health(self) -> Dict[str, Any]:
        resp = requests.get(self._url("/global/health"), auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def mcp_status(self) -> Dict[str, Any]:
        resp = requests.get(self._url("/mcp"), auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def ensure_mcp_server(self, name: str, config: Dict[str, Any]) -> Dict[str, Any]:
        payload = {"name": name, "config": config}
        resp = requests.post(self._url("/mcp"), json=payload, auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def session_create(self, title: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if title:
            payload["title"] = title
        resp = requests.post(self._url("/session"), json=payload, auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def session_list(self) -> list[Dict[str, Any]]:
        resp = requests.get(self._url("/session"), auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def session_get(self, session_id: str) -> Dict[str, Any]:
        resp = requests.get(self._url(f"/session/{session_id}"), auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def session_update(self, session_id: str, title: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if title is not None:
            payload["title"] = title
        resp = requests.patch(self._url(f"/session/{session_id}"), json=payload, auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def session_delete(self, session_id: str) -> bool:
        resp = requests.delete(self._url(f"/session/{session_id}"), auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return bool(resp.json()) if resp.content else True

    def session_status(self) -> Dict[str, Any]:
        resp = requests.get(self._url("/session/status"), auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def session_message(
        self,
        session_id: str,
        text: str,
        system: Optional[str] = None,
        model: Optional[str] = None,
        agent: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"parts": [{"type": "text", "text": text}]}
        if system:
            body["system"] = system
        if model:
            body["model"] = model
        if agent:
            body["agent"] = agent
        resp = requests.post(self._url(f"/session/{session_id}/message"), json=body, auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def session_prompt_async(self, session_id: str, text: str) -> None:
        body: Dict[str, Any] = {"parts": [{"type": "text", "text": text}]}
        resp = requests.post(self._url(f"/session/{session_id}/prompt_async"), json=body, auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()

    def permissions_respond(self, session_id: str, permission_id: str, response: str, remember: Optional[bool] = None) -> bool:
        body: Dict[str, Any] = {"response": response}
        if remember is not None:
            body["remember"] = remember
        resp = requests.post(
            self._url(f"/session/{session_id}/permissions/{permission_id}"),
            json=body,
            auth=self.auth,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return bool(resp.json()) if resp.content else True

    def session_command(
        self,
        session_id: str,
        command: str,
        arguments: Optional[Dict[str, Any]] = None,
        model: Optional[str] = None,
        agent: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"command": command}
        if arguments:
            body["arguments"] = arguments
        if model:
            body["model"] = model
        if agent:
            body["agent"] = agent
        resp = requests.post(self._url(f"/session/{session_id}/command"), json=body, auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def stream_events(self):
        resp = requests.get(self._url("/event"), auth=self.auth, timeout=self.timeout, stream=True)
        resp.raise_for_status()
        for line in resp.iter_lines(decode_unicode=True):
            if not line:
                continue
            if line.startswith("data:"):
                payload = line.replace("data:", "", 1).strip()
                if payload:
                    try:
                        yield json.loads(payload)
                    except json.JSONDecodeError:
                        continue
