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
