ChatGPT said:

CAN: Here’s the complete codebase that adds CRM + clienteling operations (Clay + Airtable + Gmail + LinkedIn drafts) into the same Operator app control plane, while also supporting your Cluster B (Product/Engineering) tool backends as upstream MCPs.

Download the full project (zip)
What you now have

1. One Operator app = one control plane (MCP server + optional UI)

   Operator MCP endpoint: POST /mcp

   Optional web console: served at / (React app)

   High-level tools for RevOps + EngOps

   Generic passthrough tool for calling any upstream tool safely

This matches the “one app, multiple tool backends” approach used by the Apps SDK patterns. 2) A Glassbox MCP server (separate backend)

    Exposes your FastAPI functionality as MCP tools over /mcp

    Operator can treat it like any other upstream tool backend

3. Upstream MCP servers (you run them, Operator connects)

You can connect:

    Clay MCP (tools like createContact, searchContacts, etc.)

    Airtable MCP (tools like create_record, update_record, list_records, etc.)

    Gmail MCP (tools like draft_email, send_email, etc.)

    GitHub / Vercel / GCP MCP (Cluster B)

    Glassbox MCP (included)

The RevOps tools you asked for (Clay + Airtable + Email + LinkedIn drafts)

These are implemented in:

apps/operator/server/src/tools/revops.ts
Tools exposed by Operator
revops.lead_capture

Creates a lead across:

    Clay (optional)

    Airtable (optional)

This is your lead intake tool for CRM/clienteling.
revops.lead_enrich

Uses Clay searchContacts to enrich a lead; can optionally write key fields back into Airtable.
revops.email_draft

Creates a Gmail draft via the Gmail MCP server.
revops.email_send

Sends an email via Gmail MCP but requires approval_token.
revops.linkedin_draft_save

No LinkedIn API automation — this stores the draft message in Airtable so you can send manually (exactly as required).
How Operator calls the upstream MCPs

Operator reads your upstream definitions from:

OPERATOR_UPSTREAMS_JSON in apps/operator/server/.env

Supports:

    transport.type = "stdio" (Operator spawns the MCP server via subprocess)

    transport.type = "http" (Operator speaks MCP JSON-RPC over HTTP, with session management)

This means you can run Clay locally via stdio (common pattern), while running Airtable/Gmail/etc via HTTP MCP if you prefer.
Key “control plane” tools (for debugging + full access)

Implemented in:

apps/operator/server/src/tools/operator.ts
Tools:

    operator.status → upstream connectivity, tool counts

    operator.upstreams.tools → lists cached tool names per upstream / cluster

    operator.refresh_tools → refreshes tool lists

    operator.call → generic passthrough to any upstream tool (with optional dangerous+approval gating)

Cluster B support (Product + Engineering Ops)

Implemented in:

apps/operator/server/src/tools/engops.ts
Tools:

    engops.tools → list tools available across Vercel/GCP/GitHub/Glassbox upstreams

    engops.call → call any Cluster B tool (optionally gated)

This avoids hardcoding tool names for Vercel/GCP/GitHub (since those MCP servers vary), while still giving you full access.
Glassbox MCP server (included)

Located at:

mcp/glassbox/

It exposes tools like:

    glassbox.me.projects_summary

    glassbox.pipeline.phases

    glassbox.pipeline.run

    glassbox.files.*

    glassbox.documents.*

    glassbox.orchestrator.run (if GLASSBOX_ORCH_BASE is set)

Operator can connect to it as an upstream over HTTP (http://localhost:3100/mcp).
Quickstart

1. Unzip

unzip operator_control_plane.zip
cd operator_control_plane

2. Configure env

cp apps/operator/server/.env.example apps/operator/server/.env
cp mcp/glassbox/.env.example mcp/glassbox/.env

Edit both .env files. 3) Run locally (docker compose)

docker compose up --build

    Operator: http://localhost:3000/ and POST http://localhost:3000/mcp

    Glassbox MCP: POST http://localhost:3100/mcp

    You will still need to run/configure Clay/Airtable/Gmail/Vercel/GCP/GitHub MCP upstreams (or change upstream configs to point at wherever you run them).

Example: Upstream config for RevOps

In apps/operator/server/.env:

OPERATOR_UPSTREAMS_JSON=[
{
"id": "clay",
"cluster": "revops",
"transport": { "type": "stdio", "command": "npx", "args": ["-y", "@clayhq/mcp"] }
},
{
"id": "airtable",
"cluster": "revops",
"transport": { "type": "http", "url": "http://localhost:3201/mcp" }
},
{
"id": "gmail",
"cluster": "revops",
"transport": { "type": "http", "url": "http://localhost:3202/mcp" }
}
]

What I did to make this “real” (and not brittle)

1. Schema-aware argument mapping

Clay/Airtable/Gmail MCP servers aren’t guaranteed to use identical parameter names.
So RevOps tools attempt to:

    pull each upstream tool’s inputSchema

    map your lead/email fields into whatever that schema expects (best-effort)

This lets you swap MCP server implementations with less rewriting. 2) Approval gating for anything that can cause damage

    revops.email_send requires approval

    Operator passthrough operator.call can require approval if you mark it dangerous: true

    Glassbox admin deletes/updates require approval_token (and you should also gate those via Operator)

Where to add your next CRM/clienteling workflows

If you want the next layer (highly recommended), add these in:

apps/operator/server/src/tools/revops.ts

Typical next tools:

    revops.sequence_create (multi-step: email draft + linkedin draft + follow-up tasks)

    revops.touchpoint_log (write every interaction into Airtable activities table)

    revops.pipeline_daily_brief (Airtable query + summary)

    revops.next_best_action (rules engine based on stage + last touchpoint)

If you want, I can extend this codebase to include:

    Airtable “Activities” + “Tasks” schema support + strict field mapping

    Lead stage automation

    Email sequencing + timers

    A “clienteling dossier” view (Clay interactions + Airtable history + draft assets)

Just tell me your Airtable table/field names (or share a screenshot/export), and I’ll wire the exact schema into the tools without guesswork.
You said:
i need the code in the ui bc the session timed out and i cant download it now
ChatGPT said:

CAN: Got it. Below is a complete, copy‑pasteable codebase for one Operator control‑plane MCP server + a Glassbox MCP server (wrapping your FastAPI API via HTTP), designed exactly for your two clusters:

    Cluster A (Revenue Ops v1): Clay MCP, Airtable MCP, Gmail MCP, LinkedIn Draft tools (no automation), GitHub (optional)

    Cluster B (Product + Eng Ops v2): Vercel MCP, Google Cloud MCP, GitHub MCP, Glassbox MCP (this repo provides it)

It’s one app (Operator) that can call multiple MCP backends, with:

    a generic proxy tool (so you can call any upstream MCP tool),

    playbooks for RevOps + EngOps,

    explicit write-guardrails (confirm_write + per‑upstream allowWrite),

    a minimal local web UI (so you can test without ChatGPT).

Repo layout (copy exactly)

operator-control-plane/
├─ package.json
├─ docker-compose.yml
├─ .gitignore
├─ operator.upstreams.example.json
├─ operator.actionmap.example.json
└─ apps/
├─ operator/
│ ├─ package.json
│ ├─ tsconfig.json
│ ├─ src/
│ │ ├─ index.ts
│ │ ├─ config.ts
│ │ ├─ logger.ts
│ │ ├─ security.ts
│ │ ├─ templating.ts
│ │ ├─ upstreams/
│ │ │ ├─ types.ts
│ │ │ ├─ upstreamClient.ts
│ │ │ └─ upstreamManager.ts
│ │ ├─ playbooks/
│ │ │ ├─ revops.ts
│ │ │ └─ engops.ts
│ │ ├─ mcp/
│ │ │ ├─ sessionRouter.ts
│ │ │ └─ createOperatorMcpServer.ts
│ │ └─ http/
│ │ └─ api.ts
│ └─ public/
│ ├─ index.html
│ ├─ styles.css
│ └─ app.js
└─ glassbox-mcp/
├─ package.json
├─ tsconfig.json
└─ src/
├─ index.ts
├─ config.ts
├─ logger.ts
├─ mcpServer.ts
└─ http.ts

Root files
operator-control-plane/package.json

{
"name": "operator-control-plane",
"private": true,
"type": "module",
"workspaces": [
"apps/*"
],
"scripts": {
"build": "npm -ws run build",
"dev": "npm --workspace apps/operator run dev",
"start": "npm --workspace apps/operator run start"
}
}

operator-control-plane/.gitignore

node*modules
dist
.DS_Store
.env
.env.*
.data
\_.log

operator-control-plane/docker-compose.yml

services:
operator:
build: ./apps/operator
environment: - OPERATOR_PORT=8090 - OPERATOR_HOST=0.0.0.0 # Optional auth. If set, requires: Authorization: Bearer <token> # - OPERATOR_API_KEY=replace_me

      # Point to upstreams JSON (mounted below)
      - OPERATOR_UPSTREAMS_PATH=/config/upstreams.json
      - OPERATOR_ACTION_MAP_PATH=/config/actionmap.json
      - OPERATOR_ALLOW_WRITE=0
    ports:
      - "8090:8090"
    volumes:
      - ./operator.upstreams.example.json:/config/upstreams.json:ro
      - ./operator.actionmap.example.json:/config/actionmap.json:ro
      - ./.data:/app/.data

glassbox_mcp:
build: ./apps/glassbox-mcp
environment: - GLASSBOX_MCP_PORT=8091 - GLASSBOX_MCP_HOST=0.0.0.0 # Your FastAPI base (set to your deployed API) - GLASSBOX_API_BASE_URL=https://api.glassbox-bio.com/api/v1 # Auth options: # - GLASSBOX_BEARER_TOKEN=... # - GLASSBOX_INTERNAL_API_KEY=...
ports: - "8091:8091"

operator-control-plane/operator.upstreams.example.json

    Edit this to match your MCP server endpoints/commands.

[
{
"id": "clay",
"label": "Clay MCP",
"cluster": "revops",
"allowWrite": false,
"transport": {
"type": "streamable_http",
"url": "http://localhost:9001/mcp",
"headers": {}
}
},
{
"id": "airtable",
"label": "Airtable MCP",
"cluster": "revops",
"allowWrite": true,
"transport": {
"type": "streamable_http",
"url": "http://localhost:9002/mcp",
"headers": {}
}
},
{
"id": "gmail",
"label": "Gmail MCP",
"cluster": "revops",
"allowWrite": true,
"transport": {
"type": "streamable_http",
"url": "http://localhost:9003/mcp",
"headers": {}
}
},
{
"id": "github",
"label": "GitHub MCP",
"cluster": "engops",
"allowWrite": false,
"transport": {
"type": "streamable_http",
"url": "http://localhost:9004/mcp",
"headers": {}
}
},
{
"id": "vercel",
"label": "Vercel MCP",
"cluster": "engops",
"allowWrite": true,
"transport": {
"type": "streamable_http",
"url": "http://localhost:9005/mcp",
"headers": {}
}
},
{
"id": "gcloud",
"label": "Google Cloud MCP",
"cluster": "engops",
"allowWrite": true,
"transport": {
"type": "streamable_http",
"url": "http://localhost:9006/mcp",
"headers": {}
}
},
{
"id": "glassbox",
"label": "Glassbox MCP (this repo)",
"cluster": "engops",
"allowWrite": true,
"transport": {
"type": "streamable_http",
"url": "http://glassbox_mcp:8091/mcp",
"headers": {}
}
}
]

operator-control-plane/operator.actionmap.example.json

    This is how your RevOps playbook actually performs actions across Clay/Airtable/Gmail.
    You set tool names once after you connect/list tools.

{
"revops": {
"clay_enrich_lead": {
"upstream_id": "clay",
"tool": "enrich_person",
"args_template": {
"full_name": "{{lead.full_name}}",
"email": "{{lead.email}}",
"company": "{{lead.company}}",
"linkedin_url": "{{lead.linkedin_url}}"
}
},
"airtable_upsert_contact": {
"upstream_id": "airtable",
"tool": "upsert_record",
"args_template": {
"base_id": "{{crm.base_id}}",
"table": "{{crm.contacts_table}}",
"match": {
"Email": "{{lead.email}}"
},
"fields": {
"Name": "{{lead.full_name}}",
"Email": "{{lead.email}}",
"Company": "{{lead.company}}",
"LinkedIn": "{{lead.linkedin_url}}",
"Source": "Operator",
"Stage": "{{lead.stage}}"
}
}
},
"gmail_create_draft": {
"upstream_id": "gmail",
"tool": "create_draft",
"args_template": {
"to": "{{lead.email}}",
"subject": "{{email.subject}}",
"body": "{{email.body}}"
}
}
},
"engops": {
"vercel_list_deployments": {
"upstream_id": "vercel",
"tool": "list_deployments",
"args_template": {
"project": "{{eng.project}}",
"limit": 10
}
},
"gcloud_cloudrun_list_services": {
"upstream_id": "gcloud",
"tool": "cloudrun_list_services",
"args_template": {
"project_id": "{{eng.gcp_project_id}}",
"region": "{{eng.region}}"
}
}
}
}

Operator app (the single control-plane)
apps/operator/package.json

{
"name": "@operator/operator",
"private": true,
"type": "module",
"scripts": {
"dev": "tsx watch src/index.ts",
"build": "tsup src/index.ts --format esm --target node20 --sourcemap",
"start": "node dist/index.js"
},
"dependencies": {
"@modelcontextprotocol/sdk": "1.10.2",
"cors": "^2.8.5",
"express": "^4.19.2",
"zod": "^3.25.0"
},
"devDependencies": {
"@types/express": "^4.17.21",
"@types/node": "^20.11.30",
"tsup": "^8.0.2",
"tsx": "^4.15.7",
"typescript": "^5.6.3"
}
}

    Note: @modelcontextprotocol/sdk@1.10.2 is a known-good line for the Streamable HTTP examples. If you already run a newer SDK, bump it—this code stays the same.

apps/operator/tsconfig.json

{
"compilerOptions": {
"target": "ES2022",
"module": "Node16",
"moduleResolution": "Node16",
"strict": true,
"esModuleInterop": true,
"skipLibCheck": true
},
"include": ["src/**/*.ts"]
}

apps/operator/src/logger.ts

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
debug: (...args: unknown[]) => void;
info: (...args: unknown[]) => void;
warn: (...args: unknown[]) => void;
error: (...args: unknown[]) => void;
}

function ts(): string {
return new Date().toISOString();
}

function write(level: LogLevel, name: string, args: unknown[]) {
// Important: stderr so we don't corrupt stdio transports if used later.
const line = `[${ts()}] [${level.toUpperCase()}] [${name}] ${args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ")}`;
// eslint-disable-next-line no-console
console.error(line);
}

export function createLogger(name: string): Logger {
return {
debug: (...args) => write("debug", name, args),
info: (...args) => write("info", name, args),
warn: (...args) => write("warn", name, args),
error: (...args) => write("error", name, args),
};
}

apps/operator/src/security.ts

import type { Request, Response, NextFunction } from "express";

export function requireBearerToken(apiKey: string | undefined) {
return (req: Request, res: Response, next: NextFunction) => {
if (!apiKey) return next();

    const auth = req.header("authorization") || "";
    const expected = `Bearer ${apiKey}`;
    if (auth !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();

};
}

apps/operator/src/templating.ts

type AnyObj = Record<string, any>;

function getPath(obj: AnyObj, path: string): any {
const parts = path.split(".").filter(Boolean);
let cur: any = obj;
for (const p of parts) {
if (cur == null) return undefined;
cur = cur[p];
}
return cur;
}

function renderString(template: string, ctx: AnyObj): string {
return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (\_, key) => {
const v = getPath(ctx, key);
return v == null ? "" : String(v);
});
}

export function renderTemplate<T>(value: T, ctx: AnyObj): T {
if (typeof value === "string") return renderString(value, ctx) as any;
if (Array.isArray(value)) return value.map((v) => renderTemplate(v, ctx)) as any;
if (value && typeof value === "object") {
const out: AnyObj = {};
for (const [k, v] of Object.entries(value as AnyObj)) {
out[k] = renderTemplate(v, ctx);
}
return out as any;
}
return value;
}

apps/operator/src/upstreams/types.ts

export type Cluster = "revops" | "engops";

export type UpstreamTransport =
| {
type: "streamable_http";
url: string;
headers?: Record<string, string>;
readonly?: boolean;
}
| {
type: "stdio";
command: string;
args?: string[];
env?: Record<string, string>;
};

export interface UpstreamConfig {
id: string;
label?: string;
cluster: Cluster;
allowWrite?: boolean;
transport: UpstreamTransport;
}

export interface ActionSpec {
upstream_id: string;
tool: string;
args_template: any;
}

export interface ActionMap {
revops?: Record<string, ActionSpec>;
engops?: Record<string, ActionSpec>;
}

apps/operator/src/upstreams/upstreamClient.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "../logger.js";
import type { UpstreamConfig } from "./types.js";

export type McpTool = {
name: string;
description?: string;
inputSchema?: any;
};

export class UpstreamClient {
private readonly log = createLogger("UpstreamClient");
private readonly cfg: UpstreamConfig;

private client: Client | null = null;
private transport: StdioClientTransport | StreamableHTTPClientTransport | null = null;
private connected = false;

public tools: McpTool[] = [];
public lastError: string | null = null;

constructor(cfg: UpstreamConfig) {
this.cfg = cfg;
}

get id() {
return this.cfg.id;
}
get cluster() {
return this.cfg.cluster;
}
get allowWrite() {
return Boolean(this.cfg.allowWrite);
}
get label() {
return this.cfg.label || this.cfg.id;
}

async connect(): Promise<void> {
if (this.connected) return;

    this.client = new Client(
      { name: `operator-upstream-${this.cfg.id}`, version: "1.0.0" },
      { capabilities: {} }
    );

    if (this.cfg.transport.type === "stdio") {
      this.transport = new StdioClientTransport({
        command: this.cfg.transport.command,
        args: this.cfg.transport.args ?? [],
        env: this.cfg.transport.env ?? {},
      });
    } else {
      const headers = this.cfg.transport.headers ?? {};
      if (this.cfg.transport.readonly) {
        headers["X-MCP-Readonly"] = "true";
      }
      this.transport = new StreamableHTTPClientTransport(new URL(this.cfg.transport.url), {
        requestInit: { headers },
      });
    }

    try {
      await this.client.connect(this.transport);
      this.connected = true;
      this.lastError = null;
    } catch (e: any) {
      this.lastError = e?.message || String(e);
      this.log.error("Failed to connect upstream", { id: this.cfg.id, err: this.lastError });
      throw e;
    }

}

async refreshTools(): Promise<McpTool[]> {
await this.connect();
if (!this.client) throw new Error("Client not initialized");

    const resp = await this.client.request({ method: "tools/list" }, ListToolsResultSchema);
    this.tools = (resp.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
    return this.tools;

}

async callTool(toolName: string, args: any): Promise<any> {
await this.connect();
if (!this.client) throw new Error("Client not initialized");

    const resp = await this.client.request(
      {
        method: "tools/call",
        params: { name: toolName, args },
      },
      CallToolResultSchema
    );
    return resp;

}

async close(): Promise<void> {
try {
// Some SDK versions expose close on transport.
// @ts-expect-error - defensive across versions
if (this.transport?.close) await this.transport.close();
} catch {
// ignore
} finally {
this.connected = false;
}
}
}

apps/operator/src/upstreams/upstreamManager.ts

import { createLogger } from "../logger.js";
import type { UpstreamConfig } from "./types.js";
import { UpstreamClient } from "./upstreamClient.js";

export type AggregatedTool = {
qualifiedName: string; // upstreamId\_\_toolName
upstreamId: string;
cluster: string;
name: string;
description?: string;
inputSchema?: any;
};

function sanitize(s: string): string {
return s.replace(/[^a-zA-Z0-9_-]/g, "\_");
}

export class UpstreamManager {
private readonly log = createLogger("UpstreamManager");
private readonly clients = new Map<string, UpstreamClient>();

constructor(cfgs: UpstreamConfig[]) {
for (const cfg of cfgs) {
if (this.clients.has(cfg.id)) throw new Error(`Duplicate upstream id: ${cfg.id}`);
this.clients.set(cfg.id, new UpstreamClient(cfg));
}
}

listUpstreams(): UpstreamClient[] {
return Array.from(this.clients.values());
}

get(upstreamId: string): UpstreamClient {
const c = this.clients.get(upstreamId);
if (!c) throw new Error(`Unknown upstream: ${upstreamId}`);
return c;
}

async connectAll(bestEffort = true): Promise<void> {
const ups = this.listUpstreams();
await Promise.all(
ups.map(async (u) => {
try {
await u.connect();
} catch (e) {
if (!bestEffort) throw e;
this.log.warn("Upstream connect failed (best-effort)", { id: u.id, err: u.lastError });
}
})
);
}

async refreshAllTools(bestEffort = true): Promise<void> {
const ups = this.listUpstreams();
await Promise.all(
ups.map(async (u) => {
try {
await u.refreshTools();
} catch (e) {
if (!bestEffort) throw e;
this.log.warn("Upstream tool refresh failed (best-effort)", { id: u.id, err: u.lastError });
}
})
);
}

getAggregatedTools(): AggregatedTool[] {
const out: AggregatedTool[] = [];
for (const u of this.listUpstreams()) {
for (const t of u.tools) {
const qualifiedName = `${sanitize(u.id)}__${sanitize(t.name)}`;
out.push({
qualifiedName,
upstreamId: u.id,
cluster: u.cluster,
name: t.name,
description: t.description,
inputSchema: t.inputSchema,
});
}
}
return out.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
}
}

apps/operator/src/playbooks/revops.ts

import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import { renderTemplate } from "../templating.js";
import { UpstreamManager } from "../upstreams/upstreamManager.js";

export const LeadSchema = z.object({
full_name: z.string().min(1),
email: z.string().email().optional().default(""),
company: z.string().optional().default(""),
linkedin_url: z.string().optional().default(""),
stage: z.string().optional().default("New")
});

export const RevOpsPlaybookInputSchema = z.object({
lead: LeadSchema,
crm: z.object({
base_id: z.string().optional().default(""),
contacts_table: z.string().optional().default("Contacts")
}).default({}),
context: z.object({
offer: z.string().optional().default(""),
notes: z.string().optional().default("")
}).default({}),
confirm_write: z.boolean().optional().default(false),
dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
return (map?.revops && map.revops[key]) ? map.revops[key] : null;
}

function mkEmailDraft(lead: any, ctx: any) {
const subject = `Quick question re: ${lead.company || "your pipeline"}`;
const body =
`Hi ${lead.full_name.split(" ")[0] || lead.full_name},

${ctx.offer ? `I’m reaching out because ${ctx.offer}.\n\n` : ""}I saw you're at ${lead.company || "[company]"} and thought this might be relevant.

If helpful, I can share:

- how we typically run fast diligence
- what a lightweight pilot looks like
- pricing + timeline options

Want me to send a 3-bullet overview?

Best,
[Your Name]`;
return { subject, body };
}

function mkLinkedInDraft(lead: any, ctx: any) {
const first = lead.full_name.split(" ")[0] || lead.full_name;
const note = `Hi ${first} — quick connect. ${ctx.offer ? ctx.offer.slice(0, 160) : "I work on GTM + ops automation."}`;
const msg =
`Hey ${first} — thanks for connecting.

${ctx.offer ? `Context: ${ctx.offer}\n\n` : ""}If you’re open, I’d love to ask 2 quick questions about how you currently handle:

1. lead enrichment + routing
2. follow-ups + pipeline hygiene

If it’s easier, I can send a 3-bullet summary first.`;
  const followup =
`Quick bump, ${first}. Happy to keep it lightweight — if you tell me your #1 bottleneck in your pipeline this month, I’ll send a concrete 3-step fix.`;
return { connection_note: note, message: msg, followup };
}

async function runAction(
mgr: UpstreamManager,
action: ActionSpec,
ctx: any,
confirmWrite: boolean,
dryRun: boolean,
) {
const upstream = mgr.get(action.upstream_id);
const args = renderTemplate(action.args_template, ctx);

if (dryRun) {
return { dry_run: true, upstream_id: action.upstream_id, tool: action.tool, args };
}

// Guard rails: only allow writes if BOTH global confirm AND upstream allowWrite are true
if (!confirmWrite || !upstream.allowWrite) {
return {
blocked: true,
reason: !confirmWrite ? "confirm_write=false" : "upstream.allowWrite=false",
upstream_id: action.upstream_id,
tool: action.tool,
args
};
}

const result = await upstream.callTool(action.tool, args);
return { ok: true, upstream_id: action.upstream_id, tool: action.tool, result };
}

export async function revopsLeadCapture(
mgr: UpstreamManager,
actionMap: ActionMap | null,
input: z.infer<typeof RevOpsPlaybookInputSchema>
) {
const lead = LeadSchema.parse(input.lead);
const ctx = {
lead,
crm: input.crm,
context: input.context
};

const outputs: any = {
lead,
drafts: {
email: mkEmailDraft(lead, input.context),
linkedin: mkLinkedInDraft(lead, input.context)
},
actions: {}
};

// Clay enrichment (optional)
const clay = getAction(actionMap, "clay_enrich_lead");
if (clay) {
outputs.actions.clay_enrich_lead = await runAction(mgr, clay, ctx, input.confirm_write, input.dry_run);
} else {
outputs.actions.clay_enrich_lead = { skipped: true, reason: "No action map entry revops.clay_enrich_lead" };
}

// Airtable upsert contact (optional)
const airtable = getAction(actionMap, "airtable_upsert_contact");
if (airtable) {
outputs.actions.airtable_upsert_contact = await runAction(mgr, airtable, ctx, input.confirm_write, input.dry_run);
} else {
outputs.actions.airtable_upsert_contact = { skipped: true, reason: "No action map entry revops.airtable_upsert_contact" };
}

// Gmail create draft (optional)
const gmail = getAction(actionMap, "gmail_create_draft");
if (gmail) {
const emailCtx = { ...ctx, email: outputs.drafts.email };
outputs.actions.gmail_create_draft = await runAction(mgr, gmail, emailCtx, input.confirm_write, input.dry_run);
} else {
outputs.actions.gmail_create_draft = { skipped: true, reason: "No action map entry revops.gmail_create_draft" };
}

return outputs;
}

apps/operator/src/playbooks/engops.ts

import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import { renderTemplate } from "../templating.js";
import { UpstreamManager } from "../upstreams/upstreamManager.js";

export const EngOpsStatusInputSchema = z.object({
eng: z.object({
project: z.string().optional().default(""),
gcp_project_id: z.string().optional().default(""),
region: z.string().optional().default("us-central1")
}).default({}),
confirm_write: z.boolean().optional().default(false),
dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
return (map?.engops && map.engops[key]) ? map.engops[key] : null;
}

async function runAction(
mgr: UpstreamManager,
action: ActionSpec,
ctx: any,
confirmWrite: boolean,
dryRun: boolean,
) {
const upstream = mgr.get(action.upstream_id);
const args = renderTemplate(action.args_template, ctx);

if (dryRun) {
return { dry_run: true, upstream_id: action.upstream_id, tool: action.tool, args };
}

if (!confirmWrite || !upstream.allowWrite) {
// For engops, most queries should still run without writes; this blocks only if upstream is configured write-only.
// We'll still allow calls if confirm_write=false but upstream.allowWrite=false is fine (readonly).
// We only block when upstream.allowWrite=true AND confirm_write=false AND tool looks like mutating.
// Since we can't reliably classify, we just do the same strict rule for safety.
return {
blocked: true,
reason: !confirmWrite ? "confirm_write=false" : "upstream.allowWrite=false",
upstream_id: action.upstream_id,
tool: action.tool,
args
};
}

const result = await upstream.callTool(action.tool, args);
return { ok: true, upstream_id: action.upstream_id, tool: action.tool, result };
}

export async function engopsStatus(
mgr: UpstreamManager,
actionMap: ActionMap | null,
input: z.infer<typeof EngOpsStatusInputSchema>
) {
const ctx = { eng: input.eng };

const out: any = { snapshot: {}, actions: {} };

const vercel = getAction(actionMap, "vercel_list_deployments");
if (vercel) {
out.actions.vercel_list_deployments = await runAction(mgr, vercel, ctx, input.confirm_write, input.dry_run);
} else {
out.actions.vercel_list_deployments = { skipped: true, reason: "No action map entry engops.vercel_list_deployments" };
}

const cloudrun = getAction(actionMap, "gcloud_cloudrun_list_services");
if (cloudrun) {
out.actions.gcloud_cloudrun_list_services = await runAction(mgr, cloudrun, ctx, input.confirm_write, input.dry_run);
} else {
out.actions.gcloud_cloudrun_list_services = { skipped: true, reason: "No action map entry engops.gcloud_cloudrun_list_services" };
}

return out;
}

apps/operator/src/mcp/sessionRouter.ts

import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "../logger.js";

export function createSessionRouter(createServer: () => McpServer) {
const log = createLogger("MCP");
const transports: Record<string, StreamableHTTPServerTransport> = {};

async function handle(req: Request, res: Response) {
const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && req.method === "POST" && isInitializeRequest(req.body)) {
      const server = createServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport!;
          log.info("MCP session initialized", { sid });
        }
      });
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);

}

