Head Assistant (OpenCode runtime)

Quick start
1) Install deps
   pip install -r assistant/requirements.txt

2) Start OpenCode server on the Linux host
   opencode server

3) Configure env
   export OPENCODE_URL=http://127.0.0.1:4096
   export OPENCODE_USERNAME=opencode
   export OPENCODE_PASSWORD=...   # set if your server requires auth
   export OPENCODE_MODEL=provider/model
   export OPENCODE_AGENT=

   # Operator MCP gateway
   export OPERATOR_MCP_URL=https://<cloud-run>/mcp
   export OPERATOR_API_KEY=...      # if enabled on Operator

   # Skill loading
   export INSTALL_SKILLS=1
   export INJECT_AGENTS=1
   export AGENTS_PATH=/opt/glassbox-operator/AGENTS.md
   export SKILL_PATHS="awesome-claude-skills/lead-research-assistant/SKILL.md,awesome-claude-skills/content-research-writer/SKILL.md,awesome-claude-skills/artifacts-builder/SKILL.md,awesome-claude-skills/connect-apps/SKILL.md,awesome-claude-skills/mcp-builder/SKILL.md,awesome-claude-skills/meeting-insights-analyzer/SKILL.md"

4) Run the assistant
   python assistant/assistant.py --tasks assistant/tasks.json

HTTP
- GET /health
- GET /tasks
- POST /run {"task":"daily_exec_brief"} or {"prompt":"..."}

Notes
- The assistant will register the Operator MCP gateway with OpenCode on startup.
- Skills are copied into .opencode/skill/<name>/SKILL.md for OpenCode discovery.
