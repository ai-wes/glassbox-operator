Middle Layer Server

This service exposes REST + WebSocket APIs for the mobile app and persists
conversation history + workflow state. It proxies execution to the OpenCode server.

Quick start
1) Install deps
   pip install -r middleware/requirements.txt

2) Configure env
   export OPENCODE_URL=http://127.0.0.1:4096
   export OPENCODE_USERNAME=opencode
   export OPENCODE_PASSWORD=opencode
   export OPENCODE_MODEL=
   export OPENCODE_AGENT=
   export OPERATOR_MCP_URL=
   export OPERATOR_API_KEY=
   export SYSTEM_PROMPT="You are the Head Assistant. You can use tools when needed. Prefer MCP tools for external systems. Be concise and action-oriented."
   export INJECT_AGENTS=1
   export AGENTS_PATH=/opt/glassbox-operator/AGENTS.md
   export SKILL_PATHS="awesome-claude-skills/lead-research-assistant/SKILL.md,awesome-claude-skills/content-research-writer/SKILL.md,awesome-claude-skills/artifacts-builder/SKILL.md,awesome-claude-skills/connect-apps/SKILL.md,awesome-claude-skills/mcp-builder/SKILL.md,awesome-claude-skills/meeting-insights-analyzer/SKILL.md"
   export INSTALL_SKILLS=1
   export MIDDLEWARE_DB_URL=sqlite:///./middleware.db
   export MIDDLEWARE_WORKFLOWS_JSON=/opt/glassbox-operator/middleware/workflows.json

3) Run migrations
   PYTHONPATH=. alembic -c middleware/alembic.ini upgrade head

4) Run server
   uvicorn middleware.app:app --host 0.0.0.0 --port 8099

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