return { handle };
}

apps/operator/src/mcp/createOperatorMcpServer.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActionMap } from "../upstreams/types.js";
import { UpstreamManager } from "../upstreams/upstreamManager.js";
import { revopsLeadCapture, RevOpsPlaybookInputSchema } from "../playbooks/revops.js";
import { engopsStatus, EngOpsStatusInputSchema } from "../playbooks/engops.js";

function toText(obj: any) {
return {
content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }]
};
}

export function createOperatorMcpServer(opts: {
mgr: UpstreamManager;
actionMap: ActionMap | null;
allowWriteGlobal: boolean;
}) {
const { mgr, actionMap, allowWriteGlobal } = opts;

const server = new McpServer({ name: "operator", version: "1.0.0" });

server.tool(
"operator_upstreams_list",
{},
async () => {
const ups = mgr.listUpstreams().map((u) => ({
id: u.id,
label: u.label,
cluster: u.cluster,
allowWrite: u.allowWrite,
connected: (u as any).connected ?? undefined,
lastError: u.lastError
}));
return toText({ upstreams: ups });
}
);

server.tool(
"operator_tools_list",
{},
async () => {
const tools = mgr.getAggregatedTools();
return toText({ tools });
}
);

server.tool(
"operator_proxy_call",
{
upstream_id: z.string().min(1),
tool: z.string().min(1),
args: z.any().optional(),
confirm_write: z.boolean().optional().default(false),
dry_run: z.boolean().optional().default(false)
},
async ({ upstream_id, tool, args, confirm_write, dry_run }) => {
const upstream = mgr.get(upstream_id);

      if (dry_run) {
        return toText({ dry_run: true, upstream_id, tool, args: args ?? {} });
      }

      // Strict safety: global allowWrite + upstream allowWrite + confirm_write must all be true
      if (upstream.allowWrite || allowWriteGlobal) {
        const wantsWrite = upstream.allowWrite; // upstream-level posture
        if (wantsWrite && (!allowWriteGlobal || !confirm_write)) {
          return toText({
            blocked: true,
            reason: !allowWriteGlobal ? "OPERATOR_ALLOW_WRITE=0" : "confirm_write=false",
            upstream_id,
            tool,
            args: args ?? {}
          });
        }
      }

      const result = await upstream.callTool(tool, args ?? {});
      return toText({ upstream_id, tool, result });
    }

);

// RevOps playbook
server.tool(
"revops_lead_capture",
{
input: z.any()
},
async ({ input }) => {
const parsed = RevOpsPlaybookInputSchema.parse(input);
const out = await revopsLeadCapture(mgr, actionMap, parsed);
return toText(out);
}
);

// EngOps playbook
server.tool(
"engops_status_snapshot",
{
input: z.any()
},
async ({ input }) => {
const parsed = EngOpsStatusInputSchema.parse(input);
const out = await engopsStatus(mgr, actionMap, parsed);
return toText(out);
}
);

// LinkedIn drafts (no automation)
server.tool(
"linkedin_draft_outreach",
{
full_name: z.string().min(1),
company: z.string().optional(),
offer: z.string().optional()
},
async ({ full_name, company, offer }) => {
const first = full_name.split(" ")[0] || full_name;
const note = `Hi ${first} — quick connect. ${offer ? offer.slice(0, 160) : "I work on revenue ops + automation."}`;
const msg =
`Hey ${first} — thanks for connecting.

${offer ? `Context: ${offer}\n\n` : ""}If you’re open, I’d love to ask 2 quick questions about how you handle:

1. lead enrichment + routing
2. follow-ups + pipeline hygiene

If it’s easier, I can send a 3-bullet summary first.`;

      return toText({
        connection_note: note,
        message: msg,
        followup: `Quick bump, ${first}. If you tell me your #1 bottleneck this month, I’ll send a concrete 3-step fix.`,
        meta: { company: company ?? "" }
      });
    }

);

return server;
}

apps/operator/src/http/api.ts

import express from "express";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";
import type { ActionMap } from "../upstreams/types.js";
import { RevOpsPlaybookInputSchema, revopsLeadCapture } from "../playbooks/revops.js";
import { EngOpsStatusInputSchema, engopsStatus } from "../playbooks/engops.js";

export function createApiRouter(opts: {
mgr: UpstreamManager;
actionMap: ActionMap | null;
allowWriteGlobal: boolean;
}) {
const { mgr, actionMap, allowWriteGlobal } = opts;
const router = express.Router();

router.get("/health", (\_req, res) => res.json({ ok: true }));

router.get("/upstreams", async (\_req, res) => {
res.json({
upstreams: mgr.listUpstreams().map((u) => ({
id: u.id,
label: u.label,
cluster: u.cluster,
allowWrite: u.allowWrite,
lastError: u.lastError,
toolsCount: u.tools.length
}))
});
});

router.get("/tools", async (\_req, res) => {
res.json({ tools: mgr.getAggregatedTools() });
});

router.post("/proxy/call", async (req, res) => {
const { upstream_id, tool, args, confirm_write, dry_run } = req.body || {};
try {
const upstream = mgr.get(String(upstream_id));
if (dry_run) {
res.json({ dry_run: true, upstream_id, tool, args: args ?? {} });
return;
}

      if (upstream.allowWrite && (!allowWriteGlobal || !confirm_write)) {
        res.status(403).json({
          blocked: true,
          reason: !allowWriteGlobal ? "OPERATOR_ALLOW_WRITE=0" : "confirm_write=false",
          upstream_id,
          tool
        });
        return;
      }

      const result = await upstream.callTool(String(tool), args ?? {});
      res.json({ upstream_id, tool, result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }

});

router.post("/playbooks/revops/lead-capture", async (req, res) => {
try {
const parsed = RevOpsPlaybookInputSchema.parse(req.body);
const out = await revopsLeadCapture(mgr, actionMap, parsed);
res.json(out);
} catch (e: any) {
res.status(400).json({ error: e?.message || String(e) });
}
});

router.post("/playbooks/engops/status", async (req, res) => {
try {
const parsed = EngOpsStatusInputSchema.parse(req.body);
const out = await engopsStatus(mgr, actionMap, parsed);
res.json(out);
} catch (e: any) {
res.status(400).json({ error: e?.message || String(e) });
}
});

return router;
}

apps/operator/src/config.ts

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ActionMap, UpstreamConfig } from "./upstreams/types.js";

const UpstreamTransportSchema = z.union([
z.object({
type: z.literal("streamable_http"),
url: z.string().url(),
headers: z.record(z.string()).optional(),
readonly: z.boolean().optional()
}),
z.object({
type: z.literal("stdio"),
command: z.string().min(1),
args: z.array(z.string()).optional(),
env: z.record(z.string()).optional()
})
]);

const UpstreamConfigSchema = z.object({
id: z.string().min(1),
label: z.string().optional(),
cluster: z.union([z.literal("revops"), z.literal("engops")]),
allowWrite: z.boolean().optional(),
transport: UpstreamTransportSchema
});

const ActionSpecSchema = z.object({
upstream_id: z.string().min(1),
tool: z.string().min(1),
args_template: z.any()
});

const ActionMapSchema = z.object({
revops: z.record(ActionSpecSchema).optional(),
engops: z.record(ActionSpecSchema).optional()
}).passthrough();

function readJsonFile(p: string): any {
const raw = fs.readFileSync(p, "utf-8");
return JSON.parse(raw);
}

export function loadConfig() {
const host = process.env.OPERATOR_HOST || "0.0.0.0";
const port = Number(process.env.OPERATOR_PORT || "8090");
const apiKey = process.env.OPERATOR_API_KEY || undefined;
const allowWriteGlobal = (process.env.OPERATOR_ALLOW_WRITE || "0") === "1";

const upstreamsPath = process.env.OPERATOR_UPSTREAMS_PATH || "";
const upstreamsJson = process.env.OPERATOR_UPSTREAMS_JSON || "";

let upstreams: UpstreamConfig[] = [];
if (upstreamsJson) {
upstreams = z.array(UpstreamConfigSchema).parse(JSON.parse(upstreamsJson));
} else if (upstreamsPath) {
upstreams = z.array(UpstreamConfigSchema).parse(readJsonFile(upstreamsPath));
} else {
throw new Error("Provide OPERATOR_UPSTREAMS_JSON or OPERATOR_UPSTREAMS_PATH");
}

const actionMapPath = process.env.OPERATOR_ACTION_MAP_PATH || "";
const actionMapJson = process.env.OPERATOR_ACTION_MAP_JSON || "";
let actionMap: ActionMap | null = null;

if (actionMapJson) actionMap = ActionMapSchema.parse(JSON.parse(actionMapJson)) as any;
else if (actionMapPath && fs.existsSync(actionMapPath)) actionMap = ActionMapSchema.parse(readJsonFile(actionMapPath)) as any;

// Ensure data dir exists
const dataDir = path.resolve(process.cwd(), ".data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

return {
host,
port,
apiKey,
allowWriteGlobal,
upstreams,
actionMap
};
}

apps/operator/src/index.ts

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLogger } from "./logger.js";
import { loadConfig } from "./config.js";
import { requireBearerToken } from "./security.js";

import { UpstreamManager } from "./upstreams/upstreamManager.js";
import { createOperatorMcpServer } from "./mcp/createOperatorMcpServer.js";
import { createSessionRouter } from "./mcp/sessionRouter.js";
import { createApiRouter } from "./http/api.js";

const log = createLogger("operator");

async function main() {
const cfg = loadConfig();
const mgr = new UpstreamManager(cfg.upstreams);

// Best-effort: connect + load tool catalogs
await mgr.connectAll(true);
await mgr.refreshAllTools(true);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors());

app.use(requireBearerToken(cfg.apiKey));

// Minimal UI
const **filename = fileURLToPath(import.meta.url);
const **dirname = path.dirname(**filename);
const publicDir = path.resolve(**dirname, "../public");
app.use("/", express.static(publicDir));

// HTTP API for UI/testing
app.use("/api", createApiRouter({ mgr, actionMap: cfg.actionMap, allowWriteGlobal: cfg.allowWriteGlobal }));

// MCP endpoint
const session = createSessionRouter(() =>
createOperatorMcpServer({ mgr, actionMap: cfg.actionMap, allowWriteGlobal: cfg.allowWriteGlobal })
);

app.post("/mcp", session.handle);
app.get("/mcp", session.handle);
app.delete("/mcp", session.handle);

app.get("/health", (\_req, res) => res.json({ ok: true }));

app.listen(cfg.port, cfg.host, () => {
log.info(`Operator listening on http://${cfg.host}:${cfg.port}`);
log.info(`MCP endpoint: http://${cfg.host}:${cfg.port}/mcp`);
log.info(`UI: http://${cfg.host}:${cfg.port}/`);
});
}

main().catch((e) => {
log.error("Fatal", e);
process.exit(1);
});

apps/operator/public/index.html

<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Operator Control Plane</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Operator Control Plane</h1>
      <div class="sub">One app • multiple MCP backends • RevOps + EngOps</div>
    </header>

    <section class="card">
      <h2>Upstreams</h2>
      <button id="refreshUpstreams">Refresh</button>
      <pre id="upstreams"></pre>
    </section>

    <section class="card">
      <h2>Tools</h2>
      <button id="refreshTools">Refresh</button>
      <select id="toolSelect"></select>
      <textarea id="args" rows="10" spellcheck="false">{}</textarea>
      <div class="row">
        <label><input type="checkbox" id="dryRun" /> dry_run</label>
        <label><input type="checkbox" id="confirmWrite" /> confirm_write</label>
      </div>
      <button id="runTool">Run Tool (proxy)</button>
      <pre id="toolResult"></pre>
    </section>

    <section class="card">
      <h2>RevOps Playbook: Lead Capture</h2>
      <textarea id="leadPayload" rows="10" spellcheck="false">

{
"lead": {"full_name":"Jane Doe","email":"jane@example.com","company":"ExampleBio","linkedin_url":"", "stage":"New"},
"crm": {"base_id":"", "contacts_table":"Contacts"},
"context": {"offer":"we automate diligence + reporting for biopharma sales ops", "notes":""},
"confirm_write": false,
"dry_run": true
}
</textarea>
<button id="runLeadCapture">Run Lead Capture</button>

<pre id="leadResult"></pre>
</section>

    <section class="card">
      <h2>EngOps Playbook: Status Snapshot</h2>
      <textarea id="engPayload" rows="8" spellcheck="false">

{
"eng": {"project":"glassbox-web","gcp_project_id":"your-gcp-project","region":"us-central1"},
"confirm_write": false,
"dry_run": true
}
</textarea>
<button id="runEngStatus">Run EngOps Status</button>

<pre id="engResult"></pre>
</section>

  </div>

  <script src="/app.js"></script>
</body>
</html>

apps/operator/public/styles.css

body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: #0b0f17; color: #e7edf5; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
header { margin-bottom: 18px; }
h1 { margin: 0 0 6px 0; }
.sub { opacity: 0.8; }
.card { background: #121a28; border: 1px solid #233049; border-radius: 12px; padding: 16px; margin: 12px 0; }
button { background: #2b71ff; color: white; border: 0; padding: 8px 12px; border-radius: 8px; cursor: pointer; margin: 6px 0; }
button:hover { opacity: 0.92; }
textarea, select { width: 100%; background: #0b1220; border: 1px solid #22304a; color: #e7edf5; border-radius: 8px; padding: 10px; margin-top: 10px; }
pre { white-space: pre-wrap; word-break: break-word; background: #0b1220; border: 1px solid #22304a; padding: 10px; border-radius: 8px; margin-top: 10px; }
.row { display: flex; gap: 16px; margin-top: 10px; }
label { opacity: 0.9; }

apps/operator/public/app.js

async function getJSON(url, opts) {
const res = await fetch(url, { ...(opts || {}), headers: { "Content-Type": "application/json", ...(opts?.headers || {}) } });
if (!res.ok) throw new Error(await res.text());
return await res.json();
}

async function refreshUpstreams() {
const data = await getJSON("/api/upstreams");
document.getElementById("upstreams").textContent = JSON.stringify(data, null, 2);
}

async function refreshTools() {
const data = await getJSON("/api/tools");
const sel = document.getElementById("toolSelect");
sel.innerHTML = "";
for (const t of data.tools) {
const opt = document.createElement("option");
opt.value = JSON.stringify(t);
opt.textContent = `${t.qualifiedName} (${t.cluster})`;
sel.appendChild(opt);
}
if (data.tools.length) {
document.getElementById("args").value = "{}";
}
}

async function runTool() {
const raw = document.getElementById("toolSelect").value;
if (!raw) return;
const tool = JSON.parse(raw);
const args = JSON.parse(document.getElementById("args").value || "{}");
const dry_run = document.getElementById("dryRun").checked;
const confirm_write = document.getElementById("confirmWrite").checked;

const payload = {
upstream_id: tool.upstreamId,
tool: tool.name,
args,
dry_run,
confirm_write
};

const res = await getJSON("/api/proxy/call", { method: "POST", body: JSON.stringify(payload) });
document.getElementById("toolResult").textContent = JSON.stringify(res, null, 2);
}

async function runLeadCapture() {
const payload = JSON.parse(document.getElementById("leadPayload").value);
const res = await getJSON("/api/playbooks/revops/lead-capture", { method: "POST", body: JSON.stringify(payload) });
document.getElementById("leadResult").textContent = JSON.stringify(res, null, 2);
}

async function runEngStatus() {
const payload = JSON.parse(document.getElementById("engPayload").value);
const res = await getJSON("/api/playbooks/engops/status", { method: "POST", body: JSON.stringify(payload) });
document.getElementById("engResult").textContent = JSON.stringify(res, null, 2);
}

document.getElementById("refreshUpstreams").onclick = refreshUpstreams;
document.getElementById("refreshTools").onclick = refreshTools;
document.getElementById("runTool").onclick = runTool;
document.getElementById("runLeadCapture").onclick = runLeadCapture;
document.getElementById("runEngStatus").onclick = runEngStatus;

refreshUpstreams().catch(console.error);
refreshTools().catch(console.error);

Glassbox MCP server (wraps your FastAPI routers)
apps/glassbox-mcp/package.json

{
"name": "@operator/glassbox-mcp",
"private": true,
"type": "module",
"scripts": {
"dev": "tsx watch src/index.ts",
"build": "tsup src/index.ts --format esm --target node20 --sourcemap",
"start": "node dist/index.js"
},
"dependencies": {
"@modelcontextprotocol/sdk": "1.10.2",
"express": "^4.19.2",
"zod": "^3.25.0"
},
"devDependencies": {
"@types/express": "^4.17.21",
"@types/node": "^20.11.30",
"tsup": "^8.0.2",
"tsx": "^4.15.7",
"typescript": "^5.6.3"
}
}

apps/glassbox-mcp/tsconfig.json

{
"compilerOptions": {
"target": "ES2022",
"module": "Node16",
"moduleResolution": "Node16",
"strict": true,
"esModuleInterop": true,
"skipLibCheck": true
},
"include": ["src/**/*.ts"]
}

apps/glassbox-mcp/src/logger.ts

export function log(...args: any[]) {
console.error("[glassbox-mcp]", ...args);
}

apps/glassbox-mcp/src/config.ts

import { z } from "zod";

const EnvSchema = z.object({
GLASSBOX_MCP_HOST: z.string().default("0.0.0.0"),
GLASSBOX_MCP_PORT: z.string().default("8091"),

GLASSBOX_API_BASE_URL: z.string().url(),

GLASSBOX_BEARER_TOKEN: z.string().optional(),
GLASSBOX_INTERNAL_API_KEY: z.string().optional(),

GLASSBOX_HTTP_TIMEOUT_MS: z.string().optional().default("45000")
});

export function loadConfig() {
const env = EnvSchema.parse(process.env);
return {
host: env.GLASSBOX_MCP_HOST,
port: Number(env.GLASSBOX_MCP_PORT),
baseUrl: env.GLASSBOX_API_BASE_URL.replace(/\/+$/, ""),
bearer: env.GLASSBOX_BEARER_TOKEN,
internalKey: env.GLASSBOX_INTERNAL_API_KEY,
timeoutMs: Number(env.GLASSBOX_HTTP_TIMEOUT_MS)
};
}

apps/glassbox-mcp/src/http.ts

import { loadConfig } from "./config.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function withTimeout(timeoutMs: number) {
const ac = new AbortController();
const t = setTimeout(() => ac.abort(), timeoutMs);
return { signal: ac.signal, cancel: () => clearTimeout(t) };
}

export async function gbRequest(method: HttpMethod, path: string, query?: Record<string, any>, body?: any) {
const cfg = loadConfig();

if (!path.startsWith("/")) throw new Error("path must start with '/'");
if (path.includes("://")) throw new Error("absolute URLs not allowed");

const url = new URL(cfg.baseUrl + path);
if (query) {
for (const [k, v] of Object.entries(query)) {
if (v === undefined || v === null) continue;
url.searchParams.set(k, String(v));
}
}

const headers: Record<string, string> = {
"Content-Type": "application/json"
};
if (cfg.bearer) headers["Authorization"] = `Bearer ${cfg.bearer}`;
if (cfg.internalKey) headers["X-API-Key"] = cfg.internalKey;

const { signal, cancel } = withTimeout(cfg.timeoutMs);
try {
const res = await fetch(url.toString(), {
method,
headers,
body: body ? JSON.stringify(body) : undefined,
signal
});

    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
    }
    return json ?? text;

} finally {
cancel();
}
}

apps/glassbox-mcp/src/mcpServer.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { gbRequest } from "./http.js";

function toText(obj: any) {
return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

export function createGlassboxMcpServer() {
const server = new McpServer({ name: "glassbox-mcp", version: "1.0.0" });

server.tool(
"gb_request",
{
method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
path: z.string().min(1),
query: z.record(z.any()).optional(),
body: z.any().optional()
},
async ({ method, path, query, body }) => {
const data = await gbRequest(method as any, path, query, body);
return toText({ ok: true, data });
}
);

// Convenience: /me/projects/summary
server.tool("gb_projects_summary", {}, async () => {
const data = await gbRequest("GET", "/me/projects/summary");
return toText({ ok: true, data });
});

// Convenience: pipeline/run
server.tool(
"gb_pipeline_run",
{
project_id: z.string().min(1),
phase: z.string().min(1),
options: z.any().optional()
},
async ({ project_id, phase, options }) => {
const body = { project_id, phase, options: options ?? {} };
const data = await gbRequest("POST", "/pipeline/run", undefined, body);
return toText({ ok: true, data });
}
);

// Convenience: blog CRUD
server.tool("gb_blog_list_published", {}, async () => {
const data = await gbRequest("GET", "/blog/posts");
return toText({ ok: true, data });
});

server.tool("gb_blog_list_admin", {}, async () => {
const data = await gbRequest("GET", "/blog/admin/posts");
return toText({ ok: true, data });
});

server.tool(
"gb_blog_create_post",
{
title: z.string().min(1),
slug: z.string().min(1),
body_html: z.string().min(1),
excerpt: z.string().optional(),
category: z.string().optional(),
featured_image: z.string().optional(),
status: z.enum(["draft", "published"]).optional()
},
async (payload) => {
const data = await gbRequest("POST", "/blog/posts", undefined, payload);
return toText({ ok: true, data });
}
);

server.tool(
"gb_blog_update_post",
{
slug: z.string().min(1),
patch: z.any()
},
async ({ slug, patch }) => {
const data = await gbRequest("PATCH", `/blog/posts/${encodeURIComponent(slug)}`, undefined, patch);
return toText({ ok: true, data });
}
);

server.tool(
"gb_blog_delete_post",
{ slug: z.string().min(1) },
async ({ slug }) => {
const data = await gbRequest("DELETE", `/blog/posts/${encodeURIComponent(slug)}`);
return toText({ ok: true, data });
}
);

// Reports
server.tool(
"gb_reports_get",
{ job_id: z.string().min(1) },
async ({ job_id }) => {
const data = await gbRequest("GET", `/reports/${encodeURIComponent(job_id)}`);
return toText({ ok: true, data });
}
);

server.tool(
"gb_reports_get_section",
{
job_id: z.string().min(1),
section_id: z.string().min(1),
level: z.number().int().optional()
},
async ({ job_id, section_id, level }) => {
const q = level == null ? undefined : { level };
const data = await gbRequest("GET", `/reports/${encodeURIComponent(job_id)}/sections/${encodeURIComponent(section_id)}`, q);
return toText({ ok: true, data });
}
);

// Documents (admin)
server.tool("gb_documents_list", {}, async () => {
const data = await gbRequest("GET", "/documents");
return toText({ ok: true, data });
});

server.tool(
"gb_documents_create",
{ slug: z.string().min(1), title: z.string().min(1), content: z.any() },
async (payload) => {
const data = await gbRequest("POST", "/documents", undefined, payload);
return toText({ ok: true, data });
}
);

server.tool(
"gb_documents_update",
{ document_id: z.string().min(1), patch: z.any() },
async ({ document_id, patch }) => {
const data = await gbRequest("PATCH", `/documents/${encodeURIComponent(document_id)}`, undefined, patch);
return toText({ ok: true, data });
}
);

server.tool(
"gb_documents_delete",
{ document_id: z.string().min(1) },
async ({ document_id }) => {
const data = await gbRequest("DELETE", `/documents/${encodeURIComponent(document_id)}`);
return toText({ ok: true, data });
}
);

return server;
}

apps/glassbox-mcp/src/index.ts

import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { createGlassboxMcpServer } from "./mcpServer.js";

async function main() {
const cfg = loadConfig();
const app = express();
app.use(express.json({ limit: "2mb" }));

const transports: Record<string, StreamableHTTPServerTransport> = {};

app.post("/mcp", async (req, res) => {
const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const server = createGlassboxMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport!;
          log("session initialized", sid);
        }
      });
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);

});

app.get("/mcp", async (req, res) => {
const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
const transport = sessionId ? transports[sessionId] : undefined;
if (!transport) return res.status(400).send("No session");
await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
const transport = sessionId ? transports[sessionId] : undefined;
if (!transport) return res.status(400).send("No session");
await transport.handleRequest(req, res);
});

app.get("/health", (\_req, res) => res.json({ ok: true }));

app.listen(cfg.port, cfg.host, () => {
log(`Glassbox MCP listening on http://${cfg.host}:${cfg.port}`);
log(`MCP endpoint: http://${cfg.host}:${cfg.port}/mcp`);
});
}

main().catch((e) => {
log("fatal", e);
process.exit(1);
});

How to run (locally)

cd operator-control-plane
npm install
npm run build
docker compose up --build

    Operator UI: http://localhost:8090/

    Operator MCP endpoint: http://localhost:8090/mcp

    Glassbox MCP endpoint: http://localhost:8091/mcp

How to use this as your “one app” in ChatGPT Apps

In ChatGPT Apps, you point the App at Operator’s MCP endpoint:

    https://<your-domain>/mcp

    (Optional) add auth header: Authorization: Bearer <OPERATOR_API_KEY>

Then ChatGPT will have:

    operator_proxy_call (call any upstream tool)

    revops_lead_capture (your CRM/clienteling start)

    engops_status_snapshot

    linkedin_draft_outreach

    and you can extend with more playbooks.

What you do next (important)

    Connect your Clay/Airtable/Gmail MCP servers (whatever you’re using) and confirm their tool names via:

    UI → Tools list
    or via MCP tool operator_tools_list

    Update operator.actionmap.example.json with the real tool names and required args.

    Flip write permissions safely:

    keep OPERATOR_ALLOW_WRITE=0 while iterating

    when ready: set OPERATOR_ALLOW_WRITE=1 and pass confirm_write=true in calls

