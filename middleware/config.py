import os
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class Settings:
    opencode_url: str
    opencode_username: Optional[str]
    opencode_password: Optional[str]
    opencode_timeout: int
    opencode_model: Optional[str]
    opencode_agent: Optional[str]
    operator_mcp_url: Optional[str]
    operator_api_key: Optional[str]
    system_prompt: str
    inject_agents: bool
    agents_path: str
    skill_paths: List[str]
    install_skills: bool
    repo_root: str
    db_url: str
    host: str
    port: int
    enable_events: bool
    workflows_json: Optional[str]
    scheduler_tick_seconds: int


def load_settings() -> Settings:
    repo_root = os.path.dirname(os.path.dirname(__file__))
    return Settings(
        opencode_url=os.getenv("OPENCODE_URL", "http://127.0.0.1:4096"),
        opencode_username=os.getenv("OPENCODE_USERNAME", "opencode"),
        opencode_password=os.getenv("OPENCODE_PASSWORD"),
        opencode_timeout=int(os.getenv("OPENCODE_TIMEOUT", "120")),
        opencode_model=os.getenv("OPENCODE_MODEL"),
        opencode_agent=os.getenv("OPENCODE_AGENT"),
        operator_mcp_url=os.getenv("OPERATOR_MCP_URL"),
        operator_api_key=os.getenv("OPERATOR_API_KEY"),
        system_prompt=os.getenv(
            "SYSTEM_PROMPT",
            "You are the Head Assistant. You can use tools when needed. Prefer MCP tools for external systems. Be concise and action-oriented.",
        ),
        inject_agents=os.getenv("INJECT_AGENTS", "1") == "1",
        agents_path=os.getenv("AGENTS_PATH", os.path.join(repo_root, "AGENTS.md")),
        skill_paths=_resolve_skill_paths(os.getenv("SKILL_PATHS"), repo_root),
        install_skills=os.getenv("INSTALL_SKILLS", "1") == "1",
        repo_root=repo_root,
        db_url=os.getenv("MIDDLEWARE_DB_URL", "sqlite:///./middleware.db"),
        host=os.getenv("MIDDLEWARE_HOST", "0.0.0.0"),
        port=int(os.getenv("MIDDLEWARE_PORT", "8099")),
        enable_events=os.getenv("MIDDLEWARE_ENABLE_EVENTS", "1") == "1",
        workflows_json=os.getenv("MIDDLEWARE_WORKFLOWS_JSON"),
        scheduler_tick_seconds=int(os.getenv("MIDDLEWARE_SCHEDULER_TICK", "5")),
    )


def _resolve_skill_paths(raw: Optional[str], repo_root: str) -> List[str]:
    if raw:
        return [p.strip() for p in raw.split(",") if p.strip()]
    default_paths = [
        "awesome-claude-skills/lead-research-assistant/SKILL.md",
        "awesome-claude-skills/content-research-writer/SKILL.md",
        "awesome-claude-skills/artifacts-builder/SKILL.md",
        "awesome-claude-skills/connect-apps/SKILL.md",
        "awesome-claude-skills/mcp-builder/SKILL.md",
        "awesome-claude-skills/meeting-insights-analyzer/SKILL.md",
    ]
    return [os.path.join(repo_root, p) for p in default_paths]
