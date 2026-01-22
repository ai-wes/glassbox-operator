import argparse
import asyncio
import json
import os
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

from claude_agent_sdk import (
    ClaudeAgentOptions,
    ClaudeSDKClient,
    AssistantMessage,
    ResultMessage,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
    create_sdk_mcp_server,
    tool,
)

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

@tool("shell_exec", "Run a shell command on the host", {"command": str, "timeout": int, "cwd": str})
async def shell_exec(args: Dict[str, Any]) -> Dict[str, Any]:
    if os.getenv("ALLOW_SHELL", "1") != "1":
        return {"content": [{"type": "text", "text": "shell_exec disabled by ALLOW_SHELL=0"}]}
    cmd = args.get("command")
    if not cmd:
        return {"content": [{"type": "text", "text": "missing command"}]}
    timeout = int(args.get("timeout", os.getenv("SHELL_TIMEOUT", "120")))
    cwd = args.get("cwd") or os.getenv("SHELL_CWD") or os.getcwd()
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = {
            "returncode": result.returncode,
            "stdout": result.stdout[-int(os.getenv("MAX_OUTPUT", "8000")):],
            "stderr": result.stderr[-int(os.getenv("MAX_OUTPUT", "8000")):],
        }
        return {"content": [{"type": "text", "text": json.dumps(output, indent=2)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"shell_exec error: {e}"}]}

@tool("file_read", "Read a file from disk", {"path": str, "max_bytes": int})
async def file_read(args: Dict[str, Any]) -> Dict[str, Any]:
    path = args.get("path")
    if not path:
        return {"content": [{"type": "text", "text": "missing path"}]}
    max_bytes = int(args.get("max_bytes", os.getenv("MAX_FILE_BYTES", "200000")))
    try:
        with open(path, "rb") as f:
            data = f.read(max_bytes)
        return {"content": [{"type": "text", "text": data.decode("utf-8", errors="replace")}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"file_read error: {e}"}]}

@tool("file_write", "Write a file to disk", {"path": str, "content": str, "mode": str})
async def file_write(args: Dict[str, Any]) -> Dict[str, Any]:
    path = args.get("path")
    content = args.get("content")
    mode = args.get("mode", "overwrite")
    if not path or content is None:
        return {"content": [{"type": "text", "text": "missing path or content"}]}
    try:
        write_mode = "a" if mode == "append" else "w"
        with open(path, write_mode, encoding="utf-8") as f:
            f.write(str(content))
        return {"content": [{"type": "text", "text": f"wrote {path} ({mode})"}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"file_write error: {e}"}]}

@tool("http_request", "Make an HTTP request", {"method": str, "url": str, "headers": dict, "body": dict})
async def http_request(args: Dict[str, Any]) -> Dict[str, Any]:
    if os.getenv("ALLOW_HTTP", "1") != "1":
        return {"content": [{"type": "text", "text": "http_request disabled by ALLOW_HTTP=0"}]}
    method = (args.get("method") or "GET").upper()
    url = args.get("url")
    headers = args.get("headers") or {}
    body = args.get("body")
    if not url:
        return {"content": [{"type": "text", "text": "missing url"}]}
    try:
        resp = requests.request(method, url, headers=headers, json=body, timeout=int(os.getenv("HTTP_TIMEOUT", "30")))
        output = {
            "status": resp.status_code,
            "headers": dict(resp.headers),
            "body": resp.text[: int(os.getenv("MAX_OUTPUT", "8000"))],
        }
        return {"content": [{"type": "text", "text": json.dumps(output, indent=2)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"http_request error: {e}"}]}

class HeadAssistant:
    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.local_tools = create_sdk_mcp_server(
            name="local-tools",
            version="1.0.0",
            tools=[shell_exec, file_read, file_write, http_request],
        )
        self.skill_text = load_skills(cfg["skill_paths"])

    def _build_options(self) -> ClaudeAgentOptions:
        mcp_servers: Dict[str, Any] = {
            "local": {
                "type": "sdk",
                "name": "local-tools",
                "instance": self.local_tools,
            }
        }
        headers: Dict[str, str] = {}
        if self.cfg.get("operator_api_key"):
            headers["Authorization"] = f"Bearer {self.cfg['operator_api_key']}"
        operator_cfg: Dict[str, Any] = {
            "type": "http",
            "url": self.cfg["operator_mcp_url"],
        }
        if headers:
            operator_cfg["headers"] = headers
        mcp_servers["operator"] = operator_cfg

        system_prompt = self.cfg["system_prompt"]
        if self.skill_text:
            system_prompt = f"{system_prompt}\n\n# Skills\n{self.skill_text}"

        options = ClaudeAgentOptions(
            system_prompt=system_prompt,
            mcp_servers=mcp_servers,
            permission_mode=self.cfg["permission_mode"],
            model=self.cfg.get("model"),
            cli_path=self.cfg.get("cli_path"),
            cwd=self.cfg.get("cwd"),
            tools=[],
        )
        return options

    async def run_task_async(self, prompt: str, context: Optional[str] = None) -> Dict[str, Any]:
        full_prompt = prompt if not context else f"{prompt}\n\nContext:\n{context}"
        options = self._build_options()

        output_text: List[str] = []
        tool_uses: List[Dict[str, Any]] = []
        total_cost = None

        async with ClaudeSDKClient(options=options) as client:
            await client.query(full_prompt)
            async for message in client.receive_response():
                if isinstance(message, AssistantMessage):
                    for block in message.content:
                        if isinstance(block, TextBlock):
                            output_text.append(block.text)
                        elif isinstance(block, ToolUseBlock):
                            tool_uses.append({"name": block.name, "input": block.input})
                elif isinstance(message, ResultMessage):
                    total_cost = message.total_cost_usd
                elif isinstance(message, SystemMessage):
                    continue

        return {
            "ok": True,
            "final": "\n".join(output_text).strip(),
            "tool_uses": tool_uses,
            "cost_usd": total_cost,
        }

    def run_task_sync(self, prompt: str, context: Optional[str] = None) -> Dict[str, Any]:
        return asyncio.run(self.run_task_async(prompt, context))

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
                    threading.Thread(target=self.assistant.run_task_sync, args=(t.prompt,), daemon=True).start()
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


def resolve_skill_paths(raw: Optional[str]) -> List[str]:
    if raw:
        return [p.strip() for p in raw.split(",") if p.strip()]
    repo_root = Path(__file__).resolve().parents[1]
    return [str(repo_root / p) for p in DEFAULT_SKILL_PATHS]


def load_config() -> Dict[str, Any]:
    return {
        "operator_mcp_url": os.getenv("OPERATOR_MCP_URL", "http://localhost:8090/mcp"),
        "operator_api_key": os.getenv("OPERATOR_API_KEY"),
        "system_prompt": os.getenv("SYSTEM_PROMPT", DEFAULT_SYSTEM_PROMPT),
        "permission_mode": os.getenv("PERMISSION_MODE", "bypassPermissions"),
        "model": os.getenv("CLAUDE_MODEL"),
        "cli_path": os.getenv("CLAUDE_CLI_PATH"),
        "cwd": os.getenv("ASSISTANT_CWD"),
        "skill_paths": resolve_skill_paths(os.getenv("SKILL_PATHS")),
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
        result = assistant.run_task_sync(prompt, req.context)
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
        result = assistant.run_task_sync(task.prompt)
        print(json.dumps(result, indent=2))
        return

    scheduler = Scheduler(assistant, tasks)
    scheduler.start()

    app = create_app(assistant, tasks)
    uvicorn.run(app, host=args.host, port=args.port)

if __name__ == "__main__":
    main()