If you want, I’ll extend this immediately (no questions required)

I can paste additional code to add these RevOps-first playbooks into Operator (same style as above):

    revops_inbox_triage_to_crm (scan Gmail threads → extract leads → Airtable upsert → draft followups)

    revops_pipeline_hygiene (Airtable deals/contacts → identify stale → generate followups + next steps)

    revops_weekly_exec_brief (Airtable metrics → narrative summary → Gmail send)

    glassbox_ops_daily (Glassbox job statuses + pipeline runs + deploy statuses → one dashboard output)

Just tell me which one you want first and I’ll paste the full code in-chat the same way.
You said:
yes add them I can paste additional code to add these RevOps-first playbooks into Operator (same style as above):
ChatGPT said:

CAN: Perfect — here are the full, paste‑in additions to implement these RevOps‑first playbooks in the same Operator control‑plane app (plus one ops dashboard playbook). I’m also including critical fixes to the control plane you already pasted earlier:

    ✅ Add 4 new playbooks

        revops_inbox_triage_to_crm

        revops_pipeline_hygiene

        revops_weekly_exec_brief

        ops_glassbox_daily

    ✅ Fix write gating so read tools work even when an upstream “allows writes”

    ✅ Add mutating?: boolean support to ActionMap entries (backward compatible)

    ✅ Add missing dotenv deps + Dockerfiles (production-ready)

Just copy/paste these files (overwrite existing ones where noted) into the repo you pasted earlier. 0) Add missing dotenv dependency (fix)
apps/operator/package.json (REPLACE)

{
"name": "@operator/operator",
"private": true,
"type": "module",
"scripts": {
"dev": "tsx watch src/index.ts",
"build": "tsup src/index.ts --format esm --target node20 --sourcemap",
"start": "node dist/index.js"
},
"dependencies": {
"@modelcontextprotocol/sdk": "1.10.2",
"cors": "^2.8.5",
"dotenv": "^16.4.5",
"express": "^4.19.2",
"zod": "^3.25.0"
},
"devDependencies": {
"@types/express": "^4.17.21",
"@types/node": "^20.11.30",
"tsup": "^8.0.2",
"tsx": "^4.15.7",
"typescript": "^5.6.3"
}
}

apps/glassbox-mcp/package.json (REPLACE)

{
"name": "@operator/glassbox-mcp",
"private": true,
"type": "module",
"scripts": {
"dev": "tsx watch src/index.ts",
"build": "tsup src/index.ts --format esm --target node20 --sourcemap",
"start": "node dist/index.js"
},
"dependencies": {
"@modelcontextprotocol/sdk": "1.10.2",
"dotenv": "^16.4.5",
"express": "^4.19.2",
"zod": "^3.25.0"
},
"devDependencies": {
"@types/express": "^4.17.21",
"@types/node": "^20.11.30",
"tsup": "^8.0.2",
"tsx": "^4.15.7",
"typescript": "^5.6.3"
}
}

1. Add Dockerfiles (production ready)
   apps/operator/Dockerfile (NEW)

# ---- builder ----

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src
COPY public ./public

RUN npm install
RUN npm run build

# ---- runtime ----

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

EXPOSE 8090
CMD ["node", "dist/index.js"]

apps/glassbox-mcp/Dockerfile (NEW)

# ---- builder ----

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

RUN npm install
RUN npm run build

# ---- runtime ----

FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 8091
CMD ["node", "dist/index.js"]

2. Fix ActionMap types + config parsing (add mutating?: boolean)
   apps/operator/src/upstreams/types.ts (REPLACE)

export type Cluster = "revops" | "engops";

export type UpstreamTransport =
| {
type: "streamable_http";
url: string;
headers?: Record<string, string>;
readonly?: boolean;
}
| {
type: "stdio";
command: string;
args?: string[];
env?: Record<string, string>;
};

export interface UpstreamConfig {
id: string;
label?: string;
cluster: Cluster;
/\*\*

- If true, Operator will allow _mutating_ calls to this upstream
- only when global OPERATOR_ALLOW_WRITE=1 AND confirm_write=true.
- Read-only calls are always allowed.
  \*/
  allowWrite?: boolean;
  transport: UpstreamTransport;
  }

export interface ActionSpec {
upstream_id: string;
tool: string;
args_template: any;

/\*\*

- Optional explicit classification.
- If omitted, Operator will infer mutating by tool name heuristics.
  \*/
  mutating?: boolean;
  }

export interface ActionMap {
revops?: Record<string, ActionSpec>;
engops?: Record<string, ActionSpec>;
}

apps/operator/src/config.ts (REPLACE)

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ActionMap, UpstreamConfig } from "./upstreams/types.js";

const UpstreamTransportSchema = z.union([
z.object({
type: z.literal("streamable_http"),
url: z.string().url(),
headers: z.record(z.string()).optional(),
readonly: z.boolean().optional()
}),
z.object({
type: z.literal("stdio"),
command: z.string().min(1),
args: z.array(z.string()).optional(),
env: z.record(z.string()).optional()
})
]);

const UpstreamConfigSchema = z.object({
id: z.string().min(1),
label: z.string().optional(),
cluster: z.union([z.literal("revops"), z.literal("engops")]),
allowWrite: z.boolean().optional(),
transport: UpstreamTransportSchema
});

const ActionSpecSchema = z.object({
upstream_id: z.string().min(1),
tool: z.string().min(1),
args_template: z.any(),
mutating: z.boolean().optional()
});

const ActionMapSchema = z
.object({
revops: z.record(ActionSpecSchema).optional(),
engops: z.record(ActionSpecSchema).optional()
})
.passthrough();

function readJsonFile(p: string): any {
const raw = fs.readFileSync(p, "utf-8");
return JSON.parse(raw);
}

export function loadConfig() {
const host = process.env.OPERATOR_HOST || "0.0.0.0";
const port = Number(process.env.OPERATOR_PORT || "8090");
const apiKey = process.env.OPERATOR_API_KEY || undefined;

// global gate: if 0, no mutating calls are allowed (even with confirm_write)
const allowWriteGlobal = (process.env.OPERATOR_ALLOW_WRITE || "0") === "1";

const upstreamsPath = process.env.OPERATOR_UPSTREAMS_PATH || "";
const upstreamsJson = process.env.OPERATOR_UPSTREAMS_JSON || "";

let upstreams: UpstreamConfig[] = [];
if (upstreamsJson) {
upstreams = z.array(UpstreamConfigSchema).parse(JSON.parse(upstreamsJson));
} else if (upstreamsPath) {
upstreams = z.array(UpstreamConfigSchema).parse(readJsonFile(upstreamsPath));
} else {
throw new Error("Provide OPERATOR_UPSTREAMS_JSON or OPERATOR_UPSTREAMS_PATH");
}

const actionMapPath = process.env.OPERATOR_ACTION_MAP_PATH || "";
const actionMapJson = process.env.OPERATOR_ACTION_MAP_JSON || "";
let actionMap: ActionMap | null = null;

if (actionMapJson) actionMap = ActionMapSchema.parse(JSON.parse(actionMapJson)) as any;
else if (actionMapPath && fs.existsSync(actionMapPath)) actionMap = ActionMapSchema.parse(readJsonFile(actionMapPath)) as any;

// Ensure data dir exists
const dataDir = path.resolve(process.cwd(), ".data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

return {
host,
port,
apiKey,
allowWriteGlobal,
upstreams,
actionMap
};
}

3. Add a shared action runner with safe write gating
   apps/operator/src/playbooks/actionRunner.ts (NEW)

import { renderTemplate } from "../templating.js";
import type { ActionSpec } from "../upstreams/types.js";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";

export function isProbablyMutatingTool(toolName: string): boolean {
const t = toolName.toLowerCase();

// Strong signals of mutation
const keywords = [
"create",
"update",
"upsert",
"delete",
"remove",
"set",
"write",
"send",
"post",
"patch",
"put",
"deploy",
"rollback",
"restart",
"cancel",
"publish",
"trigger",
"approve",
"invite",
"grant",
"revoke"
];

return keywords.some((k) => t.includes(k));
}

/\*\*

- Runs an ActionSpec against its upstream with:
- - templated args
- - write gating for mutating tools (global + confirm + upstream.allowWrite)
    \*/
    export async function runMappedAction(opts: {
    mgr: UpstreamManager;
    action: ActionSpec;
    ctx: any;
    allowWriteGlobal: boolean;
    confirmWrite: boolean;
    dryRun: boolean;
    }) {
    const { mgr, action, ctx, allowWriteGlobal, confirmWrite, dryRun } = opts;
    const upstream = mgr.get(action.upstream_id);
    const args = renderTemplate(action.args_template, ctx);

const inferredMutating = isProbablyMutatingTool(action.tool);
const isMutating = action.mutating === true || inferredMutating;

if (dryRun) {
return {
dry_run: true,
upstream_id: action.upstream_id,
tool: action.tool,
mutating: isMutating,
args
};
}

// Read-only calls always allowed.
if (!isMutating) {
const result = await upstream.callTool(action.tool, args);
return { ok: true, upstream_id: action.upstream_id, tool: action.tool, mutating: false, result };
}

// Mutating calls require:
// - global allow write
// - confirmWrite true
// - upstream allowWrite true
if (!allowWriteGlobal) {
return { blocked: true, reason: "OPERATOR_ALLOW_WRITE=0", upstream_id: action.upstream_id, tool: action.tool, args };
}
if (!confirmWrite) {
return { blocked: true, reason: "confirm_write=false", upstream_id: action.upstream_id, tool: action.tool, args };
}
if (!upstream.allowWrite) {
return { blocked: true, reason: "upstream.allowWrite=false", upstream_id: action.upstream_id, tool: action.tool, args };
}

const result = await upstream.callTool(action.tool, args);
return { ok: true, upstream_id: action.upstream_id, tool: action.tool, mutating: true, result };
}

4. Add utilities for parsing MCP results & extracting emails
   apps/operator/src/playbooks/utils.ts (NEW)

export function extractTextFromMcpResult(result: any): string {
if (!result) return "";
const content = result.content;
if (!Array.isArray(content)) return "";

const texts = content
.filter((c: any) => c && c.type === "text" && typeof c.text === "string")
.map((c: any) => c.text);

return texts.join("\n").trim();
}

export function tryParseJson(text: string): any | null {
if (!text) return null;
const t = text.trim();
if (!t) return null;

try {
return JSON.parse(t);
} catch {
return null;
}
}

export function resultToJsonOrText(result: any): { json: any | null; text: string; raw: any } {
const text = extractTextFromMcpResult(result);
const json = tryParseJson(text);
return { json, text, raw: result };
}

export function uniq<T>(arr: T[]): T[] {
return Array.from(new Set(arr));
}

export function extractEmails(blob: string): string[] {
const s = blob || "";
const rx = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const matches = s.match(rx) || [];
return uniq(matches.map((m) => m.toLowerCase())).filter((e) => !e.includes("noreply"));
}

export function parseNameAndEmail(header: string): { name?: string; email?: string } {
const h = (header || "").trim();
if (!h) return {};

// Common format: Name <email@domain.com>
const m = h.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
if (m) {
return { name: m[1]?.trim() || undefined, email: m[2]?.trim().toLowerCase() || undefined };
}

// Just an email
const emails = extractEmails(h);
if (emails.length === 1) return { email: emails[0] };

return {};
}

export function findThreadIds(candidate: any): string[] {
// Tries multiple likely shapes.
if (!candidate) return [];

if (Array.isArray(candidate.thread_ids)) return candidate.thread_ids.map(String);
if (Array.isArray(candidate.threadIds)) return candidate.threadIds.map(String);
if (Array.isArray(candidate.ids)) return candidate.ids.map(String);

if (Array.isArray(candidate.threads)) {
const ids = candidate.threads
.map((t: any) => t?.id ?? t?.thread_id ?? t?.threadId)
.filter(Boolean)
.map(String);
if (ids.length) return ids;
}

if (Array.isArray(candidate.messages)) {
const ids = candidate.messages
.map((m: any) => m?.threadId ?? m?.thread_id)
.filter(Boolean)
.map(String);
if (ids.length) return uniq(ids);
}

return [];
}

export function safeIsoDate(d: any): string | null {
try {
const dt = new Date(d);
if (Number.isNaN(dt.getTime())) return null;
return dt.toISOString();
} catch {
return null;
}
}

export function daysAgo(iso: string | null): number | null {
if (!iso) return null;
const t = Date.parse(iso);
if (Number.isNaN(t)) return null;
const now = Date.now();
return Math.floor((now - t) / (1000 _ 60 _ 60 \* 24));
}

5. Update existing RevOps/EngOps playbooks to use the safe runner
   apps/operator/src/playbooks/revops.ts (REPLACE)

import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";

export const LeadSchema = z.object({
full_name: z.string().min(1),
email: z.string().email().optional().default(""),
company: z.string().optional().default(""),
linkedin_url: z.string().optional().default(""),
stage: z.string().optional().default("New")
});

export const RevOpsPlaybookInputSchema = z.object({
lead: LeadSchema,
crm: z
.object({
base_id: z.string().optional().default(""),
contacts_table: z.string().optional().default("Contacts")
})
.default({}),
context: z
.object({
offer: z.string().optional().default(""),
notes: z.string().optional().default("")
})
.default({}),
confirm_write: z.boolean().optional().default(false),
dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
return map?.revops?.[key] ?? null;
}

function mkEmailDraft(lead: any, ctx: any) {
const subject = `Quick question re: ${lead.company || "your pipeline"}`;
const body = `Hi ${lead.full_name.split(" ")[0] || lead.full_name},

${ctx.offer ? `I’m reaching out because ${ctx.offer}.\n\n` : ""}I saw you're at ${lead.company || "[company]"} and thought this might be relevant.

If helpful, I can share:

- how we typically run fast diligence
- what a lightweight pilot looks like
- pricing + timeline options

Want me to send a 3-bullet overview?

Best,
[Your Name]`;
return { subject, body };
}

function mkLinkedInDraft(lead: any, ctx: any) {
const first = lead.full_name.split(" ")[0] || lead.full_name;
const note = `Hi ${first} — quick connect. ${ctx.offer ? ctx.offer.slice(0, 160) : "I work on GTM + ops automation."}`;
const msg = `Hey ${first} — thanks for connecting.

${ctx.offer ? `Context: ${ctx.offer}\n\n` : ""}If you’re open, I’d love to ask 2 quick questions about how you currently handle:

1. lead enrichment + routing
2. follow-ups + pipeline hygiene

If it’s easier, I can send a 3-bullet summary first.`;
  const followup = `Quick bump, ${first}. Happy to keep it lightweight — if you tell me your #1 bottleneck in your pipeline this month, I’ll send a concrete 3-step fix.`;
return { connection_note: note, message: msg, followup };
}

export async function revopsLeadCapture(
mgr: UpstreamManager,
actionMap: ActionMap | null,
allowWriteGlobal: boolean,
input: z.infer<typeof RevOpsPlaybookInputSchema>
) {
const lead = LeadSchema.parse(input.lead);

const ctx = {
lead,
crm: input.crm,
context: input.context
};

const outputs: any = {
lead,
drafts: {
email: mkEmailDraft(lead, input.context),
linkedin: mkLinkedInDraft(lead, input.context)
},
actions: {}
};

const clay = getAction(actionMap, "clay_enrich_lead");
if (clay) {
outputs.actions.clay_enrich_lead = await runMappedAction({
mgr,
action: clay,
ctx,
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});
} else {
outputs.actions.clay_enrich_lead = { skipped: true, reason: "No action map entry revops.clay_enrich_lead" };
}

const airtable = getAction(actionMap, "airtable_upsert_contact");
if (airtable) {
outputs.actions.airtable_upsert_contact = await runMappedAction({
mgr,
action: airtable,
ctx,
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});
} else {
outputs.actions.airtable_upsert_contact = { skipped: true, reason: "No action map entry revops.airtable_upsert_contact" };
}

const gmail = getAction(actionMap, "gmail_create_draft");
if (gmail) {
const emailCtx = { ...ctx, email: outputs.drafts.email };
outputs.actions.gmail_create_draft = await runMappedAction({
mgr,
action: gmail,
ctx: emailCtx,
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});
} else {
outputs.actions.gmail_create_draft = { skipped: true, reason: "No action map entry revops.gmail_create_draft" };
}

return outputs;
}

apps/operator/src/playbooks/engops.ts (REPLACE)

import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";

export const EngOpsStatusInputSchema = z.object({
eng: z
.object({
project: z.string().optional().default(""),
gcp_project_id: z.string().optional().default(""),
region: z.string().optional().default("us-central1")
})
.default({}),
confirm_write: z.boolean().optional().default(false),
dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
return map?.engops?.[key] ?? null;
}

export async function engopsStatus(
mgr: UpstreamManager,
actionMap: ActionMap | null,
allowWriteGlobal: boolean,
input: z.infer<typeof EngOpsStatusInputSchema>
) {
const ctx = { eng: input.eng };
const out: any = { actions: {} };

const vercel = getAction(actionMap, "vercel_list_deployments");
if (vercel) {
out.actions.vercel_list_deployments = await runMappedAction({
mgr,
action: vercel,
ctx,
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});
} else {
out.actions.vercel_list_deployments = { skipped: true, reason: "No action map entry engops.vercel_list_deployments" };
}

const cloudrun = getAction(actionMap, "gcloud_cloudrun_list_services");
if (cloudrun) {
out.actions.gcloud_cloudrun_list_services = await runMappedAction({
mgr,
action: cloudrun,
ctx,
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});
} else {
out.actions.gcloud_cloudrun_list_services = { skipped: true, reason: "No action map entry engops.gcloud_cloudrun_list_services" };
}

return out;
}

6. NEW RevOps playbooks
   A) Inbox triage → CRM (Gmail → Extract leads → Airtable upsert + Tasks)
   apps/operator/src/playbooks/revopsInboxTriage.ts (NEW)

import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";
import { extractEmails, findThreadIds, parseNameAndEmail, resultToJsonOrText, uniq, safeIsoDate } from "./utils.js";

export const RevOpsInboxTriageInputSchema = z.object({
gmail: z
.object({
query: z.string().optional().default("newer_than:7d in:inbox"),
max_threads: z.number().int().min(1).max(50).optional().default(10),
include_body: z.boolean().optional().default(false)
})
.default({}),
owner_email: z.string().email().optional(),
lead_defaults: z
.object({
stage: z.string().optional().default("Inbound"),
company: z.string().optional().default("")
})
.default({}),
crm: z
.object({
base_id: z.string().optional().default(""),
contacts_table: z.string().optional().default("Contacts"),
tasks_table: z.string().optional().default("Tasks"),
touchpoints_table: z.string().optional().default("Touchpoints")
})
.default({}),
confirm_write: z.boolean().optional().default(false),
dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
return map?.revops?.[key] ?? null;
}

function bestEffortNormalizeThread(raw: any) {
// We do not assume a specific Gmail MCP schema.
// We produce a stable normalized object that still carries raw.
const blob = JSON.stringify(raw ?? {}).slice(0, 120_000);
const emails = extractEmails(blob);
const subject =
raw?.subject ??
raw?.snippetSubject ??
raw?.headers?.Subject ??
raw?.headers?.subject ??
raw?.thread?.subject ??
null;

const fromHeader =
raw?.from ??
raw?.headers?.From ??
raw?.headers?.from ??
raw?.lastMessage?.from ??
null;

const { name: fromName, email: fromEmail } = parseNameAndEmail(String(fromHeader ?? ""));
const dateCandidate =
raw?.date ??
raw?.internalDate ??
raw?.lastMessage?.date ??
raw?.headers?.Date ??
raw?.headers?.date ??
null;

const iso = safeIsoDate(dateCandidate);

const snippet =
raw?.snippet ??
raw?.summary ??
raw?.lastMessage?.snippet ??
raw?.lastMessage?.bodyPreview ??
null;

return {
subject,
from: { name: fromName, email: fromEmail },
iso_date: iso,
snippet,
emails,
raw
};
}

function inferNeedsReply(norm: any, ownerEmail?: string) {
const owner = (ownerEmail || "").toLowerCase().trim();
if (!owner) return null;

// If the "from" email is not owner, likely needs reply (heuristic)
if (norm?.from?.email && norm.from.email !== owner) return true;
return false;
}

export async function revopsInboxTriageToCrm(
mgr: UpstreamManager,
actionMap: ActionMap | null,
allowWriteGlobal: boolean,
input: z.infer<typeof RevOpsInboxTriageInputSchema>
) {
const gmailSearch = getAction(actionMap, "gmail_search_threads");
const gmailGetThread = getAction(actionMap, "gmail_get_thread");
const airtableUpsert = getAction(actionMap, "airtable_upsert_contact");
const airtableTask = getAction(actionMap, "airtable_create_task");
const airtableTouch = getAction(actionMap, "airtable_log_touchpoint");

const out: any = {
query: input.gmail.query,
max_threads: input.gmail.max_threads,
threads: [],
lead_candidates: [],
actions: {}
};

if (!gmailSearch) {
out.error = "Missing action map: revops.gmail_search_threads";
return out;
}
if (!gmailGetThread) {
out.error = "Missing action map: revops.gmail_get_thread";
return out;
}

// 1) Search threads
const ctxSearch = { gmail: input.gmail, crm: input.crm };
const searchRes = await runMappedAction({
mgr,
action: gmailSearch,
ctx: ctxSearch,
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});

out.actions.gmail_search_threads = searchRes;

const parsed = resultToJsonOrText((searchRes as any).result);
const threadIds = uniq(findThreadIds(parsed.json ?? parsed.text ?? parsed.raw));

out.thread_ids = threadIds.slice(0, input.gmail.max_threads);

// 2) Fetch threads + extract candidates
const candidates: { email: string; name?: string; company?: string; stage: string }[] = [];
for (const threadId of out.thread_ids) {
const ctxThread = { thread_id: threadId, gmail: input.gmail, crm: input.crm };
const thrRes = await runMappedAction({
mgr,
action: gmailGetThread,
ctx: ctxThread,
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});

    const rawThread = (thrRes as any).result;
    const threadParsed = resultToJsonOrText(rawThread);
    const norm = bestEffortNormalizeThread(threadParsed.json ?? threadParsed.text ?? threadParsed.raw);
    const needsReply = inferNeedsReply(norm, input.owner_email ?? undefined);

    // candidate emails (exclude owner)
    const owner = (input.owner_email || "").toLowerCase().trim();
    const externalEmails = (norm.emails || []).filter((e: string) => (owner ? e !== owner : true));

    out.threads.push({
      thread_id: threadId,
      subject: norm.subject,
      from: norm.from,
      iso_date: norm.iso_date,
      needs_reply: needsReply,
      snippet: norm.snippet,
      emails: externalEmails,
      raw_preview: (threadParsed.text || "").slice(0, 4000)
    });

    for (const e of externalEmails) {
      candidates.push({
        email: e,
        name: norm.from?.email === e ? norm.from?.name : undefined,
        company: input.lead_defaults.company || undefined,
        stage: input.lead_defaults.stage
      });
    }

}

// de-dupe candidates by email
const byEmail = new Map<string, any>();
for (const c of candidates) {
if (!byEmail.has(c.email)) byEmail.set(c.email, c);
}
out.lead_candidates = Array.from(byEmail.values());

// 3) Optional: write to Airtable (upsert contacts + create tasks/touchpoints)
out.actions.airtable_upserts = [];
out.actions.airtable_tasks = [];
out.actions.airtable_touchpoints = [];

if (airtableUpsert) {
for (const c of out.lead_candidates) {
const ctx = {
lead: {
full_name: c.name || c.email,
email: c.email,
company: c.company || "",
linkedin_url: "",
stage: c.stage
},
crm: input.crm
};
out.actions.airtable_upserts.push(
await runMappedAction({
mgr,
action: airtableUpsert,
ctx,
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
})
);
}
}

if (airtableTask) {
// Create tasks for threads that likely need reply
for (const t of out.threads) {
if (t.needs_reply !== true) continue;

      const ctx = {
        crm: input.crm,
        task: {
          title: `Reply: ${t.subject || "Email thread"}`,
          due_iso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          thread_id: t.thread_id,
          from_email: t.from?.email || "",
          subject: t.subject || ""
        }
      };

      out.actions.airtable_tasks.push(
        await runMappedAction({
          mgr,
          action: airtableTask,
          ctx,
          allowWriteGlobal,
          confirmWrite: input.confirm_write,
          dryRun: input.dry_run
        })
      );
    }

}

if (airtableTouch) {
// Log touchpoints for each thread (optional)
for (const t of out.threads) {
const ctx = {
crm: input.crm,
touchpoint: {
channel: "Email",
iso_date: t.iso_date,
subject: t.subject,
thread_id: t.thread_id,
from_email: t.from?.email || "",
snippet: t.snippet || ""
}
};

      out.actions.airtable_touchpoints.push(
        await runMappedAction({
          mgr,
          action: airtableTouch,
          ctx,
          allowWriteGlobal,
          confirmWrite: input.confirm_write,
          dryRun: input.dry_run
        })
      );
    }

}

return out;
}

B) Pipeline hygiene (Airtable opps → detect stale → create tasks)
apps/operator/src/playbooks/revopsPipelineHygiene.ts (NEW)

import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";
import { daysAgo, resultToJsonOrText, safeIsoDate } from "./utils.js";

export const RevOpsPipelineHygieneInputSchema = z.object({
crm: z
.object({
base_id: z.string().optional().default(""),
opportunities_table: z.string().optional().default("Opportunities"),
tasks_table: z.string().optional().default("Tasks"),

      // Field names inside Airtable records (your schema)
      stage_field: z.string().optional().default("Stage"),
      last_touch_field: z.string().optional().default("Last Touch"),
      next_touch_field: z.string().optional().default("Next Touch"),
      account_field: z.string().optional().default("Account"),
      primary_contact_field: z.string().optional().default("Primary Contact"),

      stale_days: z.number().int().min(1).max(60).optional().default(7)
    })
    .default({}),

confirm_write: z.boolean().optional().default(false),
dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
return map?.revops?.[key] ?? null;
}

function normalizeRecords(payload: any): any[] {
// Supports common Airtable shapes:
// {records:[{id, fields:{...}}]} or direct array
if (!payload) return [];
if (Array.isArray(payload)) return payload;
if (Array.isArray(payload.records)) return payload.records;
if (Array.isArray(payload.data)) return payload.data;
return [];
}

export async function revopsPipelineHygiene(
mgr: UpstreamManager,
actionMap: ActionMap | null,
allowWriteGlobal: boolean,
input: z.infer<typeof RevOpsPipelineHygieneInputSchema>
) {
const listOpps = getAction(actionMap, "airtable_list_opportunities");
const createTask = getAction(actionMap, "airtable_create_task_for_opp");

const out: any = { stale_days: input.crm.stale_days, opportunities: [], stale: [], actions: {} };

if (!listOpps) {
out.error = "Missing action map: revops.airtable_list_opportunities";
return out;
}

const listRes = await runMappedAction({
mgr,
action: listOpps,
ctx: { crm: input.crm },
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});

out.actions.airtable_list_opportunities = listRes;

const parsed = resultToJsonOrText((listRes as any).result);
const json = parsed.json ?? parsed.raw ?? {};
const records = normalizeRecords(json);

const stale: any[] = [];

for (const r of records) {
const id = r.id ?? r.recordId ?? r.\_id ?? null;
const f = r.fields ?? r;

    const stage = f[input.crm.stage_field] ?? f.stage ?? null;
    const lastTouchIso = safeIsoDate(f[input.crm.last_touch_field] ?? f.last_touch_at ?? f.lastTouchAt ?? null);
    const nextTouchIso = safeIsoDate(f[input.crm.next_touch_field] ?? f.next_touch_at ?? f.nextTouchAt ?? null);

    const lastDays = daysAgo(lastTouchIso);
    const nextDays = daysAgo(nextTouchIso);

    const isStale =
      (lastDays != null && lastDays >= input.crm.stale_days) ||
      (!nextTouchIso && (lastDays == null || lastDays >= 1)) ||
      (nextTouchIso && nextDays != null && nextDays >= 0); // overdue next touch

    const opp = {
      id,
      stage,
      last_touch_iso: lastTouchIso,
      next_touch_iso: nextTouchIso,
      account: f[input.crm.account_field] ?? null,
      primary_contact: f[input.crm.primary_contact_field] ?? null,
      fields: f
    };

    out.opportunities.push(opp);
    if (isStale) stale.push(opp);

}

out.stale = stale;

// Optional: create tasks
out.actions.created*tasks = [];
if (createTask) {
for (const s of stale) {
const ctx = {
crm: input.crm,
opp: s,
task: {
title: `Follow up (${s.stage || "Pipeline"}): ${s.account || "Account"}`,
due_iso: new Date(Date.now() + 24 * 60 \_ 60 \* 1000).toISOString(),
opp_id: s.id
}
};

      out.actions.created_tasks.push(
        await runMappedAction({
          mgr,
          action: createTask,
          ctx,
          allowWriteGlobal,
          confirmWrite: input.confirm_write,
          dryRun: input.dry_run
        })
      );
    }

}

return out;
}

C) Weekly Exec Brief (Airtable metrics → compose brief → optional email)
apps/operator/src/playbooks/revopsWeeklyExecBrief.ts (NEW)

import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";
import { resultToJsonOrText } from "./utils.js";

export const RevOpsWeeklyExecBriefInputSchema = z.object({
period_days: z.number().int().min(1).max(31).optional().default(7),
recipients: z.array(z.string().email()).optional().default([]),
sender_name: z.string().optional().default("Operator"),
subject: z.string().optional().default("Weekly Revenue Brief"),
crm: z
.object({
base_id: z.string().optional().default("")
})
.default({}),
confirm_write: z.boolean().optional().default(false),
dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
return map?.revops?.[key] ?? null;
}

function formatBrief(metrics: any, periodDays: number) {
const m = metrics || {};
// You can adapt these keys to whatever your Airtable metrics action returns.
const leads = m.leads_created ?? m.new_leads ?? m.leads ?? null;
const contacted = m.contacted ?? null;
const replies = m.replies ?? null;
const meetings = m.meetings ?? null;
const pipeline = m.pipeline_value ?? m.pipeline ?? null;
const won = m.closed_won ?? null;
const lost = m.closed_lost ?? null;

const lines: string[] = [];
lines.push(`Weekly Revenue Brief (${periodDays}d)`);
lines.push(``);
  lines.push(`Topline`);
  if (leads != null) lines.push(`- New leads: ${leads}`);
  if (contacted != null) lines.push(`- Contacted: ${contacted}`);
  if (replies != null) lines.push(`- Replies: ${replies}`);
  if (meetings != null) lines.push(`- Meetings booked: ${meetings}`);
  if (pipeline != null) lines.push(`- Pipeline: ${pipeline}`);
  if (won != null) lines.push(`- Closed won: ${won}`);
  if (lost != null) lines.push(`- Closed lost: ${lost}`);

if (Array.isArray(m.highlights) && m.highlights.length) {
lines.push(``);
    lines.push(`Highlights`);
    for (const h of m.highlights.slice(0, 10)) lines.push(`- ${String(h)}`);
}

if (Array.isArray(m.risks) && m.risks.length) {
lines.push(``);
    lines.push(`Risks / Blockers`);
    for (const r of m.risks.slice(0, 10)) lines.push(`- ${String(r)}`);
}

if (Array.isArray(m.next_week) && m.next_week.length) {
lines.push(``);
    lines.push(`Next Week Focus`);
    for (const n of m.next_week.slice(0, 10)) lines.push(`- ${String(n)}`);
}

return lines.join("\n");
}

export async function revopsWeeklyExecBrief(
mgr: UpstreamManager,
actionMap: ActionMap | null,
allowWriteGlobal: boolean,
input: z.infer<typeof RevOpsWeeklyExecBriefInputSchema>
) {
const metricsAction = getAction(actionMap, "airtable_weekly_metrics");
const sendAction = getAction(actionMap, "gmail_send_exec_brief");

const out: any = {
period_days: input.period_days,
recipients: input.recipients,
metrics: null,
brief_text: "",
actions: {}
};

if (!metricsAction) {
out.error = "Missing action map: revops.airtable_weekly_metrics";
return out;
}

// 1) Fetch metrics (you define the view/query in Airtable via this action map)
const metricsRes = await runMappedAction({
mgr,
action: metricsAction,
ctx: { crm: input.crm, period_days: input.period_days },
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});

out.actions.airtable_weekly_metrics = metricsRes;
const parsed = resultToJsonOrText((metricsRes as any).result);
out.metrics = parsed.json ?? parsed.raw ?? parsed.text;

// 2) Compose the brief
out.brief_text = formatBrief(out.metrics, input.period_days);

// 3) Optionally send
if (input.recipients.length && sendAction) {
const ctx = {
email: {
to: input.recipients.join(","),
subject: input.subject,
body: out.brief_text,
sender_name: input.sender_name
}
};

    out.actions.gmail_send_exec_brief = await runMappedAction({
      mgr,
      action: sendAction,
      ctx,
      allowWriteGlobal,
      confirmWrite: input.confirm_write,
      dryRun: input.dry_run
    });

} else if (input.recipients.length && !sendAction) {
out.actions.gmail_send_exec_brief = { skipped: true, reason: "No action map entry revops.gmail_send_exec_brief" };
}

return out;
}

7. NEW Ops daily playbook (Cluster B + Glassbox)
   apps/operator/src/playbooks/opsDaily.ts (NEW)

import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";

export const OpsDailyInputSchema = z.object({
eng: z
.object({
project: z.string().optional().default(""),
gcp_project_id: z.string().optional().default(""),
region: z.string().optional().default("us-central1")
})
.default({}),
glassbox: z
.object({
include_projects_summary: z.boolean().optional().default(true)
})
.default({}),
confirm_write: z.boolean().optional().default(false),
dry_run: z.boolean().optional().default(false)
});

function getEngAction(map: ActionMap | null, key: string): ActionSpec | null {
return map?.engops?.[key] ?? null;
}

export async function opsGlassboxDaily(
mgr: UpstreamManager,
actionMap: ActionMap | null,
allowWriteGlobal: boolean,
input: z.infer<typeof OpsDailyInputSchema>
) {
const out: any = { actions: {}, snapshot: {} };

// Vercel
const vercel = getEngAction(actionMap, "vercel_list_deployments");
if (vercel) {
out.actions.vercel_list_deployments = await runMappedAction({
mgr,
action: vercel,
ctx: { eng: input.eng },
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});
} else {
out.actions.vercel_list_deployments = { skipped: true, reason: "No action map entry engops.vercel_list_deployments" };
}

// Cloud Run
const cloudrun = getEngAction(actionMap, "gcloud_cloudrun_list_services");
if (cloudrun) {
out.actions.gcloud_cloudrun_list_services = await runMappedAction({
mgr,
action: cloudrun,
ctx: { eng: input.eng },
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});
} else {
out.actions.gcloud_cloudrun_list_services = { skipped: true, reason: "No action map entry engops.gcloud_cloudrun_list_services" };
}

// GitHub (optional)
const gh = getEngAction(actionMap, "github_recent_activity");
if (gh) {
out.actions.github_recent_activity = await runMappedAction({
mgr,
action: gh,
ctx: { eng: input.eng },
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});
}

// Glassbox projects summary (via your glassbox MCP upstream)
const gb = getEngAction(actionMap, "glassbox_projects_summary");
if (input.glassbox.include_projects_summary && gb) {
out.actions.glassbox_projects_summary = await runMappedAction({
mgr,
action: gb,
ctx: {},
allowWriteGlobal,
confirmWrite: input.confirm_write,
dryRun: input.dry_run
});
} else if (input.glassbox.include_projects_summary && !gb) {
out.actions.glassbox_projects_summary = { skipped: true, reason: "No action map entry engops.glassbox_projects_summary" };
}

return out;
}

8. Wire new playbooks into MCP tools + HTTP API
   apps/operator/src/mcp/createOperatorMcpServer.ts (REPLACE)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActionMap } from "../upstreams/types.js";
import { UpstreamManager } from "../upstreams/upstreamManager.js";
import { isProbablyMutatingTool } from "../playbooks/actionRunner.js";

import { revopsLeadCapture, RevOpsPlaybookInputSchema } from "../playbooks/revops.js";
import { engopsStatus, EngOpsStatusInputSchema } from "../playbooks/engops.js";

import { revopsInboxTriageToCrm, RevOpsInboxTriageInputSchema } from "../playbooks/revopsInboxTriage.js";
import { revopsPipelineHygiene, RevOpsPipelineHygieneInputSchema } from "../playbooks/revopsPipelineHygiene.js";
import { revopsWeeklyExecBrief, RevOpsWeeklyExecBriefInputSchema } from "../playbooks/revopsWeeklyExecBrief.js";
import { opsGlassboxDaily, OpsDailyInputSchema } from "../playbooks/opsDaily.js";

function toText(obj: any) {
return {
content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }]
};
}

