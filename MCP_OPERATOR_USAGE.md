# Operator MCP API Usage (for ChatGPT Agent)

This doc explains how to connect to and call the Operator MCP server that powers the control plane (KB, drafts, ARP actions, execution v0, and child MCP routing). The server speaks MCP over STDIO and returns JSON in the response text.

## 1) Connection

The Operator MCP server runs over STDIO, not HTTP.

### Local (recommended for an MCP client)
Build then run:

```
cd /mnt/c/Users/wes/desktop/glassbox-operator/apps2/operator-mcp
npm install
npm run build
node build/index.js
```

Or dev mode:

```
npm run dev
```

Set env vars as needed:

- `OPERATOR_ACTOR_ID` (default: `wes`)
- `OPERATOR_DB_PATH` (default: `./data/operator.db`)
- `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` (optional; enable graph logging)
- `MCP_SERVERS_CONFIG` (path to child MCP server config JSON)
- `MAX_PERSIST_BYTES` (default: `200000`)

### Docker Compose

```
cd /mnt/c/Users/wes/desktop/glassbox-operator
docker compose up --build operator_mcp neo4j
```

Note: Docker requires network access to pull `node:22-alpine`. If the build fails with "load metadata" errors, ensure Docker can reach Docker Hub or pre-pull the image.

## 2) MCP client configuration

Example MCP server config (for a ChatGPT agent or MCP client that shells a process):

```
{
  "mcpServers": {
    "operator": {
      "command": "node",
      "args": ["/mnt/c/Users/wes/desktop/glassbox-operator/apps2/operator-mcp/build/index.js"],
      "env": {
        "OPERATOR_ACTOR_ID": "wes",
        "OPERATOR_DB_PATH": "/mnt/c/Users/wes/desktop/glassbox-operator/.data/operator.db",
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "please_change_me",
        "MCP_SERVERS_CONFIG": "/mnt/c/Users/wes/desktop/glassbox-operator/mcp-servers.json"
      }
    }
  }
}
```

## 3) Tool list (what the agent can call)

### Status / routing
- `operator_status`
- `child_tools_list`
- `child_tool_call`

### Knowledge base
- `kb_upsert`
- `kb_search`
- `kb_get`
- `kb_list`
- `kb_delete`

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

### Audit
- `audit_recent_tool_runs`
- `audit_recent_events`

## 4) Response format

The server returns MCP text content containing JSON. The agent should parse the JSON in the text content.

Example response text:

```
{
  "ok": true,
  "runId": "abc123",
  "result": { ... }
}
```

## 5) Common flows

### A) Knowledge base

Upsert doc:
```
{"tool":"kb_upsert","arguments":{"type":"policy","title":"Refund Policy","body":"...","tags":["billing","policy"]}}
```

Search:
```
{"tool":"kb_search","arguments":{"query":"refunds", "limit": 5}}
```

### B) Drafts

Create a draft:
```
{"tool":"draft_create","arguments":{"kind":"email","title":"Intro","body":"...","meta":{"to":"foo@bar.com"}}}
```

### C) ARP ingestion + execution v0

1) Ingest ARP packet:
```
{"tool":"arp_ingest","arguments":{"arp_json":{...},"actor":"wes"}}
```

2) Approve action(s):
```
{"tool":"arp_action_set_status","arguments":{"action_id":"A-001","status":"approved"}}
```

3) Preview execution plan:
```
{"tool":"arp_execute_plan","arguments":{"packet_id":"<packet_id>","include_high_risk":false}}
```

4) Wire executor (optional):
```
{
  "tool":"arp_action_set_executor",
  "arguments":{
    "action_id":"A-001",
    "executor":{
      "server":"airtable",
      "tool":"airtable_update_record",
      "arguments":{"base_id":"app...","table":"Opportunities","record_id":"rec...","fields":{"Stage":"Discovery"}},
      "operation":"update"
    }
  }
}
```

5) Execute approved actions:
```
{"tool":"arp_execute_approved","arguments":{"packet_id":"<packet_id>","include_high_risk":false,"allow_email_send":false}}
```

## 6) Execution safety rules (v0)

- High-risk actions are skipped unless `include_high_risk: true`.
- Email send is disabled by default. If an executor has `operation: "send"` and the action type is `send_email`, it will be blocked unless `allow_email_send: true`.
- If no executor is set, actions are marked `unsupported` in the plan.

## 7) Child MCP routing

The Operator can route to other MCP servers configured in `mcp-servers.json`:

- Use `child_tools_list` to discover tools.
- Call a tool via `child_tool_call`:

```
{"tool":"child_tool_call","arguments":{"server":"github","tool":"repos_list","arguments":{}}}
```

## 8) Troubleshooting

- If `operator_mcp` fails to connect to Neo4j, wait for Neo4j to be healthy or check credentials.
- If Docker build fails fetching the base image, ensure Docker has network access or pre-pull `node:22-alpine`.

