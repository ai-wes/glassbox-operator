import os
from dataclasses import dataclass


@dataclass
class Settings:
    opencode_url: str
    opencode_username: str | None
    opencode_password: str | None
    opencode_timeout: int
    opencode_model: str | None
    opencode_agent: str | None
    operator_mcp_url: str | None
    operator_api_key: str | None
    system_prompt: str
    inject_agents: bool
    agents_path: str
    skill_paths: list[str]
    install_skills: bool
    repo_root: str
    db_url: str
    host: str
    port: int
    enable_events: bool
    workflows_json: str | None
    scheduler_tick_seconds: int
    asr_enabled: bool
    asr_model_name: str
    asr_device: str | None
    asr_sample_rate: int
    asr_sample_width: int
    asr_channels: int
    asr_interim_every_chunks: int
    asr_max_seconds: int
    asr_batch_size: int


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
        tts_enabled=os.getenv("TTS_ENABLED", "0") == "1",
        tts_lang=os.getenv("TTS_LANG", "en"),
        tts_tld=os.getenv("TTS_TLD", "com"),
        tts_slow=os.getenv("TTS_SLOW", "0") == "1",
        system_prompt=os.getenv("SYSTEM_PROMPT", "You are the Head Assistant. You can use tools when needed. Prefer MCP tools for external systems. Be concise and action-oriented.",
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
        asr_enabled=os.getenv("ASR_ENABLED", "0") == "1",
        asr_model_name=os.getenv(
            "ASR_MODEL_NAME",
            "nvidia/nemotron-speech-streaming-en-0.6b",
        ),
        asr_device=os.getenv("ASR_DEVICE"),
        asr_sample_rate=int(os.getenv("ASR_SAMPLE_RATE", "16000")),
        asr_sample_width=int(os.getenv("ASR_SAMPLE_WIDTH", "2")),
        asr_channels=int(os.getenv("ASR_CHANNELS", "1")),
        asr_interim_every_chunks=int(os.getenv("ASR_INTERIM_EVERY_CHUNKS", "5")),
        asr_max_seconds=int(os.getenv("ASR_MAX_SECONDS", "120")),
        asr_batch_size=int(os.getenv("ASR_BATCH_SIZE", "1")),
        tts_enabled=os.getenv("TTS_ENABLED", "0") == "1",
        tts_lang=os.getenv("TTS_LANG", "en"),
        tts_tld=os.getenv("TTS_TLD", "com"),
        tts_slow=os.getenv("TTS_SLOW", "0") == "1",

    )


def _resolve_skill_paths(raw: str | None, repo_root: str) -> list[str]:
    if raw:
        return [p.strip() for p in raw.split(",") if p.strip()]
    default_paths = [
        "awesome-claude-skills/lead-research-assistant/SKILL.md",
        "awesome-claude-skills/content-research-writer/SKILL.md",
        "awesome-claude-skills/artifacts-builder/SKILL.md",
        "awesome-claude-skills/connect-apps/SKILL.md",
        "awesome-claude-skills/mcp-builder/SKILL.md",
        "awesome-claude-skills/meeting-insights-analyzer/SKILL.md",
        "skils/skills/skill-creator/SKILL.md",
        "awesome-claude-skills/document-skills/SKILL.md",
        "awesome-claude-skills/webapp-testing/SKILL.md",
        
    ]
    return [os.path.join(repo_root, p) for p in default_paths]