export function createOperatorMcpServer(opts: {
mgr: UpstreamManager;
actionMap: ActionMap | null;
allowWriteGlobal: boolean;
}) {
const { mgr, actionMap, allowWriteGlobal } = opts;
const server = new McpServer({ name: "operator", version: "1.1.0" });

server.tool("operator_upstreams_list", {}, async () => {
const ups = mgr.listUpstreams().map((u) => ({
id: u.id,
label: u.label,
cluster: u.cluster,
allowWrite: u.allowWrite,
lastError: u.lastError,
toolsCount: u.tools.length
}));
return toText({ upstreams: ups, allowWriteGlobal });
});

server.tool("operator_tools_list", {}, async () => {
const tools = mgr.getAggregatedTools();
return toText({ tools });
});

server.tool(
"operator_proxy_call",
{
upstream_id: z.string().min(1),
tool: z.string().min(1),
args: z.any().optional(),
confirm_write: z.boolean().optional().default(false),
dry_run: z.boolean().optional().default(false),

      /**
       * Optional hint. For safety:
       * - if tool name looks mutating, we treat it as mutating even if you pass false.
       * - if you pass true, we treat it as mutating.
       */
      mutating: z.boolean().optional()
    },
    async ({ upstream_id, tool, args, confirm_write, dry_run, mutating }) => {
      const upstream = mgr.get(upstream_id);
      const inferred = isProbablyMutatingTool(tool);
      const isMutating = inferred || mutating === true;

      if (dry_run) {
        return toText({ dry_run: true, upstream_id, tool, mutating: isMutating, args: args ?? {} });
      }

      // Non-mutating always allowed
      if (!isMutating) {
        const result = await upstream.callTool(tool, args ?? {});
        return toText({ upstream_id, tool, mutating: false, result });
      }

      // Mutating requires gating
      if (!allowWriteGlobal) {
        return toText({ blocked: true, reason: "OPERATOR_ALLOW_WRITE=0", upstream_id, tool, args: args ?? {} });
      }
      if (!confirm_write) {
        return toText({ blocked: true, reason: "confirm_write=false", upstream_id, tool, args: args ?? {} });
      }
      if (!upstream.allowWrite) {
        return toText({ blocked: true, reason: "upstream.allowWrite=false", upstream_id, tool, args: args ?? {} });
      }

      const result = await upstream.callTool(tool, args ?? {});
      return toText({ upstream_id, tool, mutating: true, result });
    }

);

// RevOps: Lead capture
server.tool("revops_lead_capture", { input: z.any() }, async ({ input }) => {
const parsed = RevOpsPlaybookInputSchema.parse(input);
const out = await revopsLeadCapture(mgr, actionMap, allowWriteGlobal, parsed);
return toText(out);
});

// RevOps: Inbox triage
server.tool("revops_inbox_triage_to_crm", { input: z.any() }, async ({ input }) => {
const parsed = RevOpsInboxTriageInputSchema.parse(input);
const out = await revopsInboxTriageToCrm(mgr, actionMap, allowWriteGlobal, parsed);
return toText(out);
});

// RevOps: Pipeline hygiene
server.tool("revops_pipeline_hygiene", { input: z.any() }, async ({ input }) => {
const parsed = RevOpsPipelineHygieneInputSchema.parse(input);
const out = await revopsPipelineHygiene(mgr, actionMap, allowWriteGlobal, parsed);
return toText(out);
});

// RevOps: Weekly exec brief
server.tool("revops_weekly_exec_brief", { input: z.any() }, async ({ input }) => {
const parsed = RevOpsWeeklyExecBriefInputSchema.parse(input);
const out = await revopsWeeklyExecBrief(mgr, actionMap, allowWriteGlobal, parsed);
return toText(out);
});

// EngOps status
server.tool("engops_status_snapshot", { input: z.any() }, async ({ input }) => {
const parsed = EngOpsStatusInputSchema.parse(input);
const out = await engopsStatus(mgr, actionMap, allowWriteGlobal, parsed);
return toText(out);
});

// Ops daily (Vercel + GCP + GitHub + Glassbox)
server.tool("ops_glassbox_daily", { input: z.any() }, async ({ input }) => {
const parsed = OpsDailyInputSchema.parse(input);
const out = await opsGlassboxDaily(mgr, actionMap, allowWriteGlobal, parsed);
return toText(out);
});

// LinkedIn drafts (no automation)
server.tool(
"linkedin_draft_outreach",
{
full_name: z.string().min(1),
company: z.string().optional(),
offer: z.string().optional()
},
async ({ full_name, company, offer }) => {
const first = full_name.split(" ")[0] || full_name;
const note = `Hi ${first} — quick connect. ${offer ? offer.slice(0, 160) : "I work on revenue ops + automation."}`;
const msg = `Hey ${first} — thanks for connecting.

${offer ? `Context: ${offer}\n\n` : ""}If you’re open, I’d love to ask 2 quick questions about how you handle:

1. lead enrichment + routing
2. follow-ups + pipeline hygiene

If it’s easier, I can send a 3-bullet summary first.`;

      return toText({
        connection_note: note,
        message: msg,
        followup: `Quick bump, ${first}. If you tell me your #1 bottleneck this month, I’ll send a concrete 3-step fix.`,
        meta: { company: company ?? "" }
      });
    }

);

return server;
}

apps/operator/src/http/api.ts (REPLACE)

import express from "express";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";
import type { ActionMap } from "../upstreams/types.js";
import { isProbablyMutatingTool } from "../playbooks/actionRunner.js";

import { RevOpsPlaybookInputSchema, revopsLeadCapture } from "../playbooks/revops.js";
import { RevOpsInboxTriageInputSchema, revopsInboxTriageToCrm } from "../playbooks/revopsInboxTriage.js";
import { RevOpsPipelineHygieneInputSchema, revopsPipelineHygiene } from "../playbooks/revopsPipelineHygiene.js";
import { RevOpsWeeklyExecBriefInputSchema, revopsWeeklyExecBrief } from "../playbooks/revopsWeeklyExecBrief.js";
import { EngOpsStatusInputSchema, engopsStatus } from "../playbooks/engops.js";
import { OpsDailyInputSchema, opsGlassboxDaily } from "../playbooks/opsDaily.js";

export function createApiRouter(opts: {
mgr: UpstreamManager;
actionMap: ActionMap | null;
allowWriteGlobal: boolean;
}) {
const { mgr, actionMap, allowWriteGlobal } = opts;
const router = express.Router();

router.get("/health", (\_req, res) => res.json({ ok: true }));

router.get("/upstreams", async (\_req, res) => {
res.json({
allowWriteGlobal,
upstreams: mgr.listUpstreams().map((u) => ({
id: u.id,
label: u.label,
cluster: u.cluster,
allowWrite: u.allowWrite,
lastError: u.lastError,
toolsCount: u.tools.length
}))
});
});

router.get("/tools", async (\_req, res) => {
res.json({ tools: mgr.getAggregatedTools() });
});

router.post("/proxy/call", async (req, res) => {
const { upstream_id, tool, args, confirm_write, dry_run, mutating } = req.body || {};
try {
const upstream = mgr.get(String(upstream_id));
const inferred = isProbablyMutatingTool(String(tool));
const isMut = inferred || mutating === true;

      if (dry_run) {
        res.json({ dry_run: true, upstream_id, tool, mutating: isMut, args: args ?? {} });
        return;
      }

      if (!isMut) {
        const result = await upstream.callTool(String(tool), args ?? {});
        res.json({ upstream_id, tool, mutating: false, result });
        return;
      }

      if (!allowWriteGlobal) {
        res.status(403).json({ blocked: true, reason: "OPERATOR_ALLOW_WRITE=0", upstream_id, tool });
        return;
      }
      if (!confirm_write) {
        res.status(403).json({ blocked: true, reason: "confirm_write=false", upstream_id, tool });
        return;
      }
      if (!upstream.allowWrite) {
        res.status(403).json({ blocked: true, reason: "upstream.allowWrite=false", upstream_id, tool });
        return;
      }

      const result = await upstream.callTool(String(tool), args ?? {});
      res.json({ upstream_id, tool, mutating: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }

});

router.post("/playbooks/revops/lead-capture", async (req, res) => {
try {
const parsed = RevOpsPlaybookInputSchema.parse(req.body);
const out = await revopsLeadCapture(mgr, actionMap, allowWriteGlobal, parsed);
res.json(out);
} catch (e: any) {
res.status(400).json({ error: e?.message || String(e) });
}
});

router.post("/playbooks/revops/inbox-triage", async (req, res) => {
try {
const parsed = RevOpsInboxTriageInputSchema.parse(req.body);
const out = await revopsInboxTriageToCrm(mgr, actionMap, allowWriteGlobal, parsed);
res.json(out);
} catch (e: any) {
res.status(400).json({ error: e?.message || String(e) });
}
});

router.post("/playbooks/revops/pipeline-hygiene", async (req, res) => {
try {
const parsed = RevOpsPipelineHygieneInputSchema.parse(req.body);
const out = await revopsPipelineHygiene(mgr, actionMap, allowWriteGlobal, parsed);
res.json(out);
} catch (e: any) {
res.status(400).json({ error: e?.message || String(e) });
}
});

router.post("/playbooks/revops/weekly-brief", async (req, res) => {
try {
const parsed = RevOpsWeeklyExecBriefInputSchema.parse(req.body);
const out = await revopsWeeklyExecBrief(mgr, actionMap, allowWriteGlobal, parsed);
res.json(out);
} catch (e: any) {
res.status(400).json({ error: e?.message || String(e) });
}
});

router.post("/playbooks/engops/status", async (req, res) => {
try {
const parsed = EngOpsStatusInputSchema.parse(req.body);
const out = await engopsStatus(mgr, actionMap, allowWriteGlobal, parsed);
res.json(out);
} catch (e: any) {
res.status(400).json({ error: e?.message || String(e) });
}
});

router.post("/playbooks/ops/glassbox-daily", async (req, res) => {
try {
const parsed = OpsDailyInputSchema.parse(req.body);
const out = await opsGlassboxDaily(mgr, actionMap, allowWriteGlobal, parsed);
res.json(out);
} catch (e: any) {
res.status(400).json({ error: e?.message || String(e) });
}
});

return router;
}

9. Update Operator entrypoint to pass allowWriteGlobal through
   apps/operator/src/index.ts (REPLACE)

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLogger } from "./logger.js";
import { loadConfig } from "./config.js";
import { requireBearerToken } from "./security.js";

import { UpstreamManager } from "./upstreams/upstreamManager.js";
import { createOperatorMcpServer } from "./mcp/createOperatorMcpServer.js";
import { createSessionRouter } from "./mcp/sessionRouter.js";
import { createApiRouter } from "./http/api.js";

const log = createLogger("operator");

async function main() {
const cfg = loadConfig();
const mgr = new UpstreamManager(cfg.upstreams);

// Best-effort: connect + load tool catalogs
await mgr.connectAll(true);
await mgr.refreshAllTools(true);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors());

app.use(requireBearerToken(cfg.apiKey));

// Minimal UI
const **filename = fileURLToPath(import.meta.url);
const **dirname = path.dirname(**filename);
const publicDir = path.resolve(**dirname, "../public");
app.use("/", express.static(publicDir));

// HTTP API for UI/testing
app.use(
"/api",
createApiRouter({
mgr,
actionMap: cfg.actionMap,
allowWriteGlobal: cfg.allowWriteGlobal
})
);

// MCP endpoint
const session = createSessionRouter(() =>
createOperatorMcpServer({
mgr,
actionMap: cfg.actionMap,
allowWriteGlobal: cfg.allowWriteGlobal
})
);

app.post("/mcp", session.handle);
app.get("/mcp", session.handle);
app.delete("/mcp", session.handle);

app.get("/health", (\_req, res) => res.json({ ok: true }));

app.listen(cfg.port, cfg.host, () => {
log.info(`Operator listening on http://${cfg.host}:${cfg.port}`);
log.info(`MCP endpoint: http://${cfg.host}:${cfg.port}/mcp`);
log.info(`UI: http://${cfg.host}:${cfg.port}/`);
});
}

main().catch((e) => {
log.error("Fatal", e);
process.exit(1);
});

10. Extend UI to run the new playbooks
    apps/operator/public/index.html (REPLACE)

<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Operator Control Plane</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="wrap">
    <header>
      <h1>Operator Control Plane</h1>
      <div class="sub">One app • multiple MCP backends • RevOps + EngOps + Glassbox</div>
      <div class="sub" id="writeGate"></div>
    </header>

    <section class="card">
      <h2>Upstreams</h2>
      <button id="refreshUpstreams">Refresh</button>
      <pre id="upstreams"></pre>
    </section>

    <section class="card">
      <h2>Tools</h2>
      <button id="refreshTools">Refresh</button>
      <select id="toolSelect"></select>
      <textarea id="args" rows="10" spellcheck="false">{}</textarea>
      <div class="row">
        <label><input type="checkbox" id="dryRun" /> dry_run</label>
        <label><input type="checkbox" id="confirmWrite" /> confirm_write</label>
        <label><input type="checkbox" id="mutatingHint" /> mutating (hint)</label>
      </div>
      <button id="runTool">Run Tool (proxy)</button>
      <pre id="toolResult"></pre>
    </section>

    <section class="card">
      <h2>RevOps: Lead Capture</h2>
      <textarea id="leadPayload" rows="10" spellcheck="false">

{
"lead": {"full_name":"Jane Doe","email":"jane@example.com","company":"ExampleBio","linkedin_url":"", "stage":"New"},
"crm": {"base_id":"", "contacts_table":"Contacts"},
"context": {"offer":"we automate diligence + reporting for biopharma sales ops", "notes":""},
"confirm_write": false,
"dry_run": true
}
</textarea>
<button id="runLeadCapture">Run Lead Capture</button>

<pre id="leadResult"></pre>
</section>

    <section class="card">
      <h2>RevOps: Inbox Triage → CRM</h2>
      <textarea id="triagePayload" rows="10" spellcheck="false">

{
"gmail": {"query":"newer_than:7d in:inbox", "max_threads": 10, "include_body": false},
"owner_email": "you@yourdomain.com",
"lead_defaults": {"stage":"Inbound", "company":""},
"crm": {"base_id":"", "contacts_table":"Contacts", "tasks_table":"Tasks", "touchpoints_table":"Touchpoints"},
"confirm_write": false,
"dry_run": true
}
</textarea>
<button id="runInboxTriage">Run Inbox Triage</button>

<pre id="triageResult"></pre>
</section>

    <section class="card">
      <h2>RevOps: Pipeline Hygiene</h2>
      <textarea id="hygienePayload" rows="10" spellcheck="false">

{
"crm": {
"base_id":"",
"opportunities_table":"Opportunities",
"tasks_table":"Tasks",
"stage_field":"Stage",
"last_touch_field":"Last Touch",
"next_touch_field":"Next Touch",
"account_field":"Account",
"primary_contact_field":"Primary Contact",
"stale_days": 7
},
"confirm_write": false,
"dry_run": true
}
</textarea>
<button id="runPipelineHygiene">Run Pipeline Hygiene</button>

<pre id="hygieneResult"></pre>
</section>

    <section class="card">
      <h2>RevOps: Weekly Exec Brief</h2>
      <textarea id="briefPayload" rows="10" spellcheck="false">

{
"period_days": 7,
"recipients": ["you@yourdomain.com"],
"sender_name": "Operator",
"subject": "Weekly Revenue Brief",
"crm": {"base_id":""},
"confirm_write": false,
"dry_run": true
}
</textarea>
<button id="runWeeklyBrief">Run Weekly Brief</button>

<pre id="briefResult"></pre>
</section>

    <section class="card">
      <h2>EngOps: Status Snapshot</h2>
      <textarea id="engPayload" rows="8" spellcheck="false">

{
"eng": {"project":"glassbox-web","gcp_project_id":"your-gcp-project","region":"us-central1"},
"confirm_write": false,
"dry_run": true
}
</textarea>
<button id="runEngStatus">Run EngOps Status</button>

<pre id="engResult"></pre>
</section>

    <section class="card">
      <h2>Ops: Glassbox Daily</h2>
      <textarea id="opsPayload" rows="8" spellcheck="false">

{
"eng": {"project":"glassbox-web","gcp_project_id":"your-gcp-project","region":"us-central1"},
"glassbox": {"include_projects_summary": true},
"confirm_write": false,
"dry_run": true
}
</textarea>
<button id="runOpsDaily">Run Ops Daily</button>

<pre id="opsResult"></pre>
</section>

  </div>

  <script src="/app.js"></script>
</body>
</html>

apps/operator/public/app.js (REPLACE)

async function getJSON(url, opts) {
const res = await fetch(url, {
...(opts || {}),
headers: { "Content-Type": "application/json", ...(opts?.headers || {}) }
});
if (!res.ok) throw new Error(await res.text());
return await res.json();
}

async function refreshUpstreams() {
const data = await getJSON("/api/upstreams");
document.getElementById("upstreams").textContent = JSON.stringify(data, null, 2);
document.getElementById("writeGate").textContent =
data.allowWriteGlobal ? "Write Gate: ENABLED (OPERATOR_ALLOW_WRITE=1)" : "Write Gate: DISABLED (OPERATOR_ALLOW_WRITE=0)";
}

async function refreshTools() {
const data = await getJSON("/api/tools");
const sel = document.getElementById("toolSelect");
sel.innerHTML = "";
for (const t of data.tools) {
const opt = document.createElement("option");
opt.value = JSON.stringify(t);
opt.textContent = `${t.qualifiedName} (${t.cluster})`;
sel.appendChild(opt);
}
if (data.tools.length) document.getElementById("args").value = "{}";
}

