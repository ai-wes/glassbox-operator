import argparse

# Deprecated: replaced by middleware/ service (REST + WebSocket + persistence).
import json
import os
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

DEFAULT_SYSTEM_PROMPT = """You are the Head Assistant. You can use tools when needed.
Prefer MCP tools for external systems. Be concise and action-oriented.
"""

DEFAULT_SKILL_PATHS = [
    "awesome-claude-skills/lead-research-assistant/SKILL.md",
    "awesome-claude-skills/content-research-writer/SKILL.md",
    "awesome-claude-skills/artifacts-builder/SKILL.md",
    "awesome-claude-skills/connect-apps/SKILL.md",
    "awesome-claude-skills/mcp-builder/SKILL.md",
    "awesome-claude-skills/meeting-insights-analyzer/SKILL.md",
]

@dataclass
class TaskDef:
    name: str
    prompt: str
    interval_seconds: int
    enabled: bool = True

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

    def ensure_mcp_server(self, name: str, config: Dict[str, Any]) -> Dict[str, Any]:
        payload = {"name": name, "config": config}
        resp = requests.post(self._url("/mcp"), json=payload, auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def create_session(self, title: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        if title:
            payload["title"] = title
        resp = requests.post(self._url("/session"), json=payload, auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def send_message(
        self,
        session_id: str,
        text: str,
        system: Optional[str] = None,
        model: Optional[str] = None,
        agent: Optional[str] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "parts": [{"type": "text", "text": text}]
        }
        if system:
            body["system"] = system
        if model:
            body["model"] = model
        if agent:
            body["agent"] = agent

        resp = requests.post(self._url(f"/session/{session_id}/message"), json=body, auth=self.auth, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()


def extract_text_from_parts(parts: List[Dict[str, Any]]) -> str:
    out: List[str] = []
    for p in parts:
        if isinstance(p, dict):
            if p.get("type") == "text" and isinstance(p.get("text"), str):
                out.append(p["text"])
            elif isinstance(p.get("content"), str):
                out.append(p["content"])
    return "\n".join(out).strip()

class HeadAssistant:
    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.client = OpenCodeClient(
            cfg["opencode_url"],
            cfg.get("opencode_user"),
            cfg.get("opencode_password"),
            cfg["opencode_timeout"],
        )
        self.skill_text = load_skills(cfg["skill_paths"])
        self.agents_text = load_agents_md(cfg["agents_path"]) if cfg.get("inject_agents") else ""

        if cfg.get("install_skills"):
            ensure_skills_installed(cfg["skill_paths"], cfg["repo_root"])

        if cfg.get("operator_mcp_url"):
            headers: Dict[str, str] = {}
            if cfg.get("operator_api_key"):
                headers["Authorization"] = f"Bearer {cfg['operator_api_key']}"
            mcp_cfg: Dict[str, Any] = {"type": "http", "url": cfg["operator_mcp_url"]}
            if headers:
                mcp_cfg["headers"] = headers
            self.client.ensure_mcp_server("operator", mcp_cfg)

    def build_system_prompt(self) -> str:
        blocks = [self.cfg["system_prompt"]]
        if self.agents_text:
            blocks.append("# AGENTS.md\n" + self.agents_text)
        if self.skill_text:
            blocks.append("# Skills\n" + self.skill_text)
        return "\n\n".join(b for b in blocks if b).strip()

    def run_task(self, prompt: str, context: Optional[str] = None) -> Dict[str, Any]:
        system = self.build_system_prompt()
        full_prompt = prompt if not context else f"{prompt}\n\nContext:\n{context}"
        session = self.client.create_session(title="head-assistant")
        session_id = session.get("id") or session.get("session_id")
        if not session_id:
            return {"ok": False, "error": "failed to create session", "raw": session}

        resp = self.client.send_message(
            session_id,
            full_prompt,
            system=system,
            model=self.cfg.get("opencode_model"),
            agent=self.cfg.get("opencode_agent"),
        )

        parts = resp.get("parts") or []
        final = extract_text_from_parts(parts)
        return {"ok": True, "final": final, "session_id": session_id, "raw": resp}

class RunRequest(BaseModel):
    task: Optional[str] = None
    prompt: Optional[str] = None
    context: Optional[str] = None

class RunResponse(BaseModel):
    run_id: str
    result: Dict[str, Any]

class Scheduler:
    def __init__(self, assistant: HeadAssistant, tasks: List[TaskDef]):
        self.assistant = assistant
        self.tasks = tasks
        self.last_run: Dict[str, float] = {}
        self.stop_event = threading.Event()

    def start(self):
        t = threading.Thread(target=self._loop, daemon=True)
        t.start()

    def stop(self):
        self.stop_event.set()

    def _loop(self):
        tick = int(os.getenv("SCHEDULER_TICK", "5"))
        while not self.stop_event.is_set():
            now = time.time()
            for t in self.tasks:
                if not t.enabled:
                    continue
                last = self.last_run.get(t.name, 0)
                if now - last >= t.interval_seconds:
                    self.last_run[t.name] = now
                    threading.Thread(target=self.assistant.run_task, args=(t.prompt,), daemon=True).start()
            time.sleep(tick)


def load_tasks(path: str) -> List[TaskDef]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    tasks = []
    for item in data.get("tasks", []):
        tasks.append(TaskDef(
            name=item["name"],
            prompt=item["prompt"],
            interval_seconds=int(item.get("interval_seconds", 3600)),
            enabled=bool(item.get("enabled", True))
        ))
    return tasks


def load_skills(paths: List[str]) -> str:
    blocks = []
    for p in paths:
        try:
            with open(p, "r", encoding="utf-8") as f:
                content = f.read().strip()
            blocks.append(f"## {Path(p).parent.name}\n{content}\n")
        except Exception:
            continue
    return "\n".join(blocks).strip()


def load_agents_md(path: Optional[str]) -> str:
    if not path:
        return ""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except Exception:
        return ""


def resolve_skill_paths(raw: Optional[str]) -> List[str]:
    if raw:
        return [p.strip() for p in raw.split(",") if p.strip()]
    repo_root = Path(__file__).resolve().parents[1]
    return [str(repo_root / p) for p in DEFAULT_SKILL_PATHS]


def ensure_skills_installed(paths: List[str], repo_root: str) -> None:
    root = Path(repo_root) / ".opencode" / "skill"
    root.mkdir(parents=True, exist_ok=True)
    for p in paths:
        src = Path(p)
        if not src.exists():
            continue
        skill_name = src.parent.name
        dest_dir = root / skill_name
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / "SKILL.md"
        try:
            dest.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
        except Exception:
            continue


def load_config() -> Dict[str, Any]:
    repo_root = str(Path(__file__).resolve().parents[1])
    return {
        "opencode_url": os.getenv("OPENCODE_URL", "http://127.0.0.1:4096"),
        "opencode_user": os.getenv("OPENCODE_USERNAME", "opencode"),
        "opencode_password": os.getenv("OPENCODE_PASSWORD"),
        "opencode_timeout": int(os.getenv("OPENCODE_TIMEOUT", "120")),
        "opencode_model": os.getenv("OPENCODE_MODEL"),
        "opencode_agent": os.getenv("OPENCODE_AGENT"),
        "operator_mcp_url": os.getenv("OPERATOR_MCP_URL"),
        "operator_api_key": os.getenv("OPERATOR_API_KEY"),
        "system_prompt": os.getenv("SYSTEM_PROMPT", DEFAULT_SYSTEM_PROMPT),
        "inject_agents": os.getenv("INJECT_AGENTS", "1") == "1",
        "agents_path": os.getenv("AGENTS_PATH", os.path.join(repo_root, "AGENTS.md")),
        "skill_paths": resolve_skill_paths(os.getenv("SKILL_PATHS")),
        "install_skills": os.getenv("INSTALL_SKILLS", "1") == "1",
        "repo_root": repo_root,
    }


def create_app(assistant: HeadAssistant, tasks: List[TaskDef]) -> FastAPI:
    app = FastAPI()

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/tasks")
    def list_tasks():
        return {"tasks": [t.__dict__ for t in tasks]}

    @app.post("/run", response_model=RunResponse)
    def run_task(req: RunRequest):
        if not req.task and not req.prompt:
            raise HTTPException(status_code=400, detail="task or prompt is required")
        if req.task:
            t = next((x for x in tasks if x.name == req.task), None)
            if not t:
                raise HTTPException(status_code=404, detail="task not found")
            prompt = t.prompt
        else:
            prompt = req.prompt or ""
        run_id = str(uuid.uuid4())
        result = assistant.run_task(prompt, req.context)
        return RunResponse(run_id=run_id, result=result)

    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tasks", default=os.getenv("TASKS_PATH", "assistant/tasks.json"))
    parser.add_argument("--host", default=os.getenv("ASSISTANT_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("ASSISTANT_PORT", "8099")))
    parser.add_argument("--run", help="Run a single task by name and exit")
    args = parser.parse_args()

    cfg = load_config()
    assistant = HeadAssistant(cfg)
    tasks = load_tasks(args.tasks)

    if args.run:
        task = next((t for t in tasks if t.name == args.run), None)
        if not task:
            raise SystemExit(f"Task not found: {args.run}")
        result = assistant.run_task(task.prompt)
        print(json.dumps(result, indent=2))
        return

    scheduler = Scheduler(assistant, tasks)
    scheduler.start()

    app = create_app(assistant, tasks)
    uvicorn.run(app, host=args.host, port=args.port)

if __name__ == "__main__":
    main()
