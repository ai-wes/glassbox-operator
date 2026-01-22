Migration Checklist: assistant.py -> middleware

1) Install new dependencies
   - pip install -r middleware/requirements.txt

2) Create DB and run migrations
   - alembic -c middleware/alembic.ini upgrade head

3) Prepare environment
   - Copy `middleware/.env.example` to `/opt/glassbox-operator/middleware/.env`
   - Set OPENCODE_URL/OPENCODE_PASSWORD
   - Set MIDDLEWARE_DB_URL to persistent storage
   - (Optional) set MIDDLEWARE_WORKFLOWS_JSON

4) Deploy systemd service update
   - Replace the existing service file with `assistant/glassbox-head-assistant.service`
   - systemctl daemon-reload
   - systemctl restart glassbox-head-assistant

5) Verify
   - curl http://localhost:8099/health
   - curl http://localhost:8099/status
   - WS connect to ws://localhost:8099/ws

6) Deprecate old runner
   - Stop any processes using assistant/assistant.py
   - Archive/remove assistant/tasks.json if not needed

7) Optional: seed workflows
   - Create `/opt/glassbox-operator/middleware/workflows.json`
   - Ensure it validates against `middleware/docs/workflows.schema.json`