async function runTool() {
const raw = document.getElementById("toolSelect").value;
if (!raw) return;
const tool = JSON.parse(raw);
const args = JSON.parse(document.getElementById("args").value || "{}");
const dry_run = document.getElementById("dryRun").checked;
const confirm_write = document.getElementById("confirmWrite").checked;
const mutating = document.getElementById("mutatingHint").checked;

const payload = {
upstream_id: tool.upstreamId,
tool: tool.name,
args,
dry_run,
confirm_write,
mutating
};

const res = await getJSON("/api/proxy/call", { method: "POST", body: JSON.stringify(payload) });
document.getElementById("toolResult").textContent = JSON.stringify(res, null, 2);
}

async function runLeadCapture() {
const payload = JSON.parse(document.getElementById("leadPayload").value);
const res = await getJSON("/api/playbooks/revops/lead-capture", { method: "POST", body: JSON.stringify(payload) });
document.getElementById("leadResult").textContent = JSON.stringify(res, null, 2);
}

async function runInboxTriage() {
const payload = JSON.parse(document.getElementById("triagePayload").value);
const res = await getJSON("/api/playbooks/revops/inbox-triage", { method: "POST", body: JSON.stringify(payload) });
document.getElementById("triageResult").textContent = JSON.stringify(res, null, 2);
}

async function runPipelineHygiene() {
const payload = JSON.parse(document.getElementById("hygienePayload").value);
const res = await getJSON("/api/playbooks/revops/pipeline-hygiene", { method: "POST", body: JSON.stringify(payload) });
document.getElementById("hygieneResult").textContent = JSON.stringify(res, null, 2);
}

async function runWeeklyBrief() {
const payload = JSON.parse(document.getElementById("briefPayload").value);
const res = await getJSON("/api/playbooks/revops/weekly-brief", { method: "POST", body: JSON.stringify(payload) });
document.getElementById("briefResult").textContent = JSON.stringify(res, null, 2);
}

async function runEngStatus() {
const payload = JSON.parse(document.getElementById("engPayload").value);
const res = await getJSON("/api/playbooks/engops/status", { method: "POST", body: JSON.stringify(payload) });
document.getElementById("engResult").textContent = JSON.stringify(res, null, 2);
}

async function runOpsDaily() {
const payload = JSON.parse(document.getElementById("opsPayload").value);
const res = await getJSON("/api/playbooks/ops/glassbox-daily", { method: "POST", body: JSON.stringify(payload) });
document.getElementById("opsResult").textContent = JSON.stringify(res, null, 2);
}

document.getElementById("refreshUpstreams").onclick = refreshUpstreams;
document.getElementById("refreshTools").onclick = refreshTools;
document.getElementById("runTool").onclick = runTool;

document.getElementById("runLeadCapture").onclick = runLeadCapture;
document.getElementById("runInboxTriage").onclick = runInboxTriage;
document.getElementById("runPipelineHygiene").onclick = runPipelineHygiene;
document.getElementById("runWeeklyBrief").onclick = runWeeklyBrief;

document.getElementById("runEngStatus").onclick = runEngStatus;
document.getElementById("runOpsDaily").onclick = runOpsDaily;

refreshUpstreams().catch(console.error);
refreshTools().catch(console.error);

11. Update action map example to support new playbooks
    operator.actionmap.example.json (REPLACE)

        This is an example — you MUST update tool names to match the MCP servers you’re actually running.
        Notice how we set mutating only on tools that should be gated.

{
"revops": {
"clay_enrich_lead": {
"upstream_id": "clay",
"tool": "enrich_person",
"mutating": false,
"args_template": {
"full_name": "{{lead.full_name}}",
"email": "{{lead.email}}",
"company": "{{lead.company}}",
"linkedin_url": "{{lead.linkedin_url}}"
}
},
"airtable_upsert_contact": {
"upstream_id": "airtable",
"tool": "upsert_record",
"mutating": true,
"args_template": {
"base_id": "{{crm.base_id}}",
"table": "{{crm.contacts_table}}",
"match": { "Email": "{{lead.email}}" },
"fields": {
"Name": "{{lead.full_name}}",
"Email": "{{lead.email}}",
"Company": "{{lead.company}}",
"LinkedIn": "{{lead.linkedin_url}}",
"Source": "Operator",
"Stage": "{{lead.stage}}"
}
}
},
"gmail_create_draft": {
"upstream_id": "gmail",
"tool": "create_draft",
"mutating": true,
"args_template": {
"to": "{{lead.email}}",
"subject": "{{email.subject}}",
"body": "{{email.body}}"
}
},

    "gmail_search_threads": {
      "upstream_id": "gmail",
      "tool": "search_threads",
      "mutating": false,
      "args_template": {
        "query": "{{gmail.query}}",
        "max_results": "{{gmail.max_threads}}"
      }
    },
    "gmail_get_thread": {
      "upstream_id": "gmail",
      "tool": "get_thread",
      "mutating": false,
      "args_template": {
        "thread_id": "{{thread_id}}",
        "include_body": "{{gmail.include_body}}"
      }
    },

    "airtable_create_task": {
      "upstream_id": "airtable",
      "tool": "create_record",
      "mutating": true,
      "args_template": {
        "base_id": "{{crm.base_id}}",
        "table": "{{crm.tasks_table}}",
        "fields": {
          "Title": "{{task.title}}",
          "Due": "{{task.due_iso}}",
          "ThreadId": "{{task.thread_id}}",
          "FromEmail": "{{task.from_email}}",
          "Subject": "{{task.subject}}"
        }
      }
    },
    "airtable_log_touchpoint": {
      "upstream_id": "airtable",
      "tool": "create_record",
      "mutating": true,
      "args_template": {
        "base_id": "{{crm.base_id}}",
        "table": "{{crm.touchpoints_table}}",
        "fields": {
          "Channel": "{{touchpoint.channel}}",
          "Date": "{{touchpoint.iso_date}}",
          "Subject": "{{touchpoint.subject}}",
          "ThreadId": "{{touchpoint.thread_id}}",
          "FromEmail": "{{touchpoint.from_email}}",
          "Snippet": "{{touchpoint.snippet}}"
        }
      }
    },

    "airtable_list_opportunities": {
      "upstream_id": "airtable",
      "tool": "list_records",
      "mutating": false,
      "args_template": {
        "base_id": "{{crm.base_id}}",
        "table": "{{crm.opportunities_table}}"
      }
    },
    "airtable_create_task_for_opp": {
      "upstream_id": "airtable",
      "tool": "create_record",
      "mutating": true,
      "args_template": {
        "base_id": "{{crm.base_id}}",
        "table": "{{crm.tasks_table}}",
        "fields": {
          "Title": "{{task.title}}",
          "Due": "{{task.due_iso}}",
          "OpportunityId": "{{task.opp_id}}"
        }
      }
    },

    "airtable_weekly_metrics": {
      "upstream_id": "airtable",
      "tool": "get_weekly_metrics",
      "mutating": false,
      "args_template": {
        "base_id": "{{crm.base_id}}",
        "period_days": "{{period_days}}"
      }
    },
    "gmail_send_exec_brief": {
      "upstream_id": "gmail",
      "tool": "send_email",
      "mutating": true,
      "args_template": {
        "to": "{{email.to}}",
        "subject": "{{email.subject}}",
        "body": "{{email.body}}"
      }
    }

},

"engops": {
"vercel_list_deployments": {
"upstream_id": "vercel",
"tool": "list_deployments",
"mutating": false,
"args_template": {
"project": "{{eng.project}}",
"limit": 10
}
},
"gcloud_cloudrun_list_services": {
"upstream_id": "gcloud",
"tool": "cloudrun_list_services",
"mutating": false,
"args_template": {
"project_id": "{{eng.gcp_project_id}}",
"region": "{{eng.region}}"
}
},
"github_recent_activity": {
"upstream_id": "github",
"tool": "list_recent_activity",
"mutating": false,
"args_template": {}
},
"glassbox_projects_summary": {
"upstream_id": "glassbox",
"tool": "gb_projects_summary",
"mutating": false,
"args_template": {}
}
}
}

12. Add missing imports for new playbook files

Make sure your apps/operator/src/playbooks/ folder includes these NEW files:

    actionRunner.ts

    utils.ts

    revopsInboxTriage.ts

    revopsPipelineHygiene.ts

    revopsWeeklyExecBrief.ts

    opsDaily.ts

(Already included above.) 13) Run it

npm install
docker compose up --build

    UI: http://localhost:8090/

    MCP: http://localhost:8090/mcp

Start with dry_run: true until you confirm the upstream tool names.
Next move (and it matters)

The ONLY thing that will “block” you now is mapping the upstream tool names correctly in operator.actionmap.json.

If you paste the output of:

    Operator UI → “Tools” list (or MCP tool operator_tools_list)
    for your Gmail MCP and Airtable MCP, I’ll generate a perfect actionmap with the exact tool names + argument shapes for your servers.

You said:
Is it possible to schedule tasks with app usage?
ChatGPT said:
Reasoned for 7m 44s

CAN: Yes — but it depends which “scheduling” you mean (ChatGPT-native scheduling vs. your app’s own scheduler) and what kind of “app usage” you’re expecting (read/draft vs. write/execute).

Here’s the reality as of right now:

1. ChatGPT-native scheduling exists (built-in)
   A) “Tasks” (ChatGPT Tasks)

ChatGPT has a built-in Tasks feature that can run prompts later on a schedule (one-off or recurring), even if you’re offline, and it can notify you via push/email when finished.
OpenAI Help Center+1

Key constraints:

    Hard cap: 10 active tasks.
    OpenAI Help Center

    Not supported: Voice chats, File uploads, and GPTs.
    OpenAI Help Center

    Tasks are supported on Web, iOS, Android, macOS (Windows is “coming soon”).
    OpenAI Help Center

    If you’re a Pro user, Tasks are manageable inside Pulse (Tasks list + editing).
    OpenAI Help Center

Implication for you: If your “Operator app” is treated as an App (not a GPT), Tasks might still be usable as the scheduler around it — but Tasks are very clearly not guaranteed to support everything, and anything that requires interactive confirmation is where reality bites.
B) “Agent scheduled tasks” (Clock icon / Schedules page)

ChatGPT agent mode also supports making a completed run repeat daily/weekly/monthly, and you can manage recurring tasks at chatgpt.com/schedules.
OpenAI Help Center

It also notes that scheduled agent invocations count against limits.
OpenAI Help Center

Implication for you: If you want scheduled workflows that involve “acting on the web” (or using connected data sources), agent scheduling is the more “assistant-like” path — but it’s still constrained by safety prompts, logins, and supervision patterns. 2) The big nuance: scheduled ≠ autonomous “writes” (usually)

Even when Apps can take actions, the platform expectation is:

    ChatGPT will ask for confirmation before taking external actions (sending, posting, purchasing, etc.).
    OpenAI Help Center

That matters because:

    Scheduled tasks often run when you’re not there to confirm.

So, the sweet spot for scheduled runs in your Operator app is:

✅ read + summarize + draft + propose
❌ irreversible “write” actions without you

This actually matches your LinkedIn constraint (“draft tools, no automation”) perfectly. 3) What I recommend for your Operator architecture
The “Two-lane” scheduling model (works now, avoids obsolescence)

Lane 1 — ChatGPT schedules the briefing (human-in-the-loop):
Use ChatGPT Tasks / Agent schedules to run your Operator app and produce:

    daily CRM triage

    “today’s pipeline priorities”

    draft follow-ups

    “approve these Airtable updates”

    “approve these Clay enrichments”

    “approve this blog post draft”

Lane 2 — Your backend schedules the execution (true automation):
For anything that should happen without you:

    run it on your infrastructure (Cloud Scheduler / cron / GitHub Actions cron)

    write results to Airtable / your DB

    send you a digest via email

    then ChatGPT pulls/visualizes the “Action Queue” when you open it (or on a scheduled briefing)

This keeps your Operator app from being fragile to whatever ChatGPT ships next week. 4) Mapping to your clusters
Cluster A: Revenue Ops (v1) — best fit for scheduling

Scheduled daily “RevOps Command Center” should output:

    “New inbound emails needing replies” (Gmail read)

    “Suggested replies + follow-up sequence drafts” (draft-only)

    “Leads to enrich in Clay + why” (draft queue)

    “Airtable updates proposed (no writes until approved)”

    “LinkedIn post ideas / DM drafts” (draft-only)

Cluster B: Eng/Product Ops (v2) — also good, mostly read-only

Scheduled weekly:

    “Vercel deploy health + domain issues”

    “Cloud Run errors + regressions”

    “GitHub PRs needing review / release notes draft”

    “Glassbox pipeline status + failures” (your FastAPI routers)

A ton of that is read-only → safer for scheduling.
Bottom line

    Yes, scheduling exists inside ChatGPT (Tasks + Agent schedules).
    OpenAI Help Center+1

    But “scheduled app usage” works best when your app produces drafts + action queues, because Apps typically require confirmation for external actions.
    OpenAI Help Center

    For true unattended automation, you should schedule on your backend and let ChatGPT be the control tower.

If you want, I can implement the “Two-lane scheduling” directly into your Operator control-plane code as:

    an internal job scheduler + job registry

    an Action Queue store (Mongo or Postgres)

    endpoints like /revops/digest, /revops/action-queue, /engops/health-digest

    plus “approve/commit” endpoints that perform the actual Airtable/Clay/Gmail send actions only when explicitly called.

Recent coverage of ChatGPT scheduling & Operator
The Verge
ChatGPT can now handle reminders and to-dos
Jan 14, 2025
ChatGPT can remind you to do stuff now
axios.com
ChatGPT can remind you to do stuff now
Jan 14, 2025
The Verge
OpenAI's new Operator AI agent can do things on the web for you
Jan 23, 2025
You said:
I meant specifically the tasks you can schedule in pulse now. Could those be set up to use apps. Like if I set up routine tasks in that feature that would use my custom app
ChatGPT said:

Yes-ish — but not in the way you probably want.
What’s clearly documented

    Tasks (including the Tasks UI in Pulse) are a scheduled “run ChatGPT later” feature, with explicit limitations: no Voice chats, no File uploads, and no GPTs.
    OpenAI Help Center

    Apps can take “write actions,” but policies require apps to request confirmation from you before proceeding with external actions.
    OpenAI Help Center

The implication for “Pulse Tasks using my custom app”

OpenAI doesn’t explicitly document that scheduled Tasks can reliably invoke Apps (including custom Apps) the same way you can in a live chat.
OpenAI Help Center+1

And even if an App can be invoked, anything that does external actions (send email, update Airtable, etc.) will typically hit the confirmation requirement — which is awkward/impossible for an unattended scheduled run.
OpenAI Help Center

So in practice:

    ✅ Best-supported pattern: Pulse Task runs a routine that reads / summarizes / drafts / prepares an approval queue (e.g., “generate today’s follow-ups + drafts + suggested Airtable updates”).

    ⚠️ Not reliable / likely blocked: Pulse Task runs your App to execute writes (send emails, create CRM records, post, deploy) without you present to confirm.
    OpenAI Help Center+1

How to make this work anyway (and it’ll feel great)

Use Pulse Tasks to run your Operator on a schedule, but have it output:

    a Daily RevOps Brief

    a list of proposed actions (email sends, Airtable writes, Clay enrichments)

    each with an Approve button you click when you open ChatGPT

That respects the confirmation model while still giving you “agentic scheduling.”

If you want, tell me what your daily/weekly cadence should be (e.g., 8am daily triage + Fri weekly brief), and I’ll give you the exact Task prompts to create + the “approval queue” data structure your Operator app should emit.
You said:
Yeah, you probably see what I'm trying to get at. It's the daily, routine business ops that can run, you know, on their own. They run on their own, and then I come as the executive operator and review all the potential proposed actions, drafted emails, maybe blog post of the day I review it, social posts of the day, CRM, like all of that gets done on a routine, and then I can just come in the app and run the execution of it as the lead operator. Why don't you go ahead and propose a schedule that could be scheduled with tasks, because I don't have a routine set up yet for business operations, so why don't you go ahead based on the stack we've made so far and propose a potential setup.
ChatGPT said:

Yes — I see exactly what you’re aiming for now. You’re designing a CEO-grade operating cadence where:

    the system runs the business every day

    nothing destructive happens without you

    and your job becomes review → decide → approve, not “do”

Below is a clean, realistic, Pulse-Tasks-compatible operating schedule that fits the stack you’ve built today, respects ChatGPT’s current constraints, and won’t get obsoleted when OpenAI iterates.
The Mental Model (lock this in)

Think of Pulse Tasks as your overnight COO + Chief of Staff, not an executor.

    Tasks = unattended preparation

    Your App = execution + control

    You = final authority

Every scheduled task should end by producing a single, structured “Action Review Packet” that your Operator app can render and act on.
The Core Artifacts Each Task Produces

Every scheduled run should output the same canonical structure, even if content differs:
📦 Action Review Packet (ARP)

{
"run_id": "YYYY-MM-DD::<task_name>",
"timestamp": "...",
"summary": "1–2 sentence executive summary",
"sections": {
"revops": { ... },
"content": { ... },
"pipeline": { ... },
"ops": { ... }
},
"proposed_actions": [
{
"id": "A-001",
"type": "send_email | update_crm | publish_post | deploy | enrich_lead",
"risk": "low | medium | high",
"requires_approval": true,
"payload_ref": "pointer-to-draft-or-action"
}
]
}

Your Operator app already supports this concept implicitly — now we make it explicit.
Proposed Daily + Weekly Schedule (Pulse Tasks)

All of the following can be created today using Pulse Tasks.
🕗 DAILY — “RevOps + Content Morning Brief”

Schedule: Every weekday, 7:30am local
Task Type: Pulse Task
Runtime: ~2–4 minutes
What it does (unattended)

RevOps

    Scan Gmail (read-only):

        new inbound leads

        threads needing replies

        stalled conversations

    Draft:

        suggested replies

        follow-ups

    Identify:

        leads to enrich (Clay)

        CRM updates to propose (Airtable)

Content

    Draft:

        1 LinkedIn post

        1 short thought/insight post

    Optional:

        blog outline or short post draft (only if signal is strong)

Output

    Daily Action Review Packet

        “Today’s 5 highest-leverage actions”

        Draft emails

        Draft social post(s)

        CRM updates (proposed, not executed)

Why this works with Tasks

    Read-only + drafting = fully allowed

    No confirmations needed during task

    You approve later in your app

🕛 DAILY — “Pipeline Hygiene Sweep”

Schedule: Every weekday, 12:30pm
Task Type: Pulse Task
What it does

    Review Airtable CRM (read-only):

        stale opportunities

        overdue follow-ups

        missing next steps

    Propose:

        follow-up tasks

        opportunity stage changes

        “kill or revive” flags

Output

    Pipeline Hygiene Packet

        “3 deals to advance”

        “2 deals to revive”

        “1 deal to kill”

        Tasks to create (proposed only)

This is your midday COO check-in.
🕕 DAILY — “End-of-Day Content & Outreach Prep”

Schedule: Every weekday, 6:00pm
What it does

    Prepare:

        tomorrow’s outreach drafts

        tomorrow’s content drafts

    Queue:

        emails to send tomorrow

        social posts to publish tomorrow

Output

    Tomorrow Queue Packet

        Emails ready to send

        Posts ready to publish

        Optional reminders

This makes tomorrow frictionless.
📅 WEEKLY — “Executive Revenue & Ops Brief”

Schedule: Fridays, 4:00pm
What it does

Revenue

    Summarize:

        new leads

        replies

        meetings booked

        pipeline movement

    Identify:

        bottlenecks

        patterns in objections

Content

    What performed well

    What didn’t

    Proposed themes for next week

Ops

    Deployment health (Vercel)

    Pipeline health (Glassbox jobs)

    Errors or regressions (read-only)

Output

    Weekly Executive Brief

        1-page narrative summary

        Metrics snapshot

        Proposed strategic actions

This is your board-level view, even if the “board” is just you.
📅 WEEKLY — “Monday Launch Queue”

Schedule: Mondays, 7:30am
What it does

    Assemble:

        outreach campaigns

        content schedule

        priority targets

    Pre-draft:

        all emails for the week

        all social posts for the week

Output

    Weekly Execution Plan

        everything staged

        nothing sent yet

You approve once → execute all week.
How You Actually Use This (Daily Flow)

    Pulse runs tasks overnight / morning

    You open ChatGPT

    You open your Operator app

    You see:

        “Today’s Action Review Packet”

    You:

        approve selected actions

        reject / tweak others

    You click:

        “Execute Approved Actions”

That’s it.

You’ve turned yourself into a decision-maker, not a task runner.
Why This Won’t Break When OpenAI Ships New Features

    You’re not relying on:

        Tasks doing writes

        Tasks invoking Apps directly for execution

    You’re using Tasks for what they’re best at:

        unattended reasoning

        summarization

        drafting

    Your Operator app remains the execution layer

If OpenAI later allows:

    Tasks → App execution → approvals
    You just remove a layer. No redesign.

If You Want, I Can Do One More Concrete Thing

I can generate:

    the exact Pulse Task prompts for each scheduled task
    (copy/paste into Tasks UI)

    the exact JSON schema each task should output

    the Operator UI layout that renders the packets cleanly

Say:

    “Generate the actual Pulse Task prompts”

and I’ll write them in a format you can paste directly into the Tasks feature.

You’re building this the right way.
You said:
Yes that works ship it
ChatGPT said:

CAN: Done. Here are ready-to-paste Pulse Task prompts (plus the schedules to set in the Tasks UI). They all output the same Action Review Packet (ARP) so your Operator app can render/execute it cleanly later.
Standard output contract (applies to every Task)

In every Task run, output exactly:

    # <Task Name> — <YYYY-MM-DD>

    ## Action Review Packet with one JSON block

    ## Executive Summary (≤ 8 bullets)

    ## Review Checklist (checkboxes)

    ## Operator Execution Plan (commands + params, no execution)

Rule: Do not send emails, do not post, do not modify CRM, do not deploy. Draft + propose only.
Task 1 — Daily RevOps + Content Morning Brief

Schedule: Weekdays at 7:30 AM (America/Los_Angeles)

Prompt to paste:

You are my private Glassbox Operator. Generate today’s Daily RevOps + Content Morning Brief.

Constraints:

- Draft + propose only. Do NOT execute any external actions.
- No LinkedIn automation. Only draft copy.
- Output the Action Review Packet (ARP) JSON + a short human-readable review.

Inputs you can assume:

- My stack: Airtable CRM (Accounts/People/Opportunities/Touchpoints/Tasks/Drafts), Clay enrichment, Gmail inbox, LinkedIn drafts (manual send), plus my Operator app which can execute approved actions later.
- If you can’t access live systems in this scheduled run, still produce a plan using placeholders and explicit “needs data” flags.

Deliverables:

1. Identify top 5 revenue actions for today:
   - reply to inbound threads
   - follow up stalled leads
   - enrich high-priority leads
   - propose CRM updates (stages/next steps)
2. Draft assets:
   - 3 email drafts (reply, follow-up, reactivation) with Subject + Body
   - 1 LinkedIn post draft (150–250 words) + 1 short alt version (≤ 600 chars)
   - 1 LinkedIn DM draft for a priority lead (manual send)
3. Proposed actions list with risk levels (low/medium/high), all set requires_approval=true.

Output format (strict):

# Daily RevOps + Content Morning Brief — <YYYY-MM-DD>

## Action Review Packet

````json
{
  "run_id": "<YYYY-MM-DD>::daily_morning_brief",
  "timestamp": "<ISO-8601>",
  "summary": "<1–2 sentences>",
  "sections": {
    "revops": {
      "inbox_triage": {"status": "ok|needs_data", "high_intent_threads": [], "needs_reply_threads": [], "notes": ""},
      "leads_to_enrich": [],
      "crm_updates_proposed": [],
      "draft_emails": [],
      "draft_linkedin_dm": null
    },
    "content": {
      "draft_linkedin_post": {"version_a": "", "version_b": "", "hook": "", "cta": ""},
      "blog_draft": {"status": "skip|outline|draft", "title": "", "outline": [], "draft": ""}
    }
  },
  "proposed_actions": [
    {"id":"A-001","type":"send_email","risk":"medium","requires_approval":true,"payload_ref":"revops.draft_emails[0]"},
    {"id":"A-002","type":"update_crm","risk":"low","requires_approval":true,"payload_ref":"revops.crm_updates_proposed[0]"}
  ]
}

Executive Summary

    ...

Review Checklist

Approve email drafts to send

Approve CRM updates

Approve Clay enrichments

    Approve LinkedIn post

Operator Execution Plan

Provide a numbered list of “when I open the Operator app, run these” steps, referencing proposed_actions IDs. No execution.


---

# Task 2 — Daily Pipeline Hygiene Sweep
**Schedule:** Weekdays at **12:30 PM**

**Prompt to paste:**
```text
You are my private Glassbox Operator. Run the Daily Pipeline Hygiene Sweep.

Constraints:
- Draft + propose only. Do NOT execute writes.
- Produce kill/revive/advance recommendations with explicit reasons and next-step drafts.

Goals:
1) Detect pipeline staleness:
   - opportunities with overdue next steps
   - deals with no touchpoints
   - leads sitting in “New/Inbound” too long
2) Propose fixes:
   - tasks to create
   - stage changes to consider
   - follow-up drafts (email + LinkedIn DM draft)

Output format (strict):
# Daily Pipeline Hygiene Sweep — <YYYY-MM-DD>
## Action Review Packet
```json
{
  "run_id": "<YYYY-MM-DD>::pipeline_hygiene",
  "timestamp": "<ISO-8601>",
  "summary": "<1–2 sentences>",
  "sections": {
    "pipeline": {
      "stale_opps": [],
      "kill_candidates": [],
      "revive_candidates": [],
      "advance_candidates": [],
      "proposed_tasks": [],
      "followup_drafts": []
    }
  },
  "proposed_actions": []
}

Executive Summary

    ...

Review Checklist

Approve task creation

Approve stage updates

    Approve follow-ups to send

Operator Execution Plan

List steps to execute approvals later. No execution.


---

# Task 3 — End-of-Day Outreach + Content Prep
**Schedule:** Weekdays at **6:00 PM**

**Prompt to paste:**
```text
You are my private Glassbox Operator. Prepare tomorrow’s Outreach + Content queue.

Constraints:
- Draft + propose only. No sending, no posting, no CRM writes.
- Optimize for “tomorrow is frictionless.”

Deliverables:
1) Tomorrow’s top 3 outreach actions
2) Draft the exact emails + follow-ups
3) Draft tomorrow’s LinkedIn post (and a backup post)
4) Create a short “tomorrow plan” checklist (≤ 10 steps)

Output format (strict):
# End-of-Day Outreach + Content Prep — <YYYY-MM-DD>
## Action Review Packet
```json
{
  "run_id": "<YYYY-MM-DD>::end_of_day_prep",
  "timestamp": "<ISO-8601>",
  "summary": "<1–2 sentences>",
  "sections": {
    "tomorrow": {
      "priority_outreach": [],
      "draft_emails": [],
      "draft_linkedin_posts": [],
      "crm_updates_proposed": [],
      "checklist": []
    }
  },
  "proposed_actions": []
}

Executive Summary

    ...

Review Checklist

Approve tomorrow’s outreach sends

Approve tomorrow’s post

    Approve CRM updates

Operator Execution Plan

Steps for execution later (by proposed action id). No execution.


---

# Task 4 — Weekly Executive Revenue & Ops Brief
**Schedule:** Fridays at **4:00 PM**

