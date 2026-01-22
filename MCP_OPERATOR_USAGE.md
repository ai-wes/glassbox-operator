# Operator MCP API Usage (HTTP / ChatGPT App)

This doc describes the current Operator MCP server (apps/operator). It is **HTTP-based** and exposes **direct tools** (outlook/airtable/clay/glassbox/gcp) without requiring child MCP routing.

## 1) Connection (HTTP)

The MCP endpoint is HTTP and **requires an MCP session**. The client must accept **application/json** and **text/event-stream**.

Example (Cloud Run):

```
BASE="https://glassbox-operator-mcp-662656813262.us-central1.run.app/mcp"

SESSION=$(curl -sS -D - -o /dev/null \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -X POST "$BASE" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0.1"}}}' \
  | tr -d '\r' | awk 'BEGIN{IGNORECASE=1} $1=="mcp-session-id:" {print $2}')

curl -sS \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SESSION" \
  -X POST "$BASE" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

The response is SSE-formatted:

```
event: message
data: {"result":{"tools":[ ... ]},"jsonrpc":"2.0","id":2}
```

## 2) Tool list (direct tools)

### Status / routing
- `operator_status`

### Knowledge base
- `kb_upsert`
- `kb_search`
- `kb_get`
- `kb_list`
- `kb_delete`
- `kb_doc_link_to_action`
- `kb_validate_copy`

### Drafts
- `draft_create`
- `draft_get`
- `draft_list`
- `draft_set_status`

### ARP + execution v0
- `arp_ingest`
- `arp_get`
- `arp_action_set_status`
- `arp_action_set_executor`
- `arp_execute_plan`
- `arp_execute_approved`
- `arp_execution_history`

### Graph / Neo4j
- `neo4j.cypher_run`
- `graph_query`
- `graph_set_action_status`

### Audit
- `audit_recent_tool_runs`
- `audit_recent_events`

### Outlook (Microsoft Graph, app-only)
- `outlook.list_folders`
- `outlook.search_messages`
- `outlook.get_message`
- `outlook.create_draft`
- `outlook.create_reply_draft`
- `outlook.update_draft`
- `outlook.send_draft`

### Airtable
- `airtable.list_bases`
- `airtable.list_tables`
- `airtable.list_records`
- `airtable.get_record`
- `airtable.create_record`
- `airtable.update_record`
- `airtable.upsert_record`

### Clay (HTTP)
- `clay.request` (full URL supported)
- `clay.webhook_send`

### Glassbox
- `gb_request`
- `gb_projects_summary`
- `gb_pipeline_run`
- `glassbox.orchestrator.run_phase`
- `glassbox.pipeline.list_phases`
- `glassbox.pipeline.run`
- `glassbox.reports.get_report`
- `glassbox.reports.get_tiered_report`
- `glassbox.reports.list_sections`
- `glassbox.reports.get_section`
- `glassbox.reports.get_artifact`
- `glassbox.reports.get_executive_summary`
- `glassbox.reports.ingest_summary_json`
- `glassbox.reports.ingest_full_report`
- `glassbox.documents.list_documents`
- `glassbox.documents.fetch_document`
- `glassbox.documents.create_document`
- `glassbox.documents.update_document`
- `glassbox.documents.delete_document`
- `glassbox.blog.list_posts`
- `glassbox.blog.read_post`
- `glassbox.blog.create_post`
- `glassbox.blog.update_post`
- `glassbox.blog.delete_post`
- `glassbox.files.list`
- `glassbox.files.upload`
- `glassbox.files.get_metadata`
- `glassbox.files.download`
- `glassbox.files.delete`
- `glassbox.files.list_bucket`
- `glassbox.files.get_download_url`
- `glassbox.files.delete_key`
- `glassbox.users.me`
- `glassbox.users.update_me`
- `glassbox.users.list`
- `glassbox.users.update_role`
- `glassbox.users.delete`

**Note:** Glassbox calls default to the `/api/v1` prefix.  
If your base URL already includes `/api/v1`, set `GLASSBOX_API_PREFIX=` (empty) to avoid double-prefixing.

### GCP
- `gcp.cloudrun.list_services`
- `gcp.cloudrun.list_revisions`
- `gcp.logs.query`

## 3) Example tool calls

### Outlook list folders
```
{"method":"tools/call","params":{"name":"outlook.list_folders","arguments":{"top":20}}}
```

### Outlook search Inbox
```
{"method":"tools/call","params":{"name":"outlook.search_messages","arguments":{"folder":"Inbox","top":5}}}
```

### Airtable list bases
```
{"method":"tools/call","params":{"name":"airtable.list_bases","arguments":{}}}
```

### Clay request (full URL)
```
{"method":"tools/call","params":{"name":"clay.request","arguments":{"method":"POST","path":"https://<your-endpoint>","body":{}}}}
```

## 4) Execution safety rules (v0)

- High-risk actions are skipped unless `include_high_risk: true`.
- Email send is disabled by default. If an executor has `operation: "send"` and the action type is `email_send`/`send_email`, it will be blocked unless `allow_email_send: true`.
- If no executor is set, actions are marked `unsupported` in the plan.

## 5) Optional child routing (only if enabled)

Child MCP routing is **disabled by default** in the single-container deployment.  
If you want it, set:

- `OPERATOR_UPSTREAMS_JSON` with at least one upstream
- `OPERATOR_ENABLE_CHILD_ROUTING=1`

Only then will these tools appear:
- `child_tools_list`
- `child_tool_call`
