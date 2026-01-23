Middle Layer Server

This service exposes REST + WebSocket APIs for the mobile app and persists
conversation history + workflow state. It proxies execution to the OpenCode server.

Quick start
1) Install deps
   pip install -r middleware/requirements.txt

2) Configure env
OPENCODE_URL=http://127.0.0.1:4096
OPENCODE_USERNAME=opencode
OPENCODE_PASSWORD=
OPENCODE_TIMEOUT=120
OPENCODE_MODEL=
OPENCODE_AGENT=
OPERATOR_MCP_URL=
OPERATOR_API_KEY=
SYSTEM_PROMPT=You are the Head Assistant. You can use tools when needed. Prefer MCP tools for external systems. Be concise and action-oriented.
INJECT_AGENTS=1
AGENTS_PATH=/opt/glassbox-operator/AGENTS.md
SKILL_PATHS=awesome-claude-skills/lead-research-assistant/SKILL.md,awesome-claude-skills/content-research-writer/SKILL.md,awesome-claude-skills/artifacts-builder/SKILL.md,awesome-claude-skills/connect-apps/SKILL.md,awesome-claude-skills/mcp-builder/SKILL.md,awesome-claude-skills/meeting-insights-analyzer/SKILL.md
INSTALL_SKILLS=1
MIDDLEWARE_DB_URL=sqlite:///./middleware.db
MIDDLEWARE_HOST=0.0.0.0
MIDDLEWARE_PORT=8099
MIDDLEWARE_ENABLE_EVENTS=1
MIDDLEWARE_WORKFLOWS_JSON=/opt/glassbox-operator/middleware/workflows.json
MIDDLEWARE_SCHEDULER_TICK=5
ASR_ENABLED=0
ASR_MODEL_NAME=nvidia/nemotron-speech-streaming-en-0.6b
ASR_DEVICE=
ASR_SAMPLE_RATE=16000
ASR_SAMPLE_WIDTH=2
ASR_CHANNELS=1
ASR_INTERIM_EVERY_CHUNKS=5
ASR_MAX_SECONDS=120
ASR_BATCH_SIZE=1

3) Run migrations
   alembic -c middleware/alembic.ini upgrade head

4) Run server
   uvicorn middleware.app:app --host 0.0.0.0 --port 8099

ASR (Streaming Speech-to-Text)
This server can expose a streaming ASR WebSocket endpoint backed by NVIDIA NeMo.

1) System deps (Linux)
   apt-get update && apt-get install -y libsndfile1 ffmpeg

2) Python deps
   pip install Cython packaging
   pip install git+https://github.com/NVIDIA/NeMo.git@main#egg=nemo_toolkit[asr]

3) Enable ASR
   export ASR_ENABLED=1
   export ASR_MODEL_NAME=nvidia/nemotron-speech-streaming-en-0.6b
   export ASR_DEVICE=cuda  # or cpu

WebSocket
- /ws/asr

Example client
   python middleware/asr_client.py ./audio.wav --url ws://localhost:8099/ws/asr
   python middleware/asr_client.py ./audio.wav --url ws://localhost:8099/ws/asr --session-id <session_id>

Forwarding to OpenCode
If a session id is provided (query param or start message), the final transcript is sent
to the OpenCode session and the assistant reply is broadcast to /ws clients.

Session id via query param:
  ws://localhost:8099/ws/asr?sessionId=<session_id>

HTTP
- GET /health
- GET /status
- GET /sessions
- POST /sessions
- GET /sessions/{id}/messages
- POST /sessions/{id}/messages
- GET /workflows
- POST /workflows/{id}/run
- GET /workflows/runs/{runId}
- GET /approvals
- POST /approvals/{id}/respond
- POST /notifications/register

WebSocket
- /ws
- /ws/asr