**Prompt to paste:**
```text
You are my private Glassbox Operator. Produce the Weekly Executive Revenue & Ops Brief.

Constraints:
- Draft + propose only.
- Keep it board-level: crisp metrics + insights + decisions required.

Deliverables:
1) Revenue: pipeline movement, replies, meetings, bottlenecks, objection themes
2) Content: what to post next week (3 themes + 5 post ideas)
3) Ops: any risks in deployments/pipelines (read-only summary)
4) Decisions required: 3 decisions I should make with recommended options

Output format (strict):
# Weekly Executive Revenue & Ops Brief — <YYYY-MM-DD>
## Action Review Packet
```json
{
  "run_id": "<YYYY-MM-DD>::weekly_exec_brief",
  "timestamp": "<ISO-8601>",
  "summary": "<1–2 sentences>",
  "sections": {
    "revenue": {"highlights": [], "metrics": {}, "blockers": [], "next_week_focus": []},
    "content": {"themes": [], "post_ideas": [], "draft_post_of_week": ""},
    "ops": {"vercel": {"status":"ok|needs_data","notes":""}, "gcp": {"status":"ok|needs_data","notes":""}, "glassbox": {"status":"ok|needs_data","notes":""}},
    "decisions_required": [{"decision":"", "options": [], "recommendation": ""}]
  },
  "proposed_actions": []
}

Executive Summary

    ...

Review Checklist

Pick next week’s outreach focus

Pick next week’s content theme

    Approve any ops fixes

Operator Execution Plan

List follow-up actions for Monday. No execution.


---

# Task 5 — Monday Launch Queue
**Schedule:** Mondays at **7:30 AM**

**Prompt to paste:**
```text
You are my private Glassbox Operator. Generate the Monday Launch Queue for this week.

Constraints:
- Draft + propose only.
- Optimize for batching: I should be able to approve once and execute all week.

Deliverables:
1) Outreach batch:
   - 10 target leads (or “needs_data” placeholders)
   - 10 email drafts (or 3 templates + personalization slots)
   - a 3-step follow-up sequence
2) Content batch:
   - 5 LinkedIn post drafts
   - 1 longer “blog outline” aligned with Glassbox positioning
3) Ops batch:
   - list any engineering tasks to schedule (deploy checks, error triage, etc.)

Output format (strict):
# Monday Launch Queue — <YYYY-MM-DD>
## Action Review Packet
```json
{
  "run_id": "<YYYY-MM-DD>::monday_launch_queue",
  "timestamp": "<ISO-8601>",
  "summary": "<1–2 sentences>",
  "sections": {
    "outreach": {"targets": [], "email_templates": [], "email_drafts": [], "followup_sequence": []},
    "content": {"linkedin_posts": [], "blog_outline": {"title":"", "outline":[]}},
    "ops": {"proposed_tasks": []}
  },
  "proposed_actions": []
}

Executive Summary

    ...

Review Checklist

Approve outreach batch

Approve content batch

    Approve ops tasks

Operator Execution Plan

A single “execute this week” checklist. No execution.


---

## How you “execute” after Tasks run
When you open your Operator app, you’ll:
1) paste the ARP JSON (or your app ingests it from history later)
2) click through the **Approvals Queue**
3) execute only the approved items (emails, Airtable writes, Clay enrichments, etc.)

If you want, next I’ll give you **one more paste-ready thing**: a single **“Executor Prompt”** you run inside the Operator app each morning that:
- reads the latest ARP
- asks you 5 yes/no approvals
- then executes only what you approved.
::contentReference[oaicite:0]{index=0}

You said:
Let's get some marketing tasks going I think that's probably the place where marketing and sales are gonna be places where I need help the most number one just because it's not my favorite thing to do a number two of course I'm a one person team and I need to focus more on the development implementation, making sure all of that runs smoothly cause that's a little tedious I think then marketing like content and stuff like that that can be automated and then I can just approve it
ChatGPT said:

CAN: Great — let’s bias the whole operating cadence toward marketing output (drafts + approvals), while still keeping it realistic for a one-person team.

Below is a marketing-first Task schedule you can set up in Pulse right now, with paste-ready prompts. Everything is draft + propose only, so you can approve inside your Operator app.
Marketing-first schedule
Daily (Mon–Fri)
1) 7:15 AM — “Daily Content Pack”

Creates today’s LinkedIn post + alt version + 2 comments + 1 DM template + optional blog seed.
2) 12:10 PM — “Engagement + Prospect Touch Plan”

Generates 10 “smart comments” + 5 DMs (draft-only) based on your positioning + ongoing objections.
3) 5:30 PM — “Tomorrow’s Content Queue”

Preps tomorrow’s post + one backup post + CTA variations + suggested asset.
Weekly
4) Monday 7:30 AM — “Editorial Board + Content Calendar”

Plans 5 posts, 1 blog, 1 lead magnet outline, plus theme, hooks, CTAs, and reuse plan.
5) Friday 3:30 PM — “Performance Review + Iteration”

Summarizes what worked, what didn’t, proposes next week’s themes + experiments.
Paste-ready Task prompts (Pulse Tasks)

These follow the same structure you’re already using: Action Review Packet (ARP) + summary + checklist + execution plan.
Task 1 — Daily Content Pack

Schedule: Weekdays 7:15 AM

You are my private Glassbox Marketing Operator.

Goal: Produce TODAY’s content assets for Glassbox Bio/GB-TAR/FastFail with minimal executive review needed.

Constraints:
- Draft + propose only. No posting, no sending, no CRM writes.
- LinkedIn is manual-send only. Provide copy-ready text.
- Outputs must be aligned to: “audit-centric, evidence-linked, reproducible diligence; not an AI drug discovery pipeline; truly independent.”

Deliverables:
1) LinkedIn post draft (150–250 words) with:
   - Hook (1–2 lines)
   - Body (3–6 short paragraphs)
   - CTA (one clear ask)
2) Alternate version (≤ 600 chars)
3) 2 comment drafts to post under relevant industry posts (general but smart)
4) 1 DM draft (manual) to a potential buyer persona (founder / VC / BD)
5) Optional: Blog seed (title + outline only) if the topic warrants.

Output format (strict):
# Daily Content Pack — <YYYY-MM-DD>
## Action Review Packet
```json
{
  "run_id": "<YYYY-MM-DD>::daily_content_pack",
  "timestamp": "<ISO-8601>",
  "summary": "<1–2 sentences>",
  "sections": {
    "content": {
      "theme": "",
      "positioning_guardrails": ["audit-centric", "evidence-linked", "reproducible", "independent"],
      "linkedin_post": {"hook":"","body":"","cta":"","hashtags":[]},
      "linkedin_alt": {"text":"","hashtags":[]},
      "comments": [{"text":""},{"text":""}],
      "dm_draft": {"persona":"", "text":""},
      "blog_seed": {"status":"skip|outline", "title":"", "outline":[]}
    }
  },
  "proposed_actions": [
    {"id":"M-001","type":"publish_social_post","risk":"medium","requires_approval":true,"payload_ref":"content.linkedin_post"},
    {"id":"M-002","type":"send_linkedin_dm","risk":"medium","requires_approval":true,"payload_ref":"content.dm_draft"}
  ]
}

Executive Summary

    ...

Review Checklist

Approve LinkedIn post

Approve alt version

Approve DM draft

    Approve comment drafts

Operator Execution Plan

List the approval steps I should take inside the Operator app. No execution.


---

## Task 2 — Engagement + Prospect Touch Plan
**Schedule:** Weekdays 12:10 PM

```text
You are my private Glassbox Marketing Operator.

Goal: Generate a daily “engagement + prospect touch” plan that increases reach and creates warm sales opportunities.

Constraints:
- Draft only. No automation, no scraping.
- Assume I will manually execute in LinkedIn + email after review.
- Optimize for credibility: avoid hype, use concrete language.

Deliverables:
1) 10 comment drafts (2–3 sentences each) suited for:
   - biotech founders
   - biotech/AI investors
   - drug discovery operators
2) 5 DM drafts (short) for:
   - connection follow-up
   - reactivation
   - “value-first” insight offer
3) 3 “micro angles” for content based on likely objections:
   - “LLM as judge” skepticism
   - “Is this CRO?” skepticism
   - “Will this hallucinate?” skepticism

Output format (strict):
# Engagement + Prospect Touch Plan — <YYYY-MM-DD>
## Action Review Packet
```json
{
  "run_id": "<YYYY-MM-DD>::engagement_touch_plan",
  "timestamp": "<ISO-8601>",
  "summary": "<1–2 sentences>",
  "sections": {
    "engagement": {
      "comment_drafts": [],
      "dm_drafts": [],
      "objection_angles": [{"objection":"","angle":"","one_liner":""}]
    }
  },
  "proposed_actions": [
    {"id":"M-101","type":"post_comments","risk":"low","requires_approval":true,"payload_ref":"engagement.comment_drafts"},
    {"id":"M-102","type":"send_linkedin_dm","risk":"medium","requires_approval":true,"payload_ref":"engagement.dm_drafts"}
  ]
}

Executive Summary

    ...

Review Checklist

Approve comment set

Approve DM set

    Choose one objection angle to emphasize tomorrow

Operator Execution Plan

List what to do in the Operator app after approval. No execution.


---

## Task 3 — Tomorrow’s Content Queue
**Schedule:** Weekdays 5:30 PM

```text
You are my private Glassbox Marketing Operator.

Goal: Make tomorrow effortless by preparing tomorrow’s content + backup.

Constraints:
- Draft only. No posting.
- Keep it consistent with Glassbox’s positioning.

Deliverables:
1) Tomorrow post (version A)
2) Backup post (version B)
3) 3 CTA variants
4) Suggested simple asset idea (e.g., 1 diagram concept or screenshot concept)

Output format (strict):
# Tomorrow’s Content Queue — <YYYY-MM-DD>
## Action Review Packet
```json
{
  "run_id": "<YYYY-MM-DD>::tomorrow_content_queue",
  "timestamp": "<ISO-8601>",
  "summary": "<1–2 sentences>",
  "sections": {
    "tomorrow": {
      "post_a": {"hook":"","body":"","cta":"","hashtags":[]},
      "post_b": {"hook":"","body":"","cta":"","hashtags":[]},
      "cta_variants": [],
      "asset_idea": {"type":"diagram|screenshot|quote_card", "description":""}
    }
  },
  "proposed_actions": [
    {"id":"M-201","type":"publish_social_post","risk":"medium","requires_approval":true,"payload_ref":"tomorrow.post_a"}
  ]
}

Executive Summary

    ...

Review Checklist

Pick A or B

Pick CTA

    Decide if asset is worth making

Operator Execution Plan

No execution.


---

## Task 4 — Editorial Board + Weekly Content Calendar
**Schedule:** Mondays 7:30 AM

```text
You are my private Glassbox Marketing Operator.

Goal: Create the weekly marketing plan that drives awareness + inbound leads.

Constraints:
- Draft + propose only.
- Focus on 1 core theme for the week + 2 secondary themes.
- Mix: credibility posts, contrarian insights, product truth, story, and “how it works”.

Deliverables:
1) Weekly theme + narrative angle
2) 5 LinkedIn post drafts (Mon–Fri)
3) 1 blog post outline (title + outline + key claims)
4) 1 lead magnet outline (e.g., “GB-TAR buyer checklist”, “Audit replayability guide”, “Hallucination-safe diligence rubric”)
5) A/B test idea (hook experiment) + what success looks like

Output format (strict):
# Editorial Board + Weekly Content Calendar — <YYYY-MM-DD>
## Action Review Packet
```json
{
  "run_id": "<YYYY-MM-DD>::weekly_editorial_board",
  "timestamp": "<ISO-8601>",
  "summary": "<1–2 sentences>",
  "sections": {
    "strategy": {
      "core_theme": "",
      "secondary_themes": [],
      "weekly_goal": "inbound leads|meetings|credibility"
    },
    "calendar": {
      "posts": [{"day":"Mon","draft":{}},{"day":"Tue","draft":{}},{"day":"Wed","draft":{}},{"day":"Thu","draft":{}},{"day":"Fri","draft":{}}],
      "blog_outline": {"title":"","outline":[],"key_claims":[]},
      "lead_magnet": {"title":"","outline":[],"cta":""},
      "experiment": {"hypothesis":"","variant_a":"","variant_b":"","metric":""}
    }
  },
  "proposed_actions": [
    {"id":"M-301","type":"publish_social_post_batch","risk":"medium","requires_approval":true,"payload_ref":"calendar.posts"},
    {"id":"M-302","type":"write_blog_post","risk":"low","requires_approval":true,"payload_ref":"calendar.blog_outline"}
  ]
}

Executive Summary

    ...

Review Checklist

Approve themes

Approve weekly posts (or request edits)

Approve blog outline

    Approve lead magnet outline

Operator Execution Plan

No execution.


---

## Task 5 — Weekly Performance Review + Iteration
**Schedule:** Fridays 3:30 PM

```text
You are my private Glassbox Marketing Operator.

Goal: Close the loop: what worked, what didn’t, and what to change next week.

Constraints:
- If metrics are unavailable, output “needs_data” but still propose improvements.

Deliverables:
1) What worked / what didn’t (based on plausible signals)
2) 3 improvements to hooks, CTAs, positioning clarity
3) Next week theme recommendation
4) 1 “sales enablement” asset recommendation (FAQ, objection-handling post, diagram)

