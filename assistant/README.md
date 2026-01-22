Head Assistant (Claude SDK)

Quick start
1) Install deps
   pip install -r assistant/requirements.txt

2) Configure env
   export OPERATOR_MCP_URL=https://<cloud-run>/mcp
   export OPERATOR_API_KEY=...      # if enabled on Operator
   export CLAUDE_MODEL=...          # optional
   export CLAUDE_CLI_PATH=...       # optional

   # Vertex AI (Claude Code runtime)
   export CLAUDE_CODE_USE_VERTEX=1
   export ANTHROPIC_VERTEX_PROJECT_ID=YOUR_GCP_PROJECT_ID
   export CLOUD_ML_REGION=global
   # plus standard GCP auth (e.g., GOOGLE_APPLICATION_CREDENTIALS)

   # Optional controls
   export PERMISSION_MODE=bypassPermissions
   export ALLOW_SHELL=1
   export ALLOW_HTTP=1
   export SKILL_PATHS="awesome-claude-skills/lead-research-assistant/SKILL.md,awesome-claude-skills/content-research-writer/SKILL.md,awesome-claude-skills/artifacts-builder/SKILL.md,awesome-claude-skills/connect-apps/SKILL.md,awesome-claude-skills/mcp-builder/SKILL.md,awesome-claude-skills/meeting-insights-analyzer/SKILL.md"

3) Run
   python assistant/assistant.py --tasks assistant/tasks.json

HTTP
- GET /health
- GET /tasks
- POST /run {"task":"daily_exec_brief"} or {"prompt":"..."}

Tools exposed to Claude
- mcp__local__shell_exec
- mcp__local__file_read
- mcp__local__file_write
- mcp__local__http_request
- mcp__operator__<tool> (all tools from the Operator MCP gateway)