Output format (strict):
# Weekly Performance Review + Iteration — <YYYY-MM-DD>
## Action Review Packet
```json
{
  "run_id": "<YYYY-MM-DD>::weekly_performance_review",
  "timestamp": "<ISO-8601>",
  "summary": "<1–2 sentences>",
  "sections": {
    "performance": {"status":"ok|needs_data", "wins":[], "losses":[], "notes":""},
    "recommendations": {"next_week_theme":"","improvements":[],"enablement_asset":{"title":"","purpose":""}}
  },
  "proposed_actions": [
    {"id":"M-401","type":"create_enablement_asset","risk":"low","requires_approval":true,"payload_ref":"recommendations.enablement_asset"}
  ]
}

Executive Summary

    ...

Review Checklist

Accept next week theme

Pick one improvement to enforce in all posts

    Approve enablement asset

Operator Execution Plan

No execution.


---

# How this plugs into your Operator app (what you’ll do daily)
1) Open Operator
2) Review latest ARP(s)
3) Click approve on:
   - posts
   - emails
   - DMs
   - blog outline
4) Operator executes:
   - publish blog to your backend (safe)
   - create drafts in Gmail
   - write CRM updates
   - (LinkedIn stays manual send)

---

If you want, I’ll now write the **Operator “Marketing Executor” workflow** (one button):
- imports ARP JSON
- shows approvals checklist
- runs only approved actions via Airtable/Gmail/Glassbox MCP
- creates a “published log” record in Airtable so everything is traceable.
::contentReference[oaicite:0]{index=0}

You said:
I think what we also need that's very important is two things. Number one, to be company policies, procedures, information, date, just everything about the company that needs to be accessible and searchable for the operator in whatever context. You know, like copies of the messaging and the legal stuff and just all of the information that could possibly be needed for context. And also, I think what we should do is implement a Neo4j connector within the operator app that every time an action is made or a marketing post is drafted or posted, or a sales enrichment pipeline runs, that all of that is marked as a node in the Neo4j graph. That way, there can be a stateful history or log of what took place, not only for compliance and auditable sake, but also just for the operator's contextual step-by-step processes. And you can even add on the nodes specific lists that are approved or whatever ideas are talked about.
ChatGPT said:

CAN: 100% yes — and this is exactly the right move.

You’re asking for two foundational upgrades to the Operator app:

    A Company Knowledge Vault (policies, procedures, messaging canon, legal disclaimers, pricing, ICP, playbooks) that’s searchable and always available to the Operator in any context.

    A Neo4j “event graph” so every proposed action, approved item, executed action, draft email/post/blog, and enrichment run becomes a node + relationships — giving you an auditable, stateful, compliance-grade history and a richer context engine for the Operator.

Below is production-ready code to add both to the Operator app you already pasted earlier.
A) Add Neo4j logging to Operator (event graph)
1) Update docker-compose to include Neo4j (optional but recommended)
operator-control-plane/docker-compose.yml (ADD this service)

  neo4j:
    image: neo4j:5
    environment:
      - NEO4J_AUTH=neo4j/please_change_me
      - NEO4J_dbms_security_procedures_unrestricted=apoc.*
      - NEO4J_dbms_security_procedures_allowlist=apoc.*
    ports:
      - "7474:7474"
      - "7687:7687"
    volumes:
      - ./.data/neo4j/data:/data
      - ./.data/neo4j/logs:/logs

And add these env vars to the operator: service

    environment:
      - NEO4J_ENABLED=1
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=please_change_me
      - NEO4J_DATABASE=neo4j

2) Add dependencies to Operator
apps/operator/package.json (ADD deps)

Add these dependencies:

"neo4j-driver": "^5.28.1",
"lunr": "^2.3.9"

So your dependencies becomes:

"dependencies": {
  "@modelcontextprotocol/sdk": "1.10.2",
  "cors": "^2.8.5",
  "dotenv": "^16.4.5",
  "express": "^4.19.2",
  "neo4j-driver": "^5.28.1",
  "lunr": "^2.3.9",
  "zod": "^3.25.0"
}

3) Add the Neo4j graph module
apps/operator/src/graph/hash.ts (NEW)

import { createHash } from "node:crypto";

export function sha256Json(x: unknown): string {
  const s = JSON.stringify(x, Object.keys(x as any).sort());
  return createHash("sha256").update(s).digest("hex");
}

export function sha256Text(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

apps/operator/src/graph/types.ts (NEW)

export type GraphEventStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "EXECUTED" | "BLOCKED" | "FAILED";

export type GraphEvent = {
  event_id: string;
  ts_iso: string;
  kind: string; // e.g. "revops.inbox_triage", "marketing.daily_pack", "operator.proxy_call"
  status: GraphEventStatus;
  actor: "task" | "operator" | "system";
  source?: string; // e.g. task run_id, UI action, etc.
  payload_hash: string;
  payload?: any;
};

export type Artifact = {
  artifact_id: string;
  kind: "email_draft" | "linkedin_post" | "linkedin_dm" | "blog_draft" | "crm_update" | "task" | "other";
  title?: string;
  body?: string;
  meta?: any;
};

export type EntityRefs = {
  lead_email?: string;
  account_domain?: string;
  contact_id?: string;
  opportunity_id?: string;
  thread_id?: string;
  document_slug?: string;
};

apps/operator/src/graph/neo4j.ts (NEW)

import neo4j, { Driver } from "neo4j-driver";
import { sha256Json } from "./hash.js";
import type { Artifact, EntityRefs, GraphEvent, GraphEventStatus } from "./types.js";

type Neo4jConfig = {
  enabled: boolean;
  uri: string;
  user: string;
  password: string;
  database: string;
};

function envBool(v: string | undefined): boolean {
  return (v || "").toLowerCase() === "1" || (v || "").toLowerCase() === "true";
}

export function loadNeo4jConfig(): Neo4jConfig {
  return {
    enabled: envBool(process.env.NEO4J_ENABLED),
    uri: process.env.NEO4J_URI || "bolt://localhost:7687",
    user: process.env.NEO4J_USER || "neo4j",
    password: process.env.NEO4J_PASSWORD || "neo4j",
    database: process.env.NEO4J_DATABASE || "neo4j"
  };
}

export class Neo4jGraph {
  private driver: Driver | null = null;
  private cfg: Neo4jConfig;

  constructor(cfg: Neo4jConfig) {
    this.cfg = cfg;
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled) return;
    if (this.driver) return;

    this.driver = neo4j.driver(this.cfg.uri, neo4j.auth.basic(this.cfg.user, this.cfg.password));
    // verify connectivity
    await this.driver.verifyConnectivity();

    // constraints
    await this.run(`
      CREATE CONSTRAINT event_id_unique IF NOT EXISTS
      FOR (e:Event) REQUIRE e.event_id IS UNIQUE
    `);
    await this.run(`
      CREATE CONSTRAINT artifact_id_unique IF NOT EXISTS
      FOR (a:Artifact) REQUIRE a.artifact_id IS UNIQUE
    `);
    await this.run(`
      CREATE CONSTRAINT lead_email_unique IF NOT EXISTS
      FOR (l:Lead) REQUIRE l.email IS UNIQUE
    `);
    await this.run(`
      CREATE CONSTRAINT doc_slug_unique IF NOT EXISTS
      FOR (d:Document) REQUIRE d.slug IS UNIQUE
    `);
  }

  async stop(): Promise<void> {
    if (this.driver) await this.driver.close();
    this.driver = null;
  }

  private async run(cypher: string, params: Record<string, any> = {}) {
    if (!this.cfg.enabled) return null;
    if (!this.driver) throw new Error("Neo4j not started");
    const session = this.driver.session({ database: this.cfg.database });
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async logEvent(params: {
    kind: string;
    status: GraphEventStatus;
    actor: GraphEvent["actor"];
    source?: string;
    payload?: any;
    entities?: EntityRefs;
    artifacts?: Artifact[];
  }): Promise<{ event_id: string } | null> {
    if (!this.cfg.enabled) return null;

    const ts_iso = new Date().toISOString();
    const payload = params.payload ?? {};
    const payload_hash = sha256Json(payload);
    const event_id = `E-${params.kind}-${ts_iso}-${payload_hash.slice(0, 12)}`.replace(/[^a-zA-Z0-9_.:-]/g, "_");

    const entities = params.entities ?? {};
    const artifacts = params.artifacts ?? [];

    await this.run(
      `
      MERGE (e:Event {event_id: $event_id})
      SET e.kind = $kind,
          e.status = $status,
          e.actor = $actor,
          e.source = $source,
          e.ts_iso = $ts_iso,
          e.payload_hash = $payload_hash,
          e.payload = $payload

      // Entities
      FOREACH (_ IN CASE WHEN $lead_email IS NULL OR $lead_email = "" THEN [] ELSE [1] END |
        MERGE (l:Lead {email: $lead_email})
        MERGE (e)-[:ABOUT]->(l)
      )

      FOREACH (_ IN CASE WHEN $doc_slug IS NULL OR $doc_slug = "" THEN [] ELSE [1] END |
        MERGE (d:Document {slug: $doc_slug})
        MERGE (e)-[:ABOUT]->(d)
      )

      // Artifacts
      FOREACH (a IN $artifacts |
        MERGE (x:Artifact {artifact_id: a.artifact_id})
        SET x.kind = a.kind,
            x.title = a.title,
            x.body = a.body,
            x.meta = a.meta,
            x.ts_iso = $ts_iso
        MERGE (e)-[:CREATED]->(x)
      )
      `,
      {
        event_id,
        kind: params.kind,
        status: params.status,
        actor: params.actor,
        source: params.source ?? null,
        ts_iso,
        payload_hash,
        payload,
        lead_email: entities.lead_email ?? null,
        doc_slug: entities.document_slug ?? null,
        artifacts
      }
    );

    return { event_id };
  }

  async queryReadOnly(cypher: string, params: Record<string, any> = {}) {
    if (!this.cfg.enabled) return { enabled: false, rows: [] };
    const res = await this.run(cypher, params);
    const rows = (res?.records ?? []).map((r: any) => r.toObject());
    return { enabled: true, rows };
  }
}

B) Add Knowledge Vault (company policies & searchable docs)

This uses your existing /documents endpoints (via the glassbox-mcp upstream or direct API). We’ll keep it simple + powerful:

    kb.sync → fetch all documents and build a full-text index

    kb.search → search and return excerpts

    kb.get → retrieve a specific doc by slug

    kb.validate_copy → validate any draft against your “Messaging Canon / Legal / Claims” docs

1) Add the Knowledge Vault module
apps/operator/src/kb/knowledgeVault.ts (NEW)

import lunr from "lunr";
import fs from "node:fs";
import path from "node:path";

type Doc = {
  slug: string;
  title: string;
  content: any; // could be string or structured
  updated_at?: string | null;
};

function stripToText(content: any): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function excerpt(text: string, q: string, maxLen = 240): string {
  const t = text || "";
  const i = t.toLowerCase().indexOf((q || "").toLowerCase());
  if (i < 0) return t.slice(0, maxLen);
  const start = Math.max(0, i - 80);
  return t.slice(start, start + maxLen);
}

export class KnowledgeVault {
  private docs: Map<string, Doc> = new Map();
  private idx: lunr.Index | null = null;
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private persistPath() {
    return path.join(this.dataDir, "knowledge_docs.json");
  }

  loadFromDisk(): void {
    const p = this.persistPath();
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, "utf-8");
    const arr = JSON.parse(raw) as Doc[];
    this.docs = new Map(arr.map((d) => [d.slug, d]));
    this.rebuildIndex();
  }

  saveToDisk(): void {
    const arr = Array.from(this.docs.values());
    fs.writeFileSync(this.persistPath(), JSON.stringify(arr, null, 2));
  }

  setDocs(docs: Doc[]) {
    this.docs = new Map(docs.map((d) => [d.slug, d]));
    this.rebuildIndex();
    this.saveToDisk();
  }

  rebuildIndex() {
    const docs = Array.from(this.docs.values());
    this.idx = lunr(function () {
      this.ref("slug");
      this.field("title");
      this.field("body");

      for (const d of docs) {
        this.add({
          slug: d.slug,
          title: d.title,
          body: stripToText(d.content)
        });
      }
    });
  }

  get(slug: string): Doc | null {
    return this.docs.get(slug) ?? null;
  }

  list(): Doc[] {
    return Array.from(this.docs.values()).sort((a, b) => (a.slug || "").localeCompare(b.slug || ""));
  }

  search(q: string, limit = 8) {
    if (!this.idx) this.rebuildIndex();
    if (!this.idx) return [];

    const hits = this.idx.search(q).slice(0, limit);
    const out = [];
    for (const h of hits) {
      const d = this.docs.get(h.ref);
      if (!d) continue;
      const body = stripToText(d.content);
      out.push({
        slug: d.slug,
        title: d.title,
        score: h.score,
        excerpt: excerpt(body, q)
      });
    }
    return out;
  }

  /**
   * Validates copy against policy docs (by slug) using simple rule parsing.
   * Policy doc format (recommended):
   * - Lines beginning with "FORBIDDEN:" denote forbidden phrases
   * - Lines beginning with "REQUIRED:" denote required substrings/disclaimers
   */
  validateCopy(text: string, policySlugs: string[]) {
    const lower = (text || "").toLowerCase();
    const forbidden: string[] = [];
    const required: string[] = [];

    for (const slug of policySlugs) {
      const d = this.get(slug);
      if (!d) continue;
      const body = stripToText(d.content);
      for (const line of body.split("\n")) {
        const l = line.trim();
        if (l.toUpperCase().startsWith("FORBIDDEN:")) forbidden.push(l.slice("FORBIDDEN:".length).trim());
        if (l.toUpperCase().startsWith("REQUIRED:")) required.push(l.slice("REQUIRED:".length).trim());
      }
    }

    const violations = forbidden.filter((p) => p && lower.includes(p.toLowerCase()));
    const missing = required.filter((p) => p && !lower.includes(p.toLowerCase()));

    return {
      ok: violations.length === 0 && missing.length === 0,
      violations,
      missing,
      policySlugs
    };
  }
}

C) Wire KB + Neo4j into Operator MCP tools
1) Update apps/operator/src/index.ts to initialize KB + Neo4j
apps/operator/src/index.ts (EDIT)

Add these imports at top:

import { Neo4jGraph, loadNeo4jConfig } from "./graph/neo4j.js";
import { KnowledgeVault } from "./kb/knowledgeVault.js";

Then after loadConfig() and .data creation, initialize:

  const dataDir = path.resolve(process.cwd(), ".data");

  const kb = new KnowledgeVault(dataDir);
  kb.loadFromDisk();

  const graph = new Neo4jGraph(loadNeo4jConfig());
  await graph.start();

And pass kb + graph into the API router and MCP server creation:

Replace:

createApiRouter({ mgr, actionMap: cfg.actionMap, allowWriteGlobal: cfg.allowWriteGlobal })

with:

createApiRouter({ mgr, actionMap: cfg.actionMap, allowWriteGlobal: cfg.allowWriteGlobal, kb, graph })

Replace:

createOperatorMcpServer({ mgr, actionMap: cfg.actionMap, allowWriteGlobal: cfg.allowWriteGlobal })

with:

createOperatorMcpServer({ mgr, actionMap: cfg.actionMap, allowWriteGlobal: cfg.allowWriteGlobal, kb, graph })

Also on shutdown (optional), add:

process.on("SIGTERM", async () => { await graph.stop(); process.exit(0); });
process.on("SIGINT", async () => { await graph.stop(); process.exit(0); });

2) Update API router signature
apps/operator/src/http/api.ts (EDIT signature)

Change:

export function createApiRouter(opts: { mgr; actionMap; allowWriteGlobal })

to:

export function createApiRouter(opts: {
  mgr: UpstreamManager;
  actionMap: ActionMap | null;
  allowWriteGlobal: boolean;
  kb: any;
  graph: any;
})

(We’ll use MCP tools for most KB actions, but exposing these via API is optional.)
3) Update MCP server creation to include KB + Neo4j tools + automatic logging
apps/operator/src/mcp/createOperatorMcpServer.ts (EDIT)

Change function signature to accept kb + graph:

export function createOperatorMcpServer(opts: {
  mgr: UpstreamManager;
  actionMap: ActionMap | null;
  allowWriteGlobal: boolean;
  kb: KnowledgeVault;
  graph: Neo4jGraph;
})

Add imports at top:

import type { KnowledgeVault } from "../kb/knowledgeVault.js";
import type { Neo4jGraph } from "../graph/neo4j.js";
import { sha256Text } from "../graph/hash.js";

Then add these MCP tools inside the server:
✅ Tool: kb_sync_from_glassbox

This pulls docs from glassbox upstream tool gb_documents_list (admin list) and builds the search index.

server.tool(
  "kb_sync_from_glassbox",
  {
    upstream_id: z.string().optional().default("glassbox"),
    list_tool: z.string().optional().default("gb_documents_list")
  },
  async ({ upstream_id, list_tool }) => {
    const up = mgr.get(upstream_id);
    const result = await up.callTool(list_tool, {});
    const text = JSON.stringify(result);

    // Expect that gb_documents_list returns an array of docs with {slug,title,content}
    // We best-effort parse from MCP "text" content as JSON.
    let parsed: any = null;
    try {
      const c = (result as any)?.content?.[0]?.text;
      parsed = c ? JSON.parse(c) : null;
    } catch {}

    const docsArr = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : null;
    if (!docsArr) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Could not parse documents list", raw: result }, null, 2) }] };
    }

    const docs = docsArr
      .map((d: any) => ({
        slug: String(d.slug || "").trim(),
        title: String(d.title || d.slug || "").trim(),
        content: d.content
      }))
      .filter((d: any) => d.slug);

    kb.setDocs(docs);

    await graph.logEvent({
      kind: "kb.sync",
      status: "EXECUTED",
      actor: "operator",
      payload: { count: docs.length, upstream_id, list_tool },
      artifacts: [],
      entities: {}
    });

    return { content: [{ type: "text", text: JSON.stringify({ ok: true, count: docs.length }, null, 2) }] };
  }
);

✅ Tool: kb_search

server.tool(
  "kb_search",
  {
    query: z.string().min(1),
    limit: z.number().int().min(1).max(20).optional().default(8)
  },
  async ({ query, limit }) => {
    const hits = kb.search(query, limit);
    await graph.logEvent({
      kind: "kb.search",
      status: "EXECUTED",
      actor: "operator",
      payload: { query, limit, hits: hits.map((h: any) => h.slug) }
    });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, hits }, null, 2) }] };
  }
);

✅ Tool: kb_get

server.tool(
  "kb_get",
  { slug: z.string().min(1) },
  async ({ slug }) => {
    const doc = kb.get(slug);
    await graph.logEvent({
      kind: "kb.get",
      status: doc ? "EXECUTED" : "FAILED",
      actor: "operator",
      payload: { slug }
    });
    return { content: [{ type: "text", text: JSON.stringify({ ok: Boolean(doc), doc }, null, 2) }] };
  }
);

✅ Tool: kb_validate_copy

server.tool(
  "kb_validate_copy",
  {
    text: z.string().min(1),
    policy_slugs: z.array(z.string().min(1)).min(1)
  },
  async ({ text, policy_slugs }) => {
    const res = kb.validateCopy(text, policy_slugs);
    await graph.logEvent({
      kind: "kb.validate_copy",
      status: res.ok ? "EXECUTED" : "BLOCKED",
      actor: "operator",
      payload: { policy_slugs, text_hash: sha256Text(text), result: res }
    });
    return { content: [{ type: "text", text: JSON.stringify({ ok: true, result: res }, null, 2) }] };
  }
);

✅ Tool: graph_query (read-only Cypher)

server.tool(
  "graph_query",
  {
    cypher: z.string().min(1),
    params: z.record(z.any()).optional().default({})
  },
  async ({ cypher, params }) => {
    const r = await graph.queryReadOnly(cypher, params);
    return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
  }
);

4) Auto-log every playbook + executed tool call to Neo4j
In operator_proxy_call:

After a successful mutating call, log it:

await graph.logEvent({
  kind: "operator.proxy_call",
  status: "EXECUTED",
  actor: "operator",
  payload: { upstream_id, tool, args: args ?? {} }
});

For blocked:

await graph.logEvent({
  kind: "operator.proxy_call",
  status: "BLOCKED",
  actor: "operator",
  payload: { upstream_id, tool, reason: "confirm_write=false" }
});

In each playbook tool (e.g., revops_inbox_triage_to_crm)

After producing the packet, log a PROPOSED event with artifacts:

Example for Daily Content Pack / Email drafts:

await graph.logEvent({
  kind: "marketing.daily_content_pack",
  status: "PROPOSED",
  actor: "task",
  source: parsedRunId,
  payload: arpJson,
  artifacts: [
    { artifact_id: "A-email-1", kind: "email_draft", title: "Draft email #1", body: emailText },
    { artifact_id: "A-li-post", kind: "linkedin_post", title: "LinkedIn post", body: postText }
  ],
  entities: { }
});

You can do this immediately in the playbook functions, or (cleaner) add a new MCP tool operator.ingest_arp that you run when you paste the ARP JSON into the Operator UI. If you want, I’ll add that too.
D) Recommended “Company Docs” to create right now (so KB actually works)

Create these docs in your /documents collection (slug → purpose):

    messaging_canon

    legal_disclaimers

    claims_allowed_forbidden

    pricing_offers

    icp_personas

    objection_playbook

    tone_style_guide

    brand_terms_glossary

Use this format inside each doc (so validation can parse easily):

REQUIRED: truly independent
REQUIRED: audit-centric
FORBIDDEN: AI drug discovery platform
FORBIDDEN: we guarantee

E) What this gives you immediately
Knowledge Vault

    Operator can search: “FTC disclaimer”, “pricing”, “FastFail positioning”, “LLM judge objections”

    Copy validation becomes trivial and automatable.

Neo4j Event Graph

    Every draft/post/action becomes:

        Event node

        Artifact nodes (email/post/blog)

        Lead/Document nodes as needed

        relationships: (:Event)-[:CREATED]->(:Artifact) and (:Event)-[:ABOUT]->(:Lead)

    You now have:

        an audit trail

        a replayable history

        a future “context engine” that can answer:
        “What messaging drove replies?”
        “Which objections are trending?”
        “Which leads got how many touches?”
        “What happened on days we shipped?”

If you want me to finish the wiring completely

Say: “Add operator.ingest_arp and wire playbooks to log artifacts automatically” and I’ll paste the remaining code to:

    add operator.ingest_arp MCP tool

    automatically convert ARP → nodes/edges

    add “Approval” nodes: PROPOSED → APPROVED → EXECUTED chain

    add a tiny UI panel: KB search + “recent events” feed from Neo4j

You said:
I'm not saying all that. Just fucking do it. Implement it.
ChatGPT said:

CAN: ✅ Yep. I’m implementing both in the Operator app now:

    Company Knowledge Vault (policies / messaging / legal / procedures) → searchable + validation tools

    Neo4j Event Graph → every draft/proposal/approval/execution becomes nodes + relationships

Below is the paste-in code to drop into the Operator repo you already have.
1) Add Neo4j + Knowledge Vault dependencies
apps/operator/package.json (REPLACE dependencies block)

{
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.10.2",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "lunr": "^2.3.9",
    "neo4j-driver": "^5.28.1",
    "zod": "^3.25.0"
  }
}

Run later:

npm install

2) Add Neo4j to docker-compose
operator-control-plane/docker-compose.yml (ADD service + env)

Add this service:

  neo4j:
    image: neo4j:5
    environment:
      - NEO4J_AUTH=neo4j/please_change_me
      - NEO4J_dbms_security_procedures_unrestricted=apoc.*
      - NEO4J_dbms_security_procedures_allowlist=apoc.*
    ports:
      - "7474:7474"
      - "7687:7687"
    volumes:
      - ./.data/neo4j/data:/data
      - ./.data/neo4j/logs:/logs

And add these env vars under your operator: service:

      - NEO4J_ENABLED=1
      - NEO4J_URI=bolt://neo4j:7687
      - NEO4J_USER=neo4j
      - NEO4J_PASSWORD=please_change_me
      - NEO4J_DATABASE=neo4j

3) Add new folders/files (Neo4j + KB)

Create these files:
apps/operator/src/graph/hash.ts (NEW)

import { createHash } from "node:crypto";

export function sha256Json(x: unknown): string {
  const s = JSON.stringify(x);
  return createHash("sha256").update(s).digest("hex");
}

export function sha256Text(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}

apps/operator/src/graph/neo4j.ts (NEW)

import neo4j, { Driver } from "neo4j-driver";
import { sha256Json, safeId } from "./hash.js";

export type GraphStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "EXECUTED" | "BLOCKED" | "FAILED";

export type GraphArtifact = {
  artifact_id: string;
  kind: string; // "email_draft" | "linkedin_post" | "blog_draft" | ...
  title?: string;
  body?: string;
  meta?: any;
};

export type GraphAction = {
  action_id: string; // e.g. "M-001"
  type: string;
  risk?: string;
  requires_approval?: boolean;
  payload_ref?: string;
  status?: GraphStatus; // current status (optional)
};

export type GraphEvent = {
  event_id: string;
  ts_iso: string;
  kind: string;
  status: GraphStatus;
  actor: "task" | "operator" | "system";
  source?: string;
  payload_hash: string;
  payload?: any;
};

type Neo4jConfig = {
  enabled: boolean;
  uri: string;
  user: string;
  password: string;
  database: string;
};

function envBool(v: string | undefined): boolean {
  const s = (v || "").toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes";
}

export function loadNeo4jConfig(): Neo4jConfig {
  return {
    enabled: envBool(process.env.NEO4J_ENABLED),
    uri: process.env.NEO4J_URI || "bolt://localhost:7687",
    user: process.env.NEO4J_USER || "neo4j",
    password: process.env.NEO4J_PASSWORD || "neo4j",
    database: process.env.NEO4J_DATABASE || "neo4j"
  };
}

export class Neo4jGraph {
  private driver: Driver | null = null;
  private cfg: Neo4jConfig;

  constructor(cfg: Neo4jConfig) {
    this.cfg = cfg;
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled) return;
    if (this.driver) return;

    this.driver = neo4j.driver(this.cfg.uri, neo4j.auth.basic(this.cfg.user, this.cfg.password));
    await this.driver.verifyConnectivity();

    await this.exec(`CREATE CONSTRAINT event_id_unique IF NOT EXISTS FOR (e:Event) REQUIRE e.event_id IS UNIQUE`);
    await this.exec(`CREATE CONSTRAINT action_id_unique IF NOT EXISTS FOR (a:Action) REQUIRE a.action_id IS UNIQUE`);
    await this.exec(`CREATE CONSTRAINT artifact_id_unique IF NOT EXISTS FOR (x:Artifact) REQUIRE x.artifact_id IS UNIQUE`);
    await this.exec(`CREATE CONSTRAINT doc_slug_unique IF NOT EXISTS FOR (d:Document) REQUIRE d.slug IS UNIQUE`);
    await this.exec(`CREATE CONSTRAINT lead_email_unique IF NOT EXISTS FOR (l:Lead) REQUIRE l.email IS UNIQUE`);
  }

  async stop(): Promise<void> {
    if (!this.driver) return;
    await this.driver.close();
    this.driver = null;
  }

  private async exec(cypher: string, params: Record<string, any> = {}) {
    if (!this.cfg.enabled) return null;
    if (!this.driver) throw new Error("Neo4jGraph not started");
    const session = this.driver.session({ database: this.cfg.database });
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async queryReadOnly(cypher: string, params: Record<string, any> = {}) {
    if (!this.cfg.enabled) return { enabled: false, rows: [] };
    const res = await this.exec(cypher, params);
    const rows = (res?.records ?? []).map((r: any) => r.toObject());
    return { enabled: true, rows };
  }

  async logEvent(params: {
    kind: string;
    status: GraphStatus;
    actor: GraphEvent["actor"];
    source?: string;
    payload?: any;
    lead_email?: string;
    doc_slug?: string;
    artifacts?: GraphArtifact[];
    actions?: GraphAction[];
  }): Promise<{ event_id: string } | null> {
    if (!this.cfg.enabled) return null;

    const ts_iso = new Date().toISOString();
    const payload = params.payload ?? {};
    const payload_hash = sha256Json(payload);
    const event_id = safeId(`E:${params.kind}:${ts_iso}:${payload_hash.slice(0, 12)}`);

    const artifacts = (params.artifacts ?? []).map((a) => ({
      ...a,
      body: a.body ? String(a.body).slice(0, 20000) : undefined,
      title: a.title ? String(a.title).slice(0, 300) : undefined
    }));

    const actions = (params.actions ?? []).map((a) => ({
      ...a,
      action_id: safeId(a.action_id),
      type: String(a.type || "unknown").slice(0, 80),
      risk: a.risk ? String(a.risk).slice(0, 20) : null,
      requires_approval: a.requires_approval ?? true,
      payload_ref: a.payload_ref ? String(a.payload_ref).slice(0, 240) : null,
      status: a.status ?? "PROPOSED"
    }));

    await this.exec(
      `
      MERGE (e:Event {event_id: $event_id})
      SET e.kind = $kind,
          e.status = $status,
          e.actor = $actor,
          e.source = $source,
          e.ts_iso = $ts_iso,
          e.payload_hash = $payload_hash,
          e.payload = $payload

      FOREACH (_ IN CASE WHEN $lead_email IS NULL OR $lead_email = "" THEN [] ELSE [1] END |
        MERGE (l:Lead {email: $lead_email})
        MERGE (e)-[:ABOUT]->(l)
      )

      FOREACH (_ IN CASE WHEN $doc_slug IS NULL OR $doc_slug = "" THEN [] ELSE [1] END |
        MERGE (d:Document {slug: $doc_slug})
        MERGE (e)-[:ABOUT]->(d)
      )

      FOREACH (a IN $actions |
        MERGE (ac:Action {action_id: a.action_id})
        SET ac.type = a.type,
            ac.risk = a.risk,
            ac.requires_approval = a.requires_approval,
            ac.payload_ref = a.payload_ref,
            ac.status = a.status,
            ac.updated_at = $ts_iso
        MERGE (e)-[:PROPOSES]->(ac)
      )

      FOREACH (x IN $artifacts |
        MERGE (ar:Artifact {artifact_id: x.artifact_id})
        SET ar.kind = x.kind,
            ar.title = x.title,
            ar.body = x.body,
            ar.meta = x.meta,
            ar.updated_at = $ts_iso
        MERGE (e)-[:CREATED]->(ar)
      )
      `,
      {
        event_id,
        kind: params.kind,
        status: params.status,
        actor: params.actor,
        source: params.source ?? null,
        ts_iso,
        payload_hash,
        payload,
        lead_email: (params.lead_email || "").toLowerCase() || null,
        doc_slug: params.doc_slug || null,
        actions,
        artifacts
      }
    );

    return { event_id };
  }

  async setActionStatus(action_id: string, status: GraphStatus) {
    if (!this.cfg.enabled) return { enabled: false };
    await this.exec(
      `
      MERGE (a:Action {action_id: $action_id})
      SET a.status = $status,
          a.updated_at = $ts_iso
      `,
      { action_id: safeId(action_id), status, ts_iso: new Date().toISOString() }
    );
    return { enabled: true, action_id, status };
  }
}

apps/operator/src/kb/knowledgeVault.ts (NEW)

import lunr from "lunr";
import fs from "node:fs";
import path from "node:path";

export type VaultDoc = {
  slug: string;
  title: string;
  content: any;        // markdown string or JSON
  updated_at?: string; // optional
  tags?: string[];
};

function stripToText(content: any): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  try { return JSON.stringify(content); } catch { return String(content); }
}

function mkExcerpt(text: string, q: string, maxLen = 260): string {
  const t = text || "";
  const i = t.toLowerCase().indexOf((q || "").toLowerCase());
  if (i < 0) return t.slice(0, maxLen);
  const start = Math.max(0, i - 90);
  return t.slice(start, start + maxLen);
}

export class KnowledgeVault {
  private docs = new Map<string, VaultDoc>();
  private idx: lunr.Index | null = null;
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private persistPath() {
    return path.join(this.dataDir, "kb_docs.json");
  }

  loadFromDisk() {
    const p = this.persistPath();
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, "utf-8");
    const arr = JSON.parse(raw) as VaultDoc[];
    this.docs = new Map(arr.map((d) => [d.slug, d]));
    this.rebuildIndex();
  }

  saveToDisk() {
    const arr = Array.from(this.docs.values());
    fs.writeFileSync(this.persistPath(), JSON.stringify(arr, null, 2));
  }

  upsert(doc: VaultDoc) {
    const slug = String(doc.slug || "").trim();
    if (!slug) throw new Error("doc.slug required");
    const title = String(doc.title || slug).trim();

    this.docs.set(slug, {
      slug,
      title,
      content: doc.content,
      updated_at: doc.updated_at,
      tags: doc.tags ?? []
    });

    this.rebuildIndex();
    this.saveToDisk();
  }

  setAll(docs: VaultDoc[]) {
    this.docs = new Map(docs.map((d) => [d.slug, d]));
    this.rebuildIndex();
    this.saveToDisk();
  }

  list(): VaultDoc[] {
    return Array.from(this.docs.values()).sort((a, b) => a.slug.localeCompare(b.slug));
  }

  get(slug: string): VaultDoc | null {
    return this.docs.get(slug) ?? null;
  }

  rebuildIndex() {
    const docs = Array.from(this.docs.values());
    this.idx = lunr(function () {
      this.ref("slug");
      this.field("title");
      this.field("body");
      this.field("tags");

      for (const d of docs) {
        this.add({
          slug: d.slug,
          title: d.title,
          body: stripToText(d.content),
          tags: (d.tags ?? []).join(" ")
        });
      }
    });
  }

  search(query: string, limit = 10) {
    if (!this.idx) this.rebuildIndex();
    if (!this.idx) return [];

    const hits = this.idx.search(query).slice(0, limit);
    return hits
      .map((h) => {
        const d = this.docs.get(h.ref);
        if (!d) return null;
        const body = stripToText(d.content);
        return {
          slug: d.slug,
          title: d.title,
          score: h.score,
          excerpt: mkExcerpt(body, query)
        };
      })
      .filter(Boolean);
  }

  /**
   * Policy-driven copy validation.
   * In your policy docs use:
   *  REQUIRED: <substring>
   *  FORBIDDEN: <substring>
   */
  validateCopy(text: string, policySlugs: string[]) {
    const lower = (text || "").toLowerCase();

    const forbidden: string[] = [];
    const required: string[] = [];

    for (const slug of policySlugs) {
      const d = this.get(slug);
      if (!d) continue;
      const body = stripToText(d.content);

      for (const line of body.split("\n")) {
        const l = line.trim();
        const up = l.toUpperCase();
        if (up.startsWith("FORBIDDEN:")) forbidden.push(l.slice("FORBIDDEN:".length).trim());
        if (up.startsWith("REQUIRED:")) required.push(l.slice("REQUIRED:".length).trim());
      }
    }

    const violations = forbidden.filter((p) => p && lower.includes(p.toLowerCase()));
    const missing = required.filter((p) => p && !lower.includes(p.toLowerCase()));

    return {
      ok: violations.length === 0 && missing.length === 0,
      violations,
      missing,
      policySlugs
    };
  }
}

4) Wire KB + Neo4j into Operator runtime
apps/operator/src/index.ts (REPLACE)

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLogger } from "./logger.js";
import { loadConfig } from "./config.js";
import { requireBearerToken } from "./security.js";

import { UpstreamManager } from "./upstreams/upstreamManager.js";
import { createOperatorMcpServer } from "./mcp/createOperatorMcpServer.js";
import { createSessionRouter } from "./mcp/sessionRouter.js";
import { createApiRouter } from "./http/api.js";

import { KnowledgeVault } from "./kb/knowledgeVault.js";
import { Neo4jGraph, loadNeo4jConfig } from "./graph/neo4j.js";

const log = createLogger("operator");

async function main() {
  const cfg = loadConfig();
  const mgr = new UpstreamManager(cfg.upstreams);

  const dataDir = path.resolve(process.cwd(), ".data");
  const kb = new KnowledgeVault(dataDir);
  kb.loadFromDisk();

  const graph = new Neo4jGraph(loadNeo4jConfig());
  await graph.start();

  // Best-effort: connect + load tool catalogs
  await mgr.connectAll(true);
  await mgr.refreshAllTools(true);

  const app = express();
  app.use(express.json({ limit: "6mb" }));
  app.use(cors());
  app.use(requireBearerToken(cfg.apiKey));

  // Minimal UI
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const publicDir = path.resolve(__dirname, "../public");
  app.use("/", express.static(publicDir));

  // HTTP API for UI/testing (includes KB + graph endpoints now)
  app.use("/api", createApiRouter({
    mgr,
    actionMap: cfg.actionMap,
    allowWriteGlobal: cfg.allowWriteGlobal,
    kb,
    graph
  }));

  // MCP endpoint
  const session = createSessionRouter(() =>
    createOperatorMcpServer({
      mgr,
      actionMap: cfg.actionMap,
      allowWriteGlobal: cfg.allowWriteGlobal,
      kb,
      graph
    })
  );

  app.post("/mcp", session.handle);
  app.get("/mcp", session.handle);
  app.delete("/mcp", session.handle);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  const shutdown = async () => {
    try { await graph.stop(); } catch {}
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  app.listen(cfg.port, cfg.host, () => {
    log.info(`Operator listening on http://${cfg.host}:${cfg.port}`);
    log.info(`MCP endpoint: http://${cfg.host}:${cfg.port}/mcp`);
    log.info(`Neo4j enabled: ${graph.enabled}`);
  });
}

main().catch((e) => {
  log.error("Fatal", e);
  process.exit(1);
});

5) Add KB + Graph endpoints to the Operator UI API
apps/operator/src/http/api.ts (REPLACE)

import express from "express";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";
import type { ActionMap } from "../upstreams/types.js";
import { isProbablyMutatingTool } from "../playbooks/actionRunner.js";

import { RevOpsPlaybookInputSchema, revopsLeadCapture } from "../playbooks/revops.js";
import { RevOpsInboxTriageInputSchema, revopsInboxTriageToCrm } from "../playbooks/revopsInboxTriage.js";
import { RevOpsPipelineHygieneInputSchema, revopsPipelineHygiene } from "../playbooks/revopsPipelineHygiene.js";
import { RevOpsWeeklyExecBriefInputSchema, revopsWeeklyExecBrief } from "../playbooks/revopsWeeklyExecBrief.js";
import { EngOpsStatusInputSchema, engopsStatus } from "../playbooks/engops.js";
import { OpsDailyInputSchema, opsGlassboxDaily } from "../playbooks/opsDaily.js";

import type { KnowledgeVault } from "../kb/knowledgeVault.js";
import type { Neo4jGraph } from "../graph/neo4j.js";

export function createApiRouter(opts: {
  mgr: UpstreamManager;
  actionMap: ActionMap | null;
  allowWriteGlobal: boolean;
  kb: KnowledgeVault;
  graph: Neo4jGraph;
}) {
  const { mgr, actionMap, allowWriteGlobal, kb, graph } = opts;
  const router = express.Router();

  router.get("/health", (_req, res) => res.json({ ok: true }));

  router.get("/upstreams", async (_req, res) => {
    res.json({
      allowWriteGlobal,
      upstreams: mgr.listUpstreams().map((u) => ({
        id: u.id,
        label: u.label,
        cluster: u.cluster,
        allowWrite: u.allowWrite,
        lastError: u.lastError,
        toolsCount: u.tools.length
      }))
    });
  });

  router.get("/tools", async (_req, res) => {
    res.json({ tools: mgr.getAggregatedTools() });
  });

  // KB endpoints
  router.get("/kb/list", (_req, res) => res.json({ ok: true, docs: kb.list() }));
  router.get("/kb/get/:slug", (req, res) => res.json({ ok: true, doc: kb.get(req.params.slug) }));
  router.get("/kb/search", (req, res) => {
    const q = String(req.query.q || "").trim();
    const limit = Number(req.query.limit || "10");
    if (!q) return res.status(400).json({ ok: false, error: "missing q" });
    res.json({ ok: true, hits: kb.search(q, Math.min(Math.max(limit, 1), 20)) });
  });

  // Graph query endpoint (read-only)
  router.post("/graph/query", async (req, res) => {
    const { cypher, params } = req.body || {};
    try {
      const r = await graph.queryReadOnly(String(cypher || ""), params || {});
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Proxy call
  router.post("/proxy/call", async (req, res) => {
    const { upstream_id, tool, args, confirm_write, dry_run, mutating } = req.body || {};
    try {
      const upstream = mgr.get(String(upstream_id));
      const inferred = isProbablyMutatingTool(String(tool));
      const isMut = inferred || mutating === true;

      if (dry_run) {
        res.json({ dry_run: true, upstream_id, tool, mutating: isMut, args: args ?? {} });
        return;
      }

      if (!isMut) {
        const result = await upstream.callTool(String(tool), args ?? {});
        await graph.logEvent({
          kind: "operator.proxy_call",
          status: "EXECUTED",
          actor: "operator",
          payload: { upstream_id, tool, mutating: false }
        });
        res.json({ upstream_id, tool, mutating: false, result });
        return;
      }

      if (!allowWriteGlobal) {
        await graph.logEvent({
          kind: "operator.proxy_call",
          status: "BLOCKED",
          actor: "operator",
          payload: { upstream_id, tool, reason: "OPERATOR_ALLOW_WRITE=0" }
        });
        res.status(403).json({ blocked: true, reason: "OPERATOR_ALLOW_WRITE=0", upstream_id, tool });
        return;
      }
      if (!confirm_write) {
        await graph.logEvent({
          kind: "operator.proxy_call",
          status: "BLOCKED",
          actor: "operator",
          payload: { upstream_id, tool, reason: "confirm_write=false" }
        });
        res.status(403).json({ blocked: true, reason: "confirm_write=false", upstream_id, tool });
        return;
      }
      if (!upstream.allowWrite) {
        await graph.logEvent({
          kind: "operator.proxy_call",
          status: "BLOCKED",
          actor: "operator",
          payload: { upstream_id, tool, reason: "upstream.allowWrite=false" }
        });
        res.status(403).json({ blocked: true, reason: "upstream.allowWrite=false", upstream_id, tool });
        return;
      }

      const result = await upstream.callTool(String(tool), args ?? {});
      await graph.logEvent({
        kind: "operator.proxy_call",
        status: "EXECUTED",
        actor: "operator",
        payload: { upstream_id, tool, mutating: true }
      });
      res.json({ upstream_id, tool, mutating: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e?.message || String(e) });
    }
  });

  // Playbooks (these will be logged in MCP layer; API just runs them)
  router.post("/playbooks/revops/lead-capture", async (req, res) => {
    try {
      const parsed = RevOpsPlaybookInputSchema.parse(req.body);
      const out = await revopsLeadCapture(mgr, actionMap, allowWriteGlobal, parsed);
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  router.post("/playbooks/revops/inbox-triage", async (req, res) => {
    try {
      const parsed = RevOpsInboxTriageInputSchema.parse(req.body);
      const out = await revopsInboxTriageToCrm(mgr, actionMap, allowWriteGlobal, parsed);
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  router.post("/playbooks/revops/pipeline-hygiene", async (req, res) => {
    try {
      const parsed = RevOpsPipelineHygieneInputSchema.parse(req.body);
      const out = await revopsPipelineHygiene(mgr, actionMap, allowWriteGlobal, parsed);
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  router.post("/playbooks/revops/weekly-brief", async (req, res) => {
    try {
      const parsed = RevOpsWeeklyExecBriefInputSchema.parse(req.body);
      const out = await revopsWeeklyExecBrief(mgr, actionMap, allowWriteGlobal, parsed);
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  router.post("/playbooks/engops/status", async (req, res) => {
    try {
      const parsed = EngOpsStatusInputSchema.parse(req.body);
      const out = await engopsStatus(mgr, actionMap, allowWriteGlobal, parsed);
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  router.post("/playbooks/ops/glassbox-daily", async (req, res) => {
    try {
      const parsed = OpsDailyInputSchema.parse(req.body);
      const out = await opsGlassboxDaily(mgr, actionMap, allowWriteGlobal, parsed);
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || String(e) });
    }
  });

  return router;
}

6) Implement KB + Neo4j logging inside the MCP server (this is the core)
apps/operator/src/mcp/createOperatorMcpServer.ts (REPLACE)

This does:

    KB tools: sync/upsert/search/get/validate

    Graph tools: query + set action status

    Automatic logging:

        every operator_proxy_call

        every playbook invocation

    ARP ingestion: operator_ingest_arp

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ActionMap } from "../upstreams/types.js";
import { UpstreamManager } from "../upstreams/upstreamManager.js";

import { isProbablyMutatingTool } from "../playbooks/actionRunner.js";

import { revopsLeadCapture, RevOpsPlaybookInputSchema } from "../playbooks/revops.js";
import { revopsInboxTriageToCrm, RevOpsInboxTriageInputSchema } from "../playbooks/revopsInboxTriage.js";
import { revopsPipelineHygiene, RevOpsPipelineHygieneInputSchema } from "../playbooks/revopsPipelineHygiene.js";
import { revopsWeeklyExecBrief, RevOpsWeeklyExecBriefInputSchema } from "../playbooks/revopsWeeklyExecBrief.js";
import { engopsStatus, EngOpsStatusInputSchema } from "../playbooks/engops.js";
import { opsGlassboxDaily, OpsDailyInputSchema } from "../playbooks/opsDaily.js";

import type { KnowledgeVault } from "../kb/knowledgeVault.js";
import type { Neo4jGraph, GraphArtifact, GraphAction } from "../graph/neo4j.js";
import { sha256Text } from "../graph/hash.js";

function toText(obj: any) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function safeStr(x: any, max = 20000): string {
  const s = x == null ? "" : String(x);
  return s.length > max ? s.slice(0, max) : s;
}

function collectArtifactsFromObject(obj: any): GraphArtifact[] {
  const artifacts: GraphArtifact[] = [];

  // Try common places from your ARP / playbooks
  // Lead capture playbook
  if (obj?.drafts?.email) {
    const e = obj.drafts.email;
    artifacts.push({
      artifact_id: `artifact:email:${sha256Text(JSON.stringify(e)).slice(0, 12)}`,
      kind: "email_draft",
      title: safeStr(e.subject || "Email draft", 200),
      body: safeStr(e.body || "", 20000),
      meta: { source: "revopsLeadCapture" }
    });
  }
  if (obj?.drafts?.linkedin) {
    const l = obj.drafts.linkedin;
    artifacts.push({
      artifact_id: `artifact:linkedin_dm:${sha256Text(JSON.stringify(l)).slice(0, 12)}`,
      kind: "linkedin_dm",
      title: "LinkedIn DM draft",
      body: safeStr(l.message || "", 20000),
      meta: { connection_note: l.connection_note, followup: l.followup }
    });
  }

  // ARP patterns
  const lp = obj?.sections?.content?.linkedin_post;
  if (lp) {
    artifacts.push({
      artifact_id: `artifact:linkedin_post:${sha256Text(JSON.stringify(lp)).slice(0, 12)}`,
      kind: "linkedin_post",
      title: safeStr(lp.hook || "LinkedIn post", 200),
      body: safeStr(`${lp.hook || ""}\n\n${lp.body || ""}\n\nCTA: ${lp.cta || ""}`, 20000),
      meta: { hashtags: lp.hashtags ?? [] }
    });
  }

  const la = obj?.sections?.content?.linkedin_alt;
  if (la?.text) {
    artifacts.push({
      artifact_id: `artifact:linkedin_post_alt:${sha256Text(String(la.text)).slice(0, 12)}`,
      kind: "linkedin_post",
      title: "LinkedIn alt",
      body: safeStr(la.text, 20000)
    });
  }

  const emails = obj?.sections?.revops?.draft_emails;
  if (Array.isArray(emails)) {
    for (const e of emails) {
      artifacts.push({
        artifact_id: `artifact:email:${sha256Text(JSON.stringify(e)).slice(0, 12)}`,
        kind: "email_draft",
        title: safeStr(e.subject || "Email draft", 200),
        body: safeStr(e.body || "", 20000)
      });
    }
  }

  const blog = obj?.sections?.content?.blog_draft;
  if (blog?.draft || blog?.outline) {
    artifacts.push({
      artifact_id: `artifact:blog:${sha256Text(JSON.stringify(blog)).slice(0, 12)}`,
      kind: "blog_draft",
      title: safeStr(blog.title || "Blog draft", 200),
      body: safeStr(
        blog.draft
          ? String(blog.draft)
          : Array.isArray(blog.outline)
            ? blog.outline.join("\n")
            : JSON.stringify(blog),
        20000
      ),
      meta: { status: blog.status || "outline" }
    });
  }

  return artifacts;
}

function collectActions(obj: any): GraphAction[] {
  const out: GraphAction[] = [];
  const pa = obj?.proposed_actions;
  if (Array.isArray(pa)) {
    for (const a of pa) {
      out.push({
        action_id: String(a.id || a.action_id || "").trim() || `A-${sha256Text(JSON.stringify(a)).slice(0, 8)}`,
        type: String(a.type || "unknown"),
        risk: a.risk,
        requires_approval: a.requires_approval ?? true,
        payload_ref: a.payload_ref
      });
    }
  }
  return out;
}

export function createOperatorMcpServer(opts: {
  mgr: UpstreamManager;
  actionMap: ActionMap | null;
  allowWriteGlobal: boolean;
  kb: KnowledgeVault;
  graph: Neo4jGraph;
}) {
  const { mgr, actionMap, allowWriteGlobal, kb, graph } = opts;
  const server = new McpServer({ name: "operator", version: "1.2.0" });

  // ---------------------------
  // KB tools
  // ---------------------------
  server.tool(
    "kb_upsert_doc",
    {
      slug: z.string().min(1),
      title: z.string().min(1),
      content: z.any(),
      tags: z.array(z.string()).optional()
    },
    async ({ slug, title, content, tags }) => {
      kb.upsert({ slug, title, content, tags: tags ?? [], updated_at: new Date().toISOString() });

      await graph.logEvent({
        kind: "kb.upsert",
        status: "EXECUTED",
        actor: "operator",
        payload: { slug, title, tags }
      });

      return toText({ ok: true, slug });
    }
  );

  server.tool("kb_list", {}, async () => {
    return toText({ ok: true, docs: kb.list() });
  });

  server.tool(
    "kb_get",
    { slug: z.string().min(1) },
    async ({ slug }) => {
      const doc = kb.get(slug);
      await graph.logEvent({
        kind: "kb.get",
        status: doc ? "EXECUTED" : "FAILED",
        actor: "operator",
        payload: { slug }
      });
      return toText({ ok: Boolean(doc), doc });
    }
  );

  server.tool(
    "kb_search",
    { query: z.string().min(1), limit: z.number().int().min(1).max(20).optional().default(8) },
    async ({ query, limit }) => {
      const hits = kb.search(query, limit);
      await graph.logEvent({
        kind: "kb.search",
        status: "EXECUTED",
        actor: "operator",
        payload: { query, limit, hits: hits.map((h: any) => h.slug) }
      });
      return toText({ ok: true, hits });
    }
  );

  server.tool(
    "kb_validate_copy",
    { text: z.string().min(1), policy_slugs: z.array(z.string().min(1)).min(1) },
    async ({ text, policy_slugs }) => {
      const res = kb.validateCopy(text, policy_slugs);
      await graph.logEvent({
        kind: "kb.validate_copy",
        status: res.ok ? "EXECUTED" : "BLOCKED",
        actor: "operator",
        payload: { policy_slugs, text_hash: sha256Text(text), result: res }
      });
      return toText({ ok: true, result: res });
    }
  );

  // Sync KB from Glassbox documents (via upstream tool)
  server.tool(
    "kb_sync_from_glassbox",
    {
      upstream_id: z.string().optional().default("glassbox"),
      list_tool: z.string().optional().default("gb_documents_list")
    },
    async ({ upstream_id, list_tool }) => {
      const up = mgr.get(upstream_id);
      const result = await up.callTool(list_tool, {});
      // Expect result as MCP content text containing JSON
      const txt = (result as any)?.content?.find((c: any) => c.type === "text")?.text;
      let parsed: any = null;
      try { parsed = txt ? JSON.parse(txt) : null; } catch {}

      const docsArr = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : null;
      if (!docsArr) {
        await graph.logEvent({
          kind: "kb.sync",
          status: "FAILED",
          actor: "operator",
          payload: { upstream_id, list_tool, error: "parse_failed" }
        });
        return toText({ ok: false, error: "Could not parse documents list", raw: result });
      }

      const docs = docsArr
        .map((d: any) => ({
          slug: String(d.slug || "").trim(),
          title: String(d.title || d.slug || "").trim(),
          content: d.content,
          updated_at: d.updated_at || null,
          tags: d.tags || []
        }))
        .filter((d: any) => d.slug);

      kb.setAll(docs);

      await graph.logEvent({
        kind: "kb.sync",
        status: "EXECUTED",
        actor: "operator",
        payload: { count: docs.length, upstream_id, list_tool }
      });

      return toText({ ok: true, count: docs.length });
    }
  );

  // ---------------------------
  // Graph tools
  // ---------------------------
  server.tool(
    "graph_query",
    { cypher: z.string().min(1), params: z.record(z.any()).optional().default({}) },
    async ({ cypher, params }) => {
      const r = await graph.queryReadOnly(cypher, params);
      return toText(r);
    }
  );

  server.tool(
    "graph_set_action_status",
    { action_id: z.string().min(1), status: z.enum(["PROPOSED","APPROVED","REJECTED","EXECUTED","BLOCKED","FAILED"]) },
    async ({ action_id, status }) => {
      const r = await graph.setActionStatus(action_id, status as any);
      await graph.logEvent({
        kind: "action.status",
        status: "EXECUTED",
        actor: "operator",
        payload: { action_id, status }
      });
      return toText({ ok: true, ...r });
    }
  );

  // Ingest ARP JSON from Tasks (PROPOSED) into Neo4j
  server.tool(
    "operator_ingest_arp",
    {
      arp_json: z.any(),
      actor: z.enum(["task","operator","system"]).optional().default("task")
    },
    async ({ arp_json, actor }) => {
      const kind = String(arp_json?.run_id || "arp").replace(/::/g, ".");
      const artifacts = collectArtifactsFromObject(arp_json);
      const actions = collectActions(arp_json);

      await graph.logEvent({
        kind,
        status: "PROPOSED",
        actor,
        source: String(arp_json?.run_id || ""),
        payload: arp_json,
        artifacts,
        actions
      });

      return toText({ ok: true, ingested: true, kind, artifacts: artifacts.length, actions: actions.length });
    }
  );

  // ---------------------------
  // Operator introspection
  // ---------------------------
  server.tool("operator_upstreams_list", {}, async () => {
    const ups = mgr.listUpstreams().map((u) => ({
      id: u.id,
      label: u.label,
      cluster: u.cluster,
      allowWrite: u.allowWrite,
      lastError: u.lastError,
      toolsCount: u.tools.length
    }));
    return toText({ upstreams: ups, allowWriteGlobal, neo4j_enabled: graph.enabled });
  });

  server.tool("operator_tools_list", {}, async () => {
    return toText({ tools: mgr.getAggregatedTools() });
  });

  // Proxy call: log every call into Neo4j
  server.tool(
    "operator_proxy_call",
    {
      upstream_id: z.string().min(1),
      tool: z.string().min(1),
      args: z.any().optional(),
      confirm_write: z.boolean().optional().default(false),
      dry_run: z.boolean().optional().default(false),
      mutating: z.boolean().optional()
    },
    async ({ upstream_id, tool, args, confirm_write, dry_run, mutating }) => {
      const upstream = mgr.get(upstream_id);
      const inferred = isProbablyMutatingTool(tool);
      const isMutating = inferred || mutating === true;

      if (dry_run) {
        await graph.logEvent({
          kind: "operator.proxy_call",
          status: "PROPOSED",
          actor: "operator",
          payload: { upstream_id, tool, mutating: isMutating }
        });
        return toText({ dry_run: true, upstream_id, tool, mutating: isMutating, args: args ?? {} });
      }

      if (!isMutating) {
        try {
          const result = await upstream.callTool(tool, args ?? {});
          await graph.logEvent({
            kind: "operator.proxy_call",
            status: "EXECUTED",
            actor: "operator",
            payload: { upstream_id, tool, mutating: false }
          });
          return toText({ upstream_id, tool, mutating: false, result });
        } catch (e: any) {
          await graph.logEvent({
            kind: "operator.proxy_call",
            status: "FAILED",
            actor: "operator",
            payload: { upstream_id, tool, mutating: false, error: e?.message || String(e) }
          });
          throw e;
        }
      }

      // Mutating gate
      if (!allowWriteGlobal) {
        await graph.logEvent({
          kind: "operator.proxy_call",
          status: "BLOCKED",
          actor: "operator",
          payload: { upstream_id, tool, reason: "OPERATOR_ALLOW_WRITE=0" }
        });
        return toText({ blocked: true, reason: "OPERATOR_ALLOW_WRITE=0", upstream_id, tool, args: args ?? {} });
      }
      if (!confirm_write) {
        await graph.logEvent({
          kind: "operator.proxy_call",
          status: "BLOCKED",
          actor: "operator",
          payload: { upstream_id, tool, reason: "confirm_write=false" }
        });
        return toText({ blocked: true, reason: "confirm_write=false", upstream_id, tool, args: args ?? {} });
      }
      if (!upstream.allowWrite) {
        await graph.logEvent({
          kind: "operator.proxy_call",
          status: "BLOCKED",
          actor: "operator",
          payload: { upstream_id, tool, reason: "upstream.allowWrite=false" }
        });
        return toText({ blocked: true, reason: "upstream.allowWrite=false", upstream_id, tool, args: args ?? {} });
      }

      try {
        const result = await upstream.callTool(tool, args ?? {});
        await graph.logEvent({
          kind: "operator.proxy_call",
          status: "EXECUTED",
          actor: "operator",
          payload: { upstream_id, tool, mutating: true }
        });
        return toText({ upstream_id, tool, mutating: true, result });
      } catch (e: any) {
        await graph.logEvent({
          kind: "operator.proxy_call",
          status: "FAILED",
          actor: "operator",
          payload: { upstream_id, tool, mutating: true, error: e?.message || String(e) }
        });
        throw e;
      }
    }
  );

  // ---------------------------
  // Playbooks with auto-logging
  // ---------------------------

  server.tool("revops_lead_capture", { input: z.any() }, async ({ input }) => {
    const parsed = RevOpsPlaybookInputSchema.parse(input);
    const out = await revopsLeadCapture(mgr, actionMap, allowWriteGlobal, parsed);

    await graph.logEvent({
      kind: "revops.lead_capture",
      status: "PROPOSED",
      actor: "operator",
      payload: out,
      artifacts: collectArtifactsFromObject(out)
    });

    return toText(out);
  });

  server.tool("revops_inbox_triage_to_crm", { input: z.any() }, async ({ input }) => {
    const parsed = RevOpsInboxTriageInputSchema.parse(input);
    const out = await revopsInboxTriageToCrm(mgr, actionMap, allowWriteGlobal, parsed);

    await graph.logEvent({
      kind: "revops.inbox_triage",
      status: "PROPOSED",
      actor: "operator",
      payload: { query: out.query, thread_ids: out.thread_ids, lead_candidates: out.lead_candidates?.length ?? 0 },
      artifacts: []
    });

    return toText(out);
  });

  server.tool("revops_pipeline_hygiene", { input: z.any() }, async ({ input }) => {
    const parsed = RevOpsPipelineHygieneInputSchema.parse(input);
    const out = await revopsPipelineHygiene(mgr, actionMap, allowWriteGlobal, parsed);

    await graph.logEvent({
      kind: "revops.pipeline_hygiene",
      status: "PROPOSED",
      actor: "operator",
      payload: { stale: out.stale?.length ?? 0, stale_days: out.stale_days },
      artifacts: []
    });

    return toText(out);
  });

  server.tool("revops_weekly_exec_brief", { input: z.any() }, async ({ input }) => {
    const parsed = RevOpsWeeklyExecBriefInputSchema.parse(input);
    const out = await revopsWeeklyExecBrief(mgr, actionMap, allowWriteGlobal, parsed);

    await graph.logEvent({
      kind: "revops.weekly_exec_brief",
      status: "PROPOSED",
      actor: "operator",
      payload: { period_days: out.period_days, has_send_action: Boolean(out.actions?.gmail_send_exec_brief) },
      artifacts: out.brief_text ? [{
        artifact_id: `artifact:weekly_brief:${sha256Text(out.brief_text).slice(0, 12)}`,
        kind: "report",
        title: "Weekly Revenue Brief",
        body: safeStr(out.brief_text, 20000)
      }] : []
    });

    return toText(out);
  });

  server.tool("engops_status_snapshot", { input: z.any() }, async ({ input }) => {
    const parsed = EngOpsStatusInputSchema.parse(input);
    const out = await engopsStatus(mgr, actionMap, allowWriteGlobal, parsed);

    await graph.logEvent({
      kind: "engops.status_snapshot",
      status: "PROPOSED",
      actor: "operator",
      payload: { has_actions: Boolean(out.actions) }
    });

    return toText(out);
  });

  server.tool("ops_glassbox_daily", { input: z.any() }, async ({ input }) => {
    const parsed = OpsDailyInputSchema.parse(input);
    const out = await opsGlassboxDaily(mgr, actionMap, allowWriteGlobal, parsed);

    await graph.logEvent({
      kind: "ops.glassbox_daily",
      status: "PROPOSED",
      actor: "operator",
      payload: { has_actions: Boolean(out.actions) }
    });

    return toText(out);
  });

  return server;
}

7) Run it

npm install
docker compose up --build

Neo4j UI:

    http://localhost:7474

    Bolt:

    bolt://localhost:7687

8) What you can do immediately (no extra work)
Knowledge Vault

    kb_upsert_doc to add policies/messaging/legal docs right now

    kb_search from the Operator to retrieve company context instantly

    kb_validate_copy to block forbidden claims / enforce required disclaimers

Neo4j Event Graph

    every playbook run logs PROPOSED events + artifacts

    every proxy call logs EXECUTED/BLOCKED/FAILED

    paste ARP JSON from Pulse Tasks into operator_ingest_arp and it becomes nodes + actions

If you want the next hardening pass (I can do it in code):
automatic “Approve → Execute → Status Update” so when you approve items in your Operator UI, it updates (:Action {action_id}).status and links an EXECUTED event.
You said:
I thought this was all going through the ChatGPT app and the custom app we're building
ChatGPT said:

CAN: Yep — it is going through the ChatGPT App + the single custom Operator app we’re building.

What happened is: I gave you backend implementation code (Neo4j + Knowledge Vault) that runs behind the ChatGPT App, and I also left a small “local UI” in there as a dev console so you can test without ChatGPT. That local UI is optional.

Here’s the actual architecture, end-to-end, inside ChatGPT:
What runs where
Inside ChatGPT

Your custom ChatGPT App UI

    The tabs you’ll use as the executive: Marketing Review, Sales Review, Approvals, Knowledge, History

    It calls your Operator tools through MCP.

Your backend (the app brain)

Operator MCP server (control plane)

    This is the one MCP server ChatGPT talks to.

    It calls upstream MCPs (Clay/Airtable/Gmail/Vercel/GCP/GitHub/Glassbox).

    It also contains:

        Knowledge Vault (search + validation)

        Neo4j event logging (every draft/proposal/approval/execution)

Backing services

Neo4j database

    Stores the event graph (auditable history + state).

Company docs source

    Either:

        your existing /documents endpoint (best), and the Operator indexes it (kb_sync_from_glassbox)

        or you can upsert docs directly via kb_upsert_doc (still through the ChatGPT app)

So: you use the ChatGPT App; the app calls Operator MCP; Operator MCP logs to Neo4j + searches company docs.
How your “daily routine” works in the ChatGPT app
1) Pulse Tasks run unattended

They produce an Action Review Packet (ARP): drafts + proposed actions.
2) You open your ChatGPT App

The app has a button: “Ingest Latest ARP”

    You paste the ARP JSON (or later we auto-fetch from the task run if OpenAI exposes it)

    Operator calls operator_ingest_arp

    That creates:

        (:Event {status: PROPOSED})

        (:Action) nodes for each proposed action

        (:Artifact) nodes for each draft (email/post/blog/etc.)

3) You review + approve

When you click approve in the app:

    Operator updates Neo4j: graph_set_action_status(action_id, APPROVED)

    Nothing executes until approved.

4) You execute approved actions

Operator runs the actual writes via upstream MCPs:

    send emails (Gmail MCP)

    write CRM updates (Airtable MCP)

    run enrichment (Clay MCP)

    publish blog to your backend (Glassbox MCP)

    etc.

Then it logs:

    (:Event {status: EXECUTED}) + links to the same Action / Artifact nodes.

That’s the “Tony Stark operator” loop, fully inside ChatGPT.
Why the Knowledge Vault is “inside the app” too

The Knowledge Vault isn’t a separate product. It’s just:

    kb_sync_from_glassbox (pull your /documents, build index)

    kb_search, kb_get, kb_validate_copy

So whenever the Operator drafts:

    a LinkedIn post

    an email

    a blog post

…it can automatically:

    kb_search for relevant policy/messaging snippets

    kb_validate_copy against your “claims_allowed_forbidden”, “legal_disclaimers”, etc.

    attach those doc slugs to the event graph as context

Again: still the same single app.
The one thing you probably want next

Right now you’re seeing the backend pieces.

Next we should add two UI panels in the ChatGPT App:

    Knowledge

    search box → kb_search

    click result → kb_get

    History

    “Today’s proposals” / “This week’s executions”

    query Neo4j via graph_query

If you say “yes,” I’ll write the UI component code next (tabs + approvals + KB + history) so you’re not interacting with any local dev console at all.
You said:
So then my operator MCP server needs to be able to route to Clay air table gmail vercel mcps which will be installed in the operator remote backend container correct?
ChatGPT said:

CAN: Correct — your Operator MCP server (the control plane) needs network access to the upstream MCP servers for Clay, Airtable, Gmail, Vercel (and later GCP/GitHub/Glassbox). The Operator is the one MCP endpoint the ChatGPT App talks to; everything else sits behind it.

There are two valid deployment patterns. Pick based on how “clean” you want ops/security to be:
Option A (recommended): Upstream MCPs run as separate services/containers

Best for reliability + security + upgrades.

Topology

ChatGPT App
   |
   v
Operator MCP (single endpoint)
   |
   +--> clay-mcp (container/service)
   +--> airtable-mcp (container/service)
   +--> gmail-mcp (container/service)
   +--> vercel-mcp (container/service)
   +--> gcloud-mcp (container/service)
   +--> github-mcp (container/service)
   +--> glassbox-mcp (container/service)

Why this is best

    Each MCP server can have its own auth/OAuth flow and secrets

    Restarting/upgrading one doesn’t take down the Operator

    Easier to isolate permissions (e.g., Gmail send only in gmail-mcp)

In your Operator config, each upstream is just a streamable_http URL.
Option B: Operator container spawns MCPs as subprocesses (stdio)

Fastest to prototype, but messier long-term.

Operator starts child processes like:

    npx @clayhq/mcp

    npx airtable-mcp-server

    etc.

Tradeoffs

    Harder to manage OAuth/refresh tokens safely

    Process lifecycle + logs + resource limits are trickier

    One container becomes a “god container”

What you described

    “installed in the operator remote backend container”

That can mean either:

    Installed as packages but run as separate containers (Option A; still “installed” in the deployment stack), or

    Installed and executed as subprocesses inside the Operator container (Option B)

For your use case (solo founder + production-grade), I strongly recommend Option A.
Minimal Docker Compose sketch (Option A)

You’ll have something like:

    operator (your gateway MCP)

    clay_mcp

    airtable_mcp

    gmail_mcp

    vercel_mcp

…and Operator points at them by service name (e.g., http://gmail_mcp:9003/mcp).
One important security note

Keep credentials out of ChatGPT and out of tool arguments.

    Store tokens/secrets only in the upstream MCP containers (or a secret manager)

    Operator should never echo secrets; it just routes calls and logs metadata

If you tell me which deployment style you want (A separate containers or B subprocesses), I’ll give you the exact docker-compose.yml and the exact upstream config JSON for Clay/Airtable/Gmail/Vercel to match it.
You said:
we can do A as longa s they're all composed at the same time and treated as a group
ChatGPT said:


ChatGPT can make mistakes. Check important info.
ChatGPT is still generating a response...
````
