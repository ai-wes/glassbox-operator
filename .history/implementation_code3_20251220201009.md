ChatGPT said:

CAN: Perfect — this is exactly the right pattern:

    Your ChatGPT App talks to one MCP server (your Operator Control Layer / Gateway).

    That gateway can call multiple upstream MCP servers (Vercel MCP, GCP MCP, GitHub MCP, and your Glassbox MCP).

    Glassbox MCP is not your backend API. It’s a thin MCP wrapper that exposes safe, structured “tools” which internally call your existing FastAPI services over HTTP.

You just gave me enough backend surface to build a real Glassbox MCP Server v1.

Below is a production-ready Glassbox MCP server (Node/TypeScript) that exposes explicit, curated tools for:

    TNaaS orchestrator: orchestrator.trigger_phase

    Blog CRUD: blog.list_published, blog.get_post, blog.create_post, blog.update_post, blog.delete_post

    Reports: reports.get_report, reports.get_executive_summary, reports.list_sections, reports.get_section, reports.get_artifact, reports.get_tiered_report

    Intake admin (light): intake.admin_list_all, intake.admin_get_submission, plus intake.admin_download_link

    Contact submit: contact.submit

This keeps things safe-by-default (no “call arbitrary URL” tool), but it’s easy to add more endpoints as you paste routers.
Glassbox MCP Server (Upstream MCP)
Repo structure

glassbox-mcp/
package.json
tsconfig.json
src/
index.ts
config.ts
http.ts
tools/
orchestrator.ts
blog.ts
reports.ts
intake.ts
contact.ts
Dockerfile
.dockerignore

package.json

{
"name": "glassbox-mcp",
"private": true,
"type": "module",
"scripts": {
"build": "tsc -p tsconfig.json",
"start": "node dist/index.js",
"dev": "npm run build && node dist/index.js"
},
"dependencies": {
"@modelcontextprotocol/sdk": "^1.10.2",
"zod": "^3.23.8"
},
"devDependencies": {
"typescript": "^5.6.3"
}
}

tsconfig.json

{
"compilerOptions": {
"target": "ES2022",
"module": "ES2022",
"moduleResolution": "Bundler",
"outDir": "dist",
"rootDir": "src",
"strict": true,
"skipLibCheck": true
},
"include": ["src/**/*.ts"]
}

src/config.ts

This defines base URLs + auth headers for your two services:

    orchestrator service (Cloud Run)

    website backend API (Vercel/Cloud Run)

import { z } from "zod";

export const ConfigSchema = z.object({
port: z.number().int().positive().default(8080),
mcpPath: z.string().min(1).default("/mcp"),

// Optional: protect this MCP server behind a shared key
inboundApiKeyHeader: z.string().min(1).default("x-gb-mcp-key"),
inboundApiKeyValue: z.string().min(16),

orchestratorBaseUrl: z.string().url(),
apiBaseUrl: z.string().url(),
apiPrefix: z.string().min(1).default("/api/v1"),

// Auth: applied to _all_ calls to your services
// (Keep tokens server-side; never pass from ChatGPT)
orchestratorAuthHeader: z.string().min(1).default("Authorization"),
orchestratorAuthValue: z.string().optional(),

apiAuthHeader: z.string().min(1).default("Authorization"),
apiAuthValue: z.string().optional(),

// Additional headers if you want them (e.g. X-API-Key)
apiExtraHeadersJson: z.string().optional(),
orchestratorExtraHeadersJson: z.string().optional(),

// Timeouts
httpTimeoutMs: z.number().int().positive().default(120000),
longTimeoutMs: z.number().int().positive().default(900000)
});

export type GlassboxMcpConfig = z.infer<typeof ConfigSchema>;

export function loadConfigFromEnv(): GlassboxMcpConfig {
const parsed = ConfigSchema.parse({
port: process.env.PORT ? Number(process.env.PORT) : undefined,
mcpPath: process.env.GB_MCP_PATH,
inboundApiKeyHeader: process.env.GB_MCP_INBOUND_KEY_HEADER,
inboundApiKeyValue: process.env.GB_MCP_INBOUND_KEY,

    orchestratorBaseUrl: process.env.GB_ORCHESTRATOR_BASE_URL,
    apiBaseUrl: process.env.GB_API_BASE_URL,
    apiPrefix: process.env.GB_API_PREFIX,

    orchestratorAuthHeader: process.env.GB_ORCHESTRATOR_AUTH_HEADER,
    orchestratorAuthValue: process.env.GB_ORCHESTRATOR_AUTH_VALUE,

    apiAuthHeader: process.env.GB_API_AUTH_HEADER,
    apiAuthValue: process.env.GB_API_AUTH_VALUE,

    apiExtraHeadersJson: process.env.GB_API_EXTRA_HEADERS_JSON,
    orchestratorExtraHeadersJson: process.env.GB_ORCHESTRATOR_EXTRA_HEADERS_JSON,

    httpTimeoutMs: process.env.GB_HTTP_TIMEOUT_MS ? Number(process.env.GB_HTTP_TIMEOUT_MS) : undefined,
    longTimeoutMs: process.env.GB_LONG_TIMEOUT_MS ? Number(process.env.GB_LONG_TIMEOUT_MS) : undefined

});

return parsed;
}

export function parseExtraHeaders(json?: string): Record<string, string> {
if (!json) return {};
try {
const o = JSON.parse(json);
if (!o || typeof o !== "object") return {};
const out: Record<string, string> = {};
for (const [k, v] of Object.entries(o)) {
if (typeof v === "string") out[k] = v;
}
return out;
} catch {
return {};
}
}

src/http.ts

A hardened HTTP helper with:

    timeouts

    JSON/text handling

    error normalization

    safe header injection

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type HttpResult =
| { ok: true; status: number; data: any; headers: Record<string, string> }
| { ok: false; status: number; error: string; detail?: any; headers: Record<string, string> };

export async function httpRequest(
method: HttpMethod,
url: string,
opts: {
headers?: Record<string, string>;
json?: any;
timeoutMs: number;
expect?: "json" | "text";
}
): Promise<HttpResult> {
const controller = new AbortController();
const t = setTimeout(() => controller.abort(), opts.timeoutMs);

const headers: Record<string, string> = {
...(opts.headers ?? {})
};

let body: string | undefined;
if (opts.json !== undefined) {
body = JSON.stringify(opts.json);
headers["content-type"] = headers["content-type"] ?? "application/json";
}

try {
const resp = await fetch(url, {
method,
headers,
body,
signal: controller.signal
});

    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => (respHeaders[k.toLowerCase()] = v));

    const expect = opts.expect ?? "json";
    const raw = await resp.text();

    // Try parse JSON if asked (or if response looks like JSON)
    const maybeJson = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    })();

    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: `HTTP_${resp.status}`,
        detail: maybeJson ?? raw,
        headers: respHeaders
      };
    }

    if (expect === "text") {
      return { ok: true, status: resp.status, data: raw, headers: respHeaders };
    }

    // expect json
    return { ok: true, status: resp.status, data: maybeJson ?? raw, headers: respHeaders };

} catch (e: any) {
const msg =
e?.name === "AbortError"
? `TIMEOUT after ${opts.timeoutMs}ms`
: (e?.message ?? String(e));
return { ok: false, status: 0, error: "NETWORK_ERROR", detail: msg, headers: {} };
} finally {
clearTimeout(t);
}
}

Tool modules
src/tools/orchestrator.ts

import { z } from "zod";
import { httpRequest } from "../http.js";
import type { GlassboxMcpConfig } from "../config.js";
import { parseExtraHeaders } from "../config.js";

export function registerOrchestratorTools(server: any, cfg: GlassboxMcpConfig) {
const extra = parseExtraHeaders(cfg.orchestratorExtraHeadersJson);

const baseHeaders = () => {
const h: Record<string, string> = { ...extra };
if (cfg.orchestratorAuthValue) h[cfg.orchestratorAuthHeader] = cfg.orchestratorAuthValue;
return h;
};

server.tool(
"orchestrator.health",
"Check orchestrator service health.",
z.object({}),
async () => {
const url = `${cfg.orchestratorBaseUrl.replace(/\/$/, "")}/health`;
const r = await httpRequest("GET", url, {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});

      return {
        content: [
          { type: "json", json: r }
        ]
      };
    }

);

server.tool(
"orchestrator.trigger_phase",
"Run one TNaaS orchestrator phase for a project_id (calls /orchestrator/run). Requires approval at gateway level.",
z.object({
project_id: z.string().min(1),
phase: z.string().min(2),
extra_args: z.array(z.string()).optional(),
upload_results: z.boolean().optional().default(true)
}),
async (args: any) => {
const url = `${cfg.orchestratorBaseUrl.replace(/\/$/, "")}/orchestrator/run`;
const payload = {
project_id: args.project_id,
phase: args.phase,
extra_args: args.extra_args ?? null,
upload_results: args.upload_results ?? true
};

      const r = await httpRequest("POST", url, {
        headers: baseHeaders(),
        json: payload,
        timeoutMs: cfg.longTimeoutMs,
        expect: "json"
      });

      return { content: [{ type: "json", json: r }] };
    }

);
}

src/tools/blog.ts

import { z } from "zod";
import { httpRequest } from "../http.js";
import type { GlassboxMcpConfig } from "../config.js";
import { parseExtraHeaders } from "../config.js";

export function registerBlogTools(server: any, cfg: GlassboxMcpConfig) {
const extra = parseExtraHeaders(cfg.apiExtraHeadersJson);

const baseHeaders = () => {
const h: Record<string, string> = { ...extra };
if (cfg.apiAuthValue) h[cfg.apiAuthHeader] = cfg.apiAuthValue;
return h;
};

const api = (path: string) =>
`${cfg.apiBaseUrl.replace(/\/$/, "")}${cfg.apiPrefix}${path}`;

server.tool(
"blog.list_published",
"List published blog posts.",
z.object({}),
async () => {
const r = await httpRequest("GET", api("/blog/posts"), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"blog.get_post",
"Get a published blog post by slug.",
z.object({ slug: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("GET", api(`/blog/posts/${encodeURIComponent(args.slug)}`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

// Based on your repo/model usage: title, slug, body_html required; others optional
const BlogCreateSchema = z.object({
title: z.string().min(1),
slug: z.string().min(1),
body_html: z.string().min(1),
excerpt: z.string().optional(),
category: z.string().optional(),
featured_image: z.string().url().optional(),
status: z.enum(["draft", "published"]).optional().default("draft"),
published_at: z.string().datetime().optional(),
authors: z.array(z.string()).optional(),
tags: z.array(z.string()).optional()
});

server.tool(
"blog.create_post",
"Create a new blog post (draft or published). Requires approval at gateway level.",
BlogCreateSchema,
async (args: any) => {
const r = await httpRequest("POST", api("/blog/posts"), {
headers: baseHeaders(),
json: args,
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

const BlogUpdateSchema = z.object({
slug: z.string().min(1),
patch: BlogCreateSchema.partial()
});

server.tool(
"blog.update_post",
"Patch a blog post by slug. Requires approval at gateway level.",
BlogUpdateSchema,
async (args: any) => {
const r = await httpRequest("PATCH", api(`/blog/posts/${encodeURIComponent(args.slug)}`), {
headers: baseHeaders(),
json: args.patch,
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"blog.delete_post",
"Delete a blog post by slug. Requires approval at gateway level.",
z.object({ slug: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("DELETE", api(`/blog/posts/${encodeURIComponent(args.slug)}`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);
}

src/tools/reports.ts

import { z } from "zod";
import { httpRequest } from "../http.js";
import type { GlassboxMcpConfig } from "../config.js";
import { parseExtraHeaders } from "../config.js";

export function registerReportsTools(server: any, cfg: GlassboxMcpConfig) {
const extra = parseExtraHeaders(cfg.apiExtraHeadersJson);

const baseHeaders = () => {
const h: Record<string, string> = { ...extra };
if (cfg.apiAuthValue) h[cfg.apiAuthHeader] = cfg.apiAuthValue;
return h;
};

const api = (path: string) =>
`${cfg.apiBaseUrl.replace(/\/$/, "")}${cfg.apiPrefix}${path}`;

server.tool(
"reports.get_report",
"Get full tier-filtered report for a job_id (user access controlled).",
z.object({ job_id: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("GET", api(`/reports/${encodeURIComponent(args.job_id)}`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"reports.get_executive_summary",
"Get executive summary for a job_id.",
z.object({ job_id: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("GET", api(`/reports/${encodeURIComponent(args.job_id)}/summary`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"reports.get_tiered_report",
"Get report for a specific tier view (fast_fail|standard|deep_dive).",
z.object({
job_id: z.string().min(1),
tier: z.enum(["fast_fail", "standard", "deep_dive"])
}),
async (args: any) => {
const r = await httpRequest("GET", api(`/reports/${encodeURIComponent(args.job_id)}/tier/${args.tier}`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"reports.list_sections",
"List all report sections with access info.",
z.object({ job_id: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("GET", api(`/reports/${encodeURIComponent(args.job_id)}/sections`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"reports.get_section",
"Get a specific section; optionally request one level.",
z.object({
job_id: z.string().min(1),
section_id: z.string().min(1),
level: z.number().int().min(0).max(5).optional()
}),
async (args: any) => {
const q = args.level !== undefined ? `?level=${encodeURIComponent(String(args.level))}` : "";
const r = await httpRequest(
"GET",
api(`/reports/${encodeURIComponent(args.job_id)}/sections/${encodeURIComponent(args.section_id)}${q}`),
{
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
}
);
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"reports.get_artifact",
"Get an artifact by artifact_id (returns JSON with artifact + location).",
z.object({
job_id: z.string().min(1),
artifact_id: z.string().min(1)
}),
async (args: any) => {
const r = await httpRequest(
"GET",
api(`/reports/${encodeURIComponent(args.job_id)}/artifacts/${encodeURIComponent(args.artifact_id)}`),
{ headers: baseHeaders(), timeoutMs: cfg.httpTimeoutMs, expect: "json" }
);
return { content: [{ type: "json", json: r }] };
}
);
}

src/tools/intake.ts

import { z } from "zod";
import { httpRequest } from "../http.js";
import type { GlassboxMcpConfig } from "../config.js";
import { parseExtraHeaders } from "../config.js";

export function registerIntakeTools(server: any, cfg: GlassboxMcpConfig) {
const extra = parseExtraHeaders(cfg.apiExtraHeadersJson);

const baseHeaders = () => {
const h: Record<string, string> = { ...extra };
if (cfg.apiAuthValue) h[cfg.apiAuthHeader] = cfg.apiAuthValue;
return h;
};

const api = (path: string) =>
`${cfg.apiBaseUrl.replace(/\/$/, "")}${cfg.apiPrefix}${path}`;

server.tool(
"intake.admin_list_all",
"Admin: list all intake submissions.",
z.object({}),
async () => {
const r = await httpRequest("GET", api("/intake/admin/all"), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"intake.admin_get_submission",
"Admin: get one intake submission + attachments metadata.",
z.object({ submission_id: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("GET", api(`/intake/admin/${encodeURIComponent(args.submission_id)}`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

// For download, safest is to return a URL (your app UI can fetch with cookies/token if needed)
server.tool(
"intake.admin_download_link",
"Admin: return the download URL for a submission archive zip (your UI or browser can fetch it with auth).",
z.object({ submission_id: z.string().min(1) }),
async (args: any) => {
const url = api(`/intake/admin/${encodeURIComponent(args.submission_id)}/download`);
return { content: [{ type: "json", json: { ok: true, download_url: url } }] };
}
);
}

src/tools/contact.ts

import { z } from "zod";
import { httpRequest } from "../http.js";
import type { GlassboxMcpConfig } from "../config.js";
import { parseExtraHeaders } from "../config.js";

export function registerContactTools(server: any, cfg: GlassboxMcpConfig) {
const extra = parseExtraHeaders(cfg.apiExtraHeadersJson);

const baseHeaders = () => {
const h: Record<string, string> = { ...extra };
if (cfg.apiAuthValue) h[cfg.apiAuthHeader] = cfg.apiAuthValue;
return h;
};

const api = (path: string) =>
`${cfg.apiBaseUrl.replace(/\/$/, "")}${cfg.apiPrefix}${path}`;

server.tool(
"contact.submit",
"Submit a contact form message (triggers email background task if configured). Requires approval at gateway level if you treat this as write.",
z.object({
full_name: z.string().min(1),
email: z.string().email(),
company_name: z.string().optional(),
phone_number: z.string().optional(),
topic: z.string().optional(),
message: z.string().min(1),
allow_contact: z.boolean().default(true)
}),
async (args: any) => {
const r = await httpRequest("POST", api("/contact/"), {
headers: baseHeaders(),
json: args,
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);
}

src/index.ts

This wires everything up, starts the MCP server, and enforces inbound auth so it’s private.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { loadConfigFromEnv } from "./config.js";
import { registerOrchestratorTools } from "./tools/orchestrator.js";
import { registerBlogTools } from "./tools/blog.js";
import { registerReportsTools } from "./tools/reports.js";
import { registerIntakeTools } from "./tools/intake.js";
import { registerContactTools } from "./tools/contact.js";

async function main() {
const cfg = loadConfigFromEnv();

const server = new McpServer({
name: "glassbox-mcp",
version: "0.1.0"
});

// Tool groups
registerOrchestratorTools(server, cfg);
registerBlogTools(server, cfg);
registerReportsTools(server, cfg);
registerIntakeTools(server, cfg);
registerContactTools(server, cfg);

// Minimal introspection
server.tool("glassbox.ping", "Ping the Glassbox MCP server.", (await import("zod")).z.object({}), async () => {
return { content: [{ type: "json", json: { ok: true, service: "glassbox-mcp", version: "0.1.0" } }] };
});

const transport = new StreamableHTTPServerTransport({ endpoint: cfg.mcpPath });
await server.connect(transport);

const http = await import("node:http");
const srv = http.createServer(async (req, res) => {
// Inbound auth: require a shared key header
const key = req.headers[cfg.inboundApiKeyHeader.toLowerCase()] as string | undefined;
if (!key || key !== cfg.inboundApiKeyValue) {
res.statusCode = 401;
res.setHeader("content-type", "application/json");
res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
return;
}

    try {
      await transport.handleRequest(req, res);
    } catch (e: any) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "MCP_SERVER_ERROR", detail: e?.message ?? String(e) }));
    }

});

srv.listen(cfg.port, () => {
console.log(`glassbox-mcp listening on :${cfg.port}${cfg.mcpPath}`);
});
}

main().catch((e) => {
console.error(e);
process.exit(1);
});

Dockerfile (Cloud Run friendly)

FROM node:20-slim AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "dist/index.js"]

.dockerignore

node_modules
dist
.git
.DS_Store

How to run locally

export PORT=8080
export GB_MCP_INBOUND_KEY="CHANGE_ME_TO_A_LONG_RANDOM_SECRET_32+"

export GB_ORCHESTRATOR_BASE_URL="https://YOUR_ORCH_SERVICE"
export GB_API_BASE_URL="https://api.glassbox-bio.com"
export GB_API_PREFIX="/api/v1"

# If your backend expects Authorization Bearer

export GB_API_AUTH_HEADER="Authorization"
export GB_API_AUTH_VALUE="Bearer YOUR_ADMIN_JWT_OR_SERVICE_TOKEN"

# If orchestrator uses auth too

export GB_ORCHESTRATOR_AUTH_HEADER="X-API-Key"
export GB_ORCHESTRATOR_AUTH_VALUE="YOUR_INTERNAL_KEY"

npm install
npm run build
npm start

Your MCP endpoint will be:

http://localhost:8080/mcp

Plug into your Operator Gateway (single-app control layer)

In your Operator Gateway upstream config, add:

{
"prefix": "glassbox",
"url": "https://YOUR_GLASSBOX_MCP/mcp",
"headers": {
"x-gb-mcp-key": "CHANGE_ME_TO_A_LONG_RANDOM_SECRET_32+"
},
"allowWrites": true
}

Now ChatGPT (through the gateway) will see tools like:

    glassbox.blog.create_post

    glassbox.orchestrator.trigger_phase

    glassbox.reports.get_executive_summary

…and your gateway can enforce approvals for write tools.
What I need next (to expand Glassbox MCP properly)

You’ve shown a lot of routers exist (projects, pipeline, files, etc.) but I didn’t get their endpoint signatures here.

To add the next set cleanly, paste either:

    The /api/v1/openapi.json output (best), OR

    The router files for the specific modules you want operational first (my recommendation: projects + pipeline + files).

Then I’ll generate:

    tool schemas (zod) for each endpoint

    consistent naming

    safe “write requires approval” patterns

    and an optional “bundled” tool that composes multiple calls (e.g. “publish blog post + trigger deploy + verify health”) while still going through your approval gate.

If you want, I can also patch your Operator Gateway to add inbound auth (right now it doesn’t have it in the skeleton I gave earlier), so the whole control plane is actually private end-to-end.
You said:
i just fucking posted all of the routers
ChatGPT said:
You said:
from typing import List, Dict, Any

from fastapi import APIRouter, Depends

from ..auth import get_current_user
from ..mongo_repos import list_projects_for_user
from ..schemas import ProjectsSummaryResponse, ProjectRead, UserSummary

router = APIRouter(prefix="/me/projects", tags=["projects"])

@router.get("/summary", response_model=ProjectsSummaryResponse)
async def list_projects_summary(
current_user: Dict[str, Any] = Depends(get_current_user),
) -> ProjectsSummaryResponse:
projects = list_projects_for_user(str(current_user["_id"]))
project_payloads: List[ProjectRead] = []
for project in projects:
project_payloads.append(
ProjectRead(
id=str(project.get("\_id")),
name=project.get("name"),
slug=project.get("slug"),
is_example=project.get("is_example", False),
created_at=project.get("created_at"),
updated_at=project.get("updated_at"),
latest_audit=None,
)
)

    user_summary = UserSummary(
        id=str(current_user.get("_id")),
        email=current_user.get("email"),
        full_name=current_user.get("full_name"),
        onboarding_completed=current_user.get("onboarding_completed", False),
        default_project_id=current_user.get("default_project_id"),
    )

    return ProjectsSummaryResponse(user=user_summary, projects=project_payloads)

"""
FastAPI adapter that exposes the TNaaS orchestrator phases (P1–P13) as HTTP endpoints.
It reuses the existing controller/phase functions from scripts.streamlit.refactored_app_3.py.
"""
from **future** import annotations

import os
import sys
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, validator

from ..config import get_settings

router = APIRouter(prefix="/pipeline", tags=["pipeline"])
settings = get_settings()

PHASE_CHOICES = {
"all",
"P1",
"P2",
"P3a",
"P3",
"P4",
"P5",
"P6",
"P7a",
"P7b",
"P7c",
"P7d",
"P8a",
"P8b",
"P9",
"P10",
"P11",
"P12",
"P13",
}

class RunPhaseOptions(BaseModel):
indication: str | None = None
chembl_csv: str | None = None
database_directory: str | None = None
chunk_size: int = 50000
streaming_p2: bool = False
streaming_topk: bool = False
topk_per_batch: int = 100
global_topk: int = 2000
instructions: str | None = None
skip_crew_evidence: bool = False
quiet: bool = False

    @validator("chunk_size", "topk_per_batch", "global_topk")
    def _ensure_positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("must be positive")
        return value

class RunPhaseRequest(BaseModel):
project_id: str = Field(..., description="Project slug, e.g., tnaas-tyk2-2025q1")
phase: str = Field(..., description="Phase code such as P5 or 'all'")
options: RunPhaseOptions = RunPhaseOptions()

    @validator("phase")
    def _validate_phase(cls, value: str) -> str:
        if value not in PHASE_CHOICES:
            raise ValueError(f"phase must be one of: {sorted(PHASE_CHOICES)}")
        return value

class RunPhaseResponse(BaseModel):
ok: bool
phase: str
results: Dict[str, Any] | None = None
error: str | None = None

def \_resolve_tcb_root() -> Path:
"""
Resolve the target_credit_b repo root. Falls back to the repo containing this API
if TCB_ROOT is not present or invalid, so local development still works.
"""
candidate = Path(settings.tcb_root).expanduser().resolve()
if candidate.exists():
return candidate

    fallback = Path(__file__).resolve().parents[3]
    return fallback if fallback.exists() else candidate

def \_ensure_paths() -> Path:
"""
Make sure the orchestrator packages are importable by injecting repo paths.
"""
root = \_resolve_tcb_root()
src = root / "src"
scripts_dir = root / "scripts"

    for path in (root, src, scripts_dir):
        if path.exists():
            path_str = str(path)
            if path_str not in sys.path:
                sys.path.insert(0, path_str)

    # Provide a default projects dir if not already set
    os.environ.setdefault("TN_PROJECTS_DIR", str(root / "projects"))
    return root

def \_imports() -> Dict[str, Any]:
\_ensure_paths() # Local imports after sys.path injection
from app.pipeline import controller # type: ignore
import scripts.streamlit.refactored_app_3 as orchestrator # type: ignore

    return {
        "controller": controller,
        "OrchestratorOptions": orchestrator.OrchestratorOptions,
    }

@router.get("/phases", response_model=List[str], summary="List available phases")
def list_phases() -> List[str]:
return sorted(PHASE_CHOICES)

@router.post(
"/run",
response_model=RunPhaseResponse,
summary="Run a TNaaS orchestrator phase (P1–P13 or all)",
)
async def run_phase(req: RunPhaseRequest) -> RunPhaseResponse:
try:
mod = \_imports()
opts = mod["OrchestratorOptions"](
verbose=not req.options.quiet,
indication=req.options.indication,
chembl_csv=req.options.chembl_csv,
database_directory=req.options.database_directory,
chunk_size=req.options.chunk_size,
streaming_p2=req.options.streaming_p2,
streaming_topk=req.options.streaming_topk,
topk_per_batch=req.options.topk_per_batch,
global_topk=req.options.global_topk,
instructions=req.options.instructions,
skip_crew_evidence=req.options.skip_crew_evidence,
)
except Exception as exc:
raise HTTPException(
status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
detail=f"Failed to build orchestrator options: {exc}",
) from exc

    try:
        result = await run_in_threadpool(
            mod["controller"].run_phase,
            req.project_id,
            req.phase,
            opts,
        )
        return RunPhaseResponse(ok=True, phase=req.phase, results=result)
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Phase execution failed: {exc}",
        ) from exc

"""
File upload endpoints for molecular data and documents.
"""
import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, File, UploadFile, Form, HTTPException, status, Query
from fastapi.responses import Response
from pydantic import BaseModel

from ..schemas import FileUploadResponse, UploadedFileRead
from ..auth import get_current_user, get_admin_user
from ..services.file_storage import file_storage
from ..mongo_repos import (
create_uploaded_file,
list_uploaded_files_by_user,
find_uploaded_file,
delete_uploaded_file,
find_user_by_id,
find_job,
find_intake,
find_project,
add_attachment_to_intake,
)

logger = logging.getLogger(**name**)
router = APIRouter(prefix="/files", tags=["files"])

def \_safe_lookup(fn, key: str):
try:
return fn(key)
except Exception as exc:
logger.debug("Skipping metadata lookup for key %s: %s", key, exc)
return None

def \_get_user_id(doc: Dict[str, Any]) -> str:
"""Get user_id from document, falling back to \_id conversion for backward compatibility."""
return doc.get("user_id") or str(doc.get("\_id") or doc.get("id"))

@router.post("/upload", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
file: UploadFile = File(...),
category: Optional[str] = Form(None),
description: Optional[str] = Form(None),
tags: Optional[str] = Form(None), # Comma-separated tags
submission_id: Optional[str] = Form(None),
job_id: Optional[str] = Form(None),
project_id: Optional[str] = Form(None),
current_user: Dict[str, Any] = Depends(get_current_user),
):
"""
Upload a file (CSV, JSON, SDF, PDF, etc.) and store metadata.

    Supported file types:
    - Data files: .csv, .json, .xlsx, .tsv
    - Structure files: .sdf, .mol, .pdb, .smiles
    - Documents: .pdf, .docx, .txt
    """
    # Validate file size (50MB limit)
    file.file.seek(0, 2)  # Seek to end
    file_size = file.file.tell()
    file.file.seek(0)  # Reset to beginning

    if file_size > 50 * 1024 * 1024:  # 50MB
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="File size exceeds 50MB limit"
        )

    # Get user_id using helper function
    user_id = _get_user_id(current_user)

    # If project_id not provided but job_id is, try to get it from job
    if not project_id and job_id:
        job = find_job(job_id)
        if job:
            project_id = job.get("project_id")

    # If project_id not provided but submission_id is, try to get it from submission
    if not project_id and submission_id:
        submission = find_intake(submission_id)
        if submission:
            project_id = submission.get("project_id")

    # Save file to storage with user/project/job organization
    file_metadata = await file_storage.save_file(
        file,
        user_id=user_id,
        category=category,
        project_id=project_id,
        job_id=job_id,
        submission_id=submission_id
    )

    # Parse tags
    tag_list = [tag.strip() for tag in tags.split(",")] if tags else None

    db_file = create_uploaded_file(
        {
            "user_id": user_id,
            "submission_id": submission_id,
            "job_id": job_id,
            "project_id": project_id,
            "filename": file_metadata['filename'],
            "original_filename": file_metadata['original_filename'],
            "file_path": file_metadata['file_path'],
            "file_size": file_metadata['file_size'],
            "file_type": file_metadata['file_type'],
            "file_extension": file_metadata['file_extension'],
            "category": file_metadata['category'],
            "description": description,
            "tags": tag_list,
        }
    )

    file_id = str(db_file["_id"])

    # Link file to intake submission if submission_id provided
    if submission_id:
        try:
            add_attachment_to_intake(submission_id, file_id)
            logger.info(f"Linked file {file_id} to intake submission {submission_id}")
        except Exception as e:
            logger.warning(f"Failed to link file to intake submission: {e}")

    return FileUploadResponse(
        id=file_id,
        filename=db_file["filename"],
        original_filename=db_file["original_filename"],
        file_size=db_file["file_size"],
        file_type=db_file["file_type"],
        category=db_file["category"],
        download_url=f"/api/v1/files/{file_id}/download",
        uploaded_at=db_file.get("uploaded_at"),
    )

@router.get("", response_model=List[UploadedFileRead])
async def list_user_files(
category: Optional[str] = None,
submission_id: Optional[str] = None,
job_id: Optional[str] = None,
project_id: Optional[str] = None,
current_user: Dict[str, Any] = Depends(get_current_user),
):
"""List all files uploaded by the current user."""
filters: Dict[str, Any] = {}
if category:
filters["category"] = category
if submission_id:
filters["submission_id"] = submission_id
if job_id:
filters["job_id"] = job_id
if project_id:
filters["project_id"] = project_id
files = list_uploaded_files_by_user(\_get_user_id(current_user), filters)
for f in files: # Normalize id field for response model
if "\_id" in f:
f["id"] = str(f.pop("\_id"))
return files

@router.get("/{file_id}", response_model=UploadedFileRead)
async def get_file_metadata(
file_id: str,
current_user: Dict[str, Any] = Depends(get_current_user),
):
"""Get metadata for a specific file."""
file = find_uploaded_file(file_id)
if not file:
raise HTTPException(status_code=404, detail="File not found")
if file.get("user_id") != \_get_user_id(current_user):
raise HTTPException(status_code=403, detail="Not authorized to access this file")
if "\_id" in file:
file["id"] = str(file.pop("\_id"))
return file

@router.get("/{file_id}/download")
async def download_file(
file_id: str,
current_user: Dict[str, Any] = Depends(get_current_user),
):
"""Download a file from GCS using a presigned URL."""
from fastapi.responses import RedirectResponse
import logging

    logger = logging.getLogger(__name__)

    file = find_uploaded_file(file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if file.get("user_id") != _get_user_id(current_user):
        raise HTTPException(status_code=403, detail="Not authorized to access this file")

    logger.info(f"Generating download URL for file: {file_id}, path: {file['file_path']}")

    try:
        presigned_url = file_storage.get_presigned_url(file["file_path"], expiration=3600)
        if not presigned_url:
            logger.error(f"Failed to generate presigned URL for file_path: {file['file_path']}")
            content = await file_storage.get_file_content(file["file_path"])
            return Response(
                content=content,
                media_type=file.get("file_type") or "application/octet-stream",
                headers={
                    "Content-Disposition": f"attachment; filename=\"{file.get('original_filename') or file.get('filename')}\""
                },
            )
        return RedirectResponse(url=presigned_url)
    except Exception as e:
        logger.error(f"Error generating download URL: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate download URL: {str(e)}"
        )

@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
file_id: str,
current_user: Dict[str, Any] = Depends(get_current_user),
):
"""Delete a file."""
file = find_uploaded_file(file_id)
if not file:
raise HTTPException(status_code=404, detail="File not found")
if file.get("user_id") != str(current_user["_id"]):
raise HTTPException(status_code=403, detail="Not authorized to delete this file")

    await file_storage.delete_file(file["file_path"])
    delete_uploaded_file(file_id)
    return None

# Admin endpoints for S3 file browser

class DownloadUrlRequest(BaseModel):
key: str

@router.get("/admin/list")
async def list_s3_files_admin(
prefix: str = Query("", description="S3 key prefix to filter files/folders"),
current_user = Depends(get_admin_user),
):
"""
List files and folders in S3 bucket with optional prefix filter.
Enriches listings with user, job, and submission metadata for better organization.
Requires admin authentication.
""" # Validate prefix (prevent directory traversal)
if '..' in prefix or (prefix and prefix.startswith('/')):
raise HTTPException(
status_code=status.HTTP_400_BAD_REQUEST,
detail="Invalid prefix"
)

    try:
        files = file_storage.list_files(prefix=prefix)

        # Cache for metadata lookups to avoid duplicate queries
        user_cache: Dict[str, Dict[str, Any]] = {}
        job_cache: Dict[str, Dict[str, Any]] = {}
        submission_cache: Dict[str, Dict[str, Any]] = {}

        # Enrich files with metadata
        enriched_files = []
        for file_item in files:
            key = file_item.get("key", "")
            is_folder = key.endswith("/")

            # Parse path structure: users/{user_id}/jobs/{job_id}/... or users/{user_id}/submissions/{submission_id}/...
            parts = [p for p in key.split("/") if p]
            enriched_item = {
                **file_item,
                "display_name": None,
                "metadata": {}
            }

            if is_folder:
                # For folders, try to get a readable name
                if len(parts) >= 2 and parts[0] == "users":
                    user_id = parts[1]
                    if user_id not in user_cache:
                        user = _safe_lookup(find_user_by_id, user_id)
                        if user:
                            user_cache[user_id] = user

                    if user_id in user_cache:
                        user = user_cache[user_id]
                        user_name = user.get("full_name") or user.get("email", "").split("@")[0] or user_id[:8]
                        enriched_item["metadata"]["user_email"] = user.get("email")
                        enriched_item["metadata"]["user_name"] = user.get("full_name")

                        if len(parts) >= 4 and parts[2] == "jobs":
                            job_id = parts[3]
                            if job_id not in job_cache:
                                job = _safe_lookup(find_job, job_id)
                                if job:
                                    job_cache[job_id] = job

                            if job_id in job_cache:
                                job = job_cache[job_id]
                                target = job.get("target", "")
                                indication = job.get("indication", "")
                                job_label = f"{target} • {indication}" if target and indication else (target or indication or job_id[:8])
                                enriched_item["display_name"] = f"{user_name} - {job_label}"
                                enriched_item["metadata"]["job_target"] = target
                                enriched_item["metadata"]["job_indication"] = indication
                            else:
                                enriched_item["display_name"] = f"{user_name} - Job {job_id[:8]}"
                        elif len(parts) >= 4 and parts[2] == "submissions":
                            submission_id = parts[3]
                            if submission_id not in submission_cache:
                                submission = _safe_lookup(find_intake, submission_id)
                                if submission:
                                    submission_cache[submission_id] = submission

                            if submission_id in submission_cache:
                                submission = submission_cache[submission_id]
                                company = submission.get("company_name", "")
                                submission_label = company or submission_id[:8]
                                enriched_item["display_name"] = f"{user_name} - {submission_label}"
                                enriched_item["metadata"]["submission_company"] = company
                            else:
                                enriched_item["display_name"] = f"{user_name} - Submission {submission_id[:8]}"
                        elif len(parts) >= 3:
                            # Category folder
                            category = parts[2]
                            enriched_item["display_name"] = f"{user_name} - {category.title()}"
                        else:
                            enriched_item["display_name"] = user_name
                    else:
                        enriched_item["display_name"] = f"User {user_id[:8]}"
                else:
                    # Root level or unknown structure
                    folder_name = parts[-1] if parts else "Root"
                    enriched_item["display_name"] = folder_name.replace("_", " ").title()
            else:
                # For files, try to get original filename from blob metadata
                try:
                    blob = file_storage.bucket.blob(key)
                    if blob.exists():
                        blob.reload()
                        metadata = blob.metadata or {}
                        original_filename = metadata.get("original_filename")
                        if original_filename:
                            enriched_item["display_name"] = original_filename
                            enriched_item["metadata"]["original_filename"] = original_filename
                        else:
                            # Fallback to filename from path
                            enriched_item["display_name"] = parts[-1] if parts else key
                    else:
                        enriched_item["display_name"] = parts[-1] if parts else key
                except Exception:
                    # If we can't load metadata, just use the filename from path
                    enriched_item["display_name"] = parts[-1] if parts else key

            enriched_files.append(enriched_item)

        return {"files": enriched_files}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error listing files: {str(e)}"
        )

@router.post("/admin/download-url")
async def get_s3_file_download_url_admin(
request: DownloadUrlRequest,
current_user = Depends(get_admin_user),
):
"""
Generate a presigned URL for downloading an S3 file.
Requires admin authentication.
""" # Validate key (prevent directory traversal)
if '..' in request.key or request.key.startswith('/'):
raise HTTPException(
status_code=status.HTTP_400_BAD_REQUEST,
detail="Invalid file key"
)

    # Prevent getting URLs for folders
    if request.key.endswith('/'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot get download URL for folders"
        )

    try:
        # Check if file exists
        if not file_storage.file_exists(request.key):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File not found"
            )

        # Generate presigned URL (valid for 1 hour)
        url = file_storage.get_presigned_url(request.key, expiration=3600)

        if not url:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to generate download URL"
            )

        return {"url": url}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating download URL: {str(e)}"
        )

@router.delete("/admin/delete", status_code=status.HTTP_204_NO_CONTENT)
async def delete_s3_file_admin(
key: str = Query(..., description="S3 key of file to delete"),
current_user = Depends(get_admin_user),
):
"""
Delete a file from S3 bucket.
Requires admin authentication.
""" # Validate key (prevent directory traversal)
if '..' in key or key.startswith('/'):
raise HTTPException(
status_code=status.HTTP_400_BAD_REQUEST,
detail="Invalid file key"
)

    # Prevent deletion of folders (keys ending with /)
    if key.endswith('/'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete folders via this endpoint"
        )

    try:
        # Check if file exists
        if not file_storage.file_exists(key):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File not found"
            )

        # Delete the file
        success = await file_storage.delete_file(key)

        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to delete file"
            )

        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error deleting file: {str(e)}"
        )

from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status

from ..auth import get_admin_user
from ..mongodb import get_mongo_db
from ..schemas import DocumentCreate, DocumentRead, DocumentUpdate

router = APIRouter(prefix="/documents", tags=["documents"])

@router.get("/{slug}", response_model=DocumentRead)
async def fetch_document(slug: str):
doc = get_mongo_db().documents.find_one({"slug": slug})
if not doc:
raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
doc["id"] = str(doc.pop("\_id"))
return doc

@router.get("/", response*model=list[DocumentRead])
async def list_documents(*: Dict[str, Any] = Depends(get_admin_user)):
docs = list(get_mongo_db().documents.find({}).sort("updated_at", -1))
for d in docs:
d["id"] = str(d.pop("\_id"))
return docs

@router.post("/", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
async def create_document(
payload: DocumentCreate,
admin_user: Dict[str, Any] = Depends(get_admin_user),
):
normalized_slug = payload.slug.strip().lower()
existing = get_mongo_db().documents.find_one({"slug": normalized_slug})
if existing:
raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Slug already in use")

doc = {
"slug": normalized_slug,
"title": payload.title.strip(),
"content": payload.content,
"updated_by_id": str(admin_user["_id"]),
"updated_at": None,
}
res = get_mongo_db().documents.insert_one(doc)
doc["id"] = str(res.inserted_id)
doc.pop("\_id", None)
return doc

@router.patch("/{document_id}", response_model=DocumentRead)
async def update_document(
document_id: str,
payload: DocumentUpdate,
admin_user: Dict[str, Any] = Depends(get_admin_user),
):
updates: Dict[str, Any] = {}
if payload.title is not None:
updates["title"] = payload.title.strip()
if payload.content is not None:
updates["content"] = payload.content
updates["updated_by_id"] = str(admin_user["_id"])
from bson import ObjectId
result = get_mongo_db().documents.find_one_and_update(
{"\_id": ObjectId(document_id) if len(document_id)==24 else document_id},
{"$set": updates},
return_document=True,
)
if not result:
raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
result["id"] = str(result.pop("\_id"))
return result

@router.delete("/{document*id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
document_id: str,
*: Dict[str, Any] = Depends(get_admin_user),
):
from bson import ObjectId
res = get_mongo_db().documents.delete_one({"\_id": ObjectId(document_id) if len(document_id)==24 else document_id})
if res.deleted_count == 0:
raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
return None
ChatGPT said:

CAN: You’re right — you did paste the routers. I missed that you’d already provided the concrete endpoint shapes needed to generate the MCP tool wrappers, and I responded like I still needed them. That’s on me.

So here’s the fix: updated Glassbox MCP server code that wraps the routers you just posted (projects, pipeline, files, documents), plus the ones you posted earlier (orchestrator, blog, reports, intake admin, contact). This gives you a clean upstream MCP surface that your single Operator Gateway can call as glassbox.\*.

Below are the new/updated files you need to drop into the glassbox-mcp/ project I gave you.
✅ Update 1: Hardened HTTP helper (supports multipart + manual redirects)
src/http.ts (REPLACE with this)

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type HttpResult =
| { ok: true; status: number; data: any; headers: Record<string, string> }
| { ok: false; status: number; error: string; detail?: any; headers: Record<string, string> };

function toHeaders(resp: Response): Record<string, string> {
const out: Record<string, string> = {};
resp.headers.forEach((v, k) => (out[k.toLowerCase()] = v));
return out;
}

function tryParseJson(text: string): any | undefined {
try {
return JSON.parse(text);
} catch {
return undefined;
}
}

export async function httpRequest(
method: HttpMethod,
url: string,
opts: {
headers?: Record<string, string>;
json?: any;
timeoutMs: number;
expect?: "json" | "text";
redirect?: RequestRedirect; // "follow" | "manual" | "error"
}
): Promise<HttpResult> {
const controller = new AbortController();
const t = setTimeout(() => controller.abort(), opts.timeoutMs);

const headers: Record<string, string> = {
...(opts.headers ?? {})
};

let body: string | undefined;
if (opts.json !== undefined) {
body = JSON.stringify(opts.json);
headers["content-type"] = headers["content-type"] ?? "application/json";
}

try {
const resp = await fetch(url, {
method,
headers,
body,
signal: controller.signal,
redirect: opts.redirect ?? "follow"
});

    const respHeaders = toHeaders(resp);

    const raw = await resp.text();
    const parsed = raw ? tryParseJson(raw) : undefined;

    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: `HTTP_${resp.status}`,
        detail: parsed ?? raw,
        headers: respHeaders
      };
    }

    const expect = opts.expect ?? "json";
    if (expect === "text") {
      return { ok: true, status: resp.status, data: raw, headers: respHeaders };
    }
    // expect json
    return { ok: true, status: resp.status, data: parsed ?? raw, headers: respHeaders };

} catch (e: any) {
const msg =
e?.name === "AbortError"
? `TIMEOUT after ${opts.timeoutMs}ms`
: (e?.message ?? String(e));
return { ok: false, status: 0, error: "NETWORK_ERROR", detail: msg, headers: {} };
} finally {
clearTimeout(t);
}
}

export async function httpMultipart(
url: string,
opts: {
headers?: Record<string, string>;
form: FormData;
timeoutMs: number;
expect?: "json" | "text";
redirect?: RequestRedirect;
}
): Promise<HttpResult> {
const controller = new AbortController();
const t = setTimeout(() => controller.abort(), opts.timeoutMs);

const headers: Record<string, string> = { ...(opts.headers ?? {}) };
// DO NOT set content-type manually for multipart; fetch will set boundary.

try {
const resp = await fetch(url, {
method: "POST",
headers,
body: opts.form,
signal: controller.signal,
redirect: opts.redirect ?? "follow"
});

    const respHeaders = toHeaders(resp);
    const raw = await resp.text();
    const parsed = raw ? tryParseJson(raw) : undefined;

    if (!resp.ok) {
      return {
        ok: false,
        status: resp.status,
        error: `HTTP_${resp.status}`,
        detail: parsed ?? raw,
        headers: respHeaders
      };
    }

    const expect = opts.expect ?? "json";
    if (expect === "text") {
      return { ok: true, status: resp.status, data: raw, headers: respHeaders };
    }
    return { ok: true, status: resp.status, data: parsed ?? raw, headers: respHeaders };

} catch (e: any) {
const msg =
e?.name === "AbortError"
? `TIMEOUT after ${opts.timeoutMs}ms`
: (e?.message ?? String(e));
return { ok: false, status: 0, error: "NETWORK_ERROR", detail: msg, headers: {} };
} finally {
clearTimeout(t);
}
}

✅ Update 2: Add tools for the routers you just pasted

You posted:

    /me/projects/summary

    /pipeline/phases, /pipeline/run

    /files/* (including admin endpoints + multipart upload)

    /documents/*

So we add 4 new tool files and register them.
src/tools/projects.ts (NEW)

import { z } from "zod";
import { httpRequest } from "../http.js";
import type { GlassboxMcpConfig } from "../config.js";
import { parseExtraHeaders } from "../config.js";

export function registerProjectsTools(server: any, cfg: GlassboxMcpConfig) {
const extra = parseExtraHeaders(cfg.apiExtraHeadersJson);

const baseHeaders = () => {
const h: Record<string, string> = { ...extra };
if (cfg.apiAuthValue) h[cfg.apiAuthHeader] = cfg.apiAuthValue;
return h;
};

const api = (path: string) =>
`${cfg.apiBaseUrl.replace(/\/$/, "")}${cfg.apiPrefix}${path}`;

server.tool(
"projects.my_summary",
"Get current user's project summary (GET /me/projects/summary).",
z.object({}),
async () => {
const r = await httpRequest("GET", api("/me/projects/summary"), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);
}

src/tools/pipeline.ts (NEW)

import { z } from "zod";
import { httpRequest } from "../http.js";
import type { GlassboxMcpConfig } from "../config.js";
import { parseExtraHeaders } from "../config.js";

export function registerPipelineTools(server: any, cfg: GlassboxMcpConfig) {
const extra = parseExtraHeaders(cfg.apiExtraHeadersJson);

const baseHeaders = () => {
const h: Record<string, string> = { ...extra };
if (cfg.apiAuthValue) h[cfg.apiAuthHeader] = cfg.apiAuthValue;
return h;
};

const api = (path: string) =>
`${cfg.apiBaseUrl.replace(/\/$/, "")}${cfg.apiPrefix}${path}`;

server.tool(
"pipeline.list_phases",
"List available pipeline phases (GET /pipeline/phases).",
z.object({}),
async () => {
const r = await httpRequest("GET", api("/pipeline/phases"), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

const RunPhaseOptions = z.object({
indication: z.string().optional(),
chembl_csv: z.string().optional(),
database_directory: z.string().optional(),
chunk_size: z.number().int().positive().default(50000),
streaming_p2: z.boolean().default(false),
streaming_topk: z.boolean().default(false),
topk_per_batch: z.number().int().positive().default(100),
global_topk: z.number().int().positive().default(2000),
instructions: z.string().optional(),
skip_crew_evidence: z.boolean().default(false),
quiet: z.boolean().default(false)
});

const RunPhaseRequest = z.object({
project_id: z.string().min(1),
phase: z.string().min(1), // backend validates against PHASE_CHOICES
options: RunPhaseOptions.default({})
});

server.tool(
"pipeline.run_phase",
"Run a TNaaS pipeline phase via API (POST /pipeline/run). Requires approval at gateway level.",
RunPhaseRequest,
async (args: any) => {
const r = await httpRequest("POST", api("/pipeline/run"), {
headers: baseHeaders(),
json: args,
timeoutMs: cfg.longTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);
}

src/tools/files.ts (NEW)

This wraps:

    POST /files/upload (multipart)

    GET /files (list)

    GET /files/{file_id}

    GET /files/{file_id}/download (redirect → signed URL)

    DELETE /files/{file_id}

    Admin:

        GET /files/admin/list?prefix=

        POST /files/admin/download-url

        DELETE /files/admin/delete?key=...

import { z } from "zod";
import { httpRequest, httpMultipart } from "../http.js";
import type { GlassboxMcpConfig } from "../config.js";
import { parseExtraHeaders } from "../config.js";

function stripBase64Prefix(b64: string): string {
// Accept plain base64 OR data URL: data:<mime>;base64,xxxx
const idx = b64.indexOf("base64,");
if (idx >= 0) return b64.slice(idx + "base64,".length);
return b64;
}

export function registerFilesTools(server: any, cfg: GlassboxMcpConfig) {
const extra = parseExtraHeaders(cfg.apiExtraHeadersJson);

const baseHeaders = () => {
const h: Record<string, string> = { ...extra };
if (cfg.apiAuthValue) h[cfg.apiAuthHeader] = cfg.apiAuthValue;
return h;
};

const api = (path: string) =>
`${cfg.apiBaseUrl.replace(/\/$/, "")}${cfg.apiPrefix}${path}`;

// Upload file: wrap multipart endpoint with base64 payload in MCP
const UploadSchema = z.object({
filename: z.string().min(1),
content_base64: z.string().min(8),
content_type: z.string().min(1).default("application/octet-stream"),

    category: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(), // will be joined by commas
    submission_id: z.string().optional(),
    job_id: z.string().optional(),
    project_id: z.string().optional()

});

server.tool(
"files.upload_file",
"Upload a file to /files/upload (multipart). Requires approval at gateway level.",
UploadSchema,
async (args: any) => {
const b64 = stripBase64Prefix(args.content_base64);
const bytes = Buffer.from(b64, "base64");

      // Defensive: keep this reasonable in-chat. Backend caps at 50MB; we cap earlier.
      const MAX = 25 * 1024 * 1024; // 25MB (adjust if you want)
      if (bytes.byteLength > MAX) {
        return {
          content: [{
            type: "json",
            json: {
              ok: false,
              error: "FILE_TOO_LARGE_FOR_MCP",
              detail: `Refusing to upload ${bytes.byteLength} bytes via MCP. Increase MAX or use the web UI uploader.`,
              maxBytes: MAX
            }
          }]
        };
      }

      const form = new FormData();
      const blob = new Blob([bytes], { type: args.content_type });
      form.append("file", blob, args.filename);

      if (args.category) form.append("category", args.category);
      if (args.description) form.append("description", args.description);
      if (args.tags?.length) form.append("tags", args.tags.join(","));
      if (args.submission_id) form.append("submission_id", args.submission_id);
      if (args.job_id) form.append("job_id", args.job_id);
      if (args.project_id) form.append("project_id", args.project_id);

      const r = await httpMultipart(api("/files/upload"), {
        headers: baseHeaders(),
        form,
        timeoutMs: cfg.longTimeoutMs,
        expect: "json"
      });

      return { content: [{ type: "json", json: r }] };
    }

);

// List user files
server.tool(
"files.list",
"List current user's uploaded files (GET /files) with optional filters.",
z.object({
category: z.string().optional(),
submission_id: z.string().optional(),
job_id: z.string().optional(),
project_id: z.string().optional()
}),
async (args: any) => {
const qs = new URLSearchParams();
for (const k of ["category", "submission_id", "job_id", "project_id"] as const) {
if (args[k]) qs.set(k, args[k]);
}
const url = qs.toString() ? `${api("/files")}?${qs}` : api("/files");

      const r = await httpRequest("GET", url, {
        headers: baseHeaders(),
        timeoutMs: cfg.httpTimeoutMs,
        expect: "json"
      });

      return { content: [{ type: "json", json: r }] };
    }

);

server.tool(
"files.get_metadata",
"Get file metadata by file_id (GET /files/{file_id}).",
z.object({ file_id: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("GET", api(`/files/${encodeURIComponent(args.file_id)}`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

// Download URL: this endpoint redirects to a signed URL. We want the Location header.
server.tool(
"files.get_download_url",
"Get a signed download URL for a file (calls GET /files/{id}/download with redirect=manual and returns Location).",
z.object({ file_id: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("GET", api(`/files/${encodeURIComponent(args.file_id)}/download`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "text",
redirect: "manual"
});

      if (!r.ok) return { content: [{ type: "json", json: r }] };

      const location = (r.headers["location"] ?? "").trim();
      return {
        content: [{
          type: "json",
          json: {
            ok: true,
            status: r.status,
            location: location || null,
            note: location ? "Use this signed URL to download directly." : "No Location header; server may have returned inline content."
          }
        }]
      };
    }

);

server.tool(
"files.delete_file",
"Delete a file by file_id (DELETE /files/{file_id}). Requires approval at gateway level.",
z.object({ file_id: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("DELETE", api(`/files/${encodeURIComponent(args.file_id)}`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "text"
});
return { content: [{ type: "json", json: r }] };
}
);

// Admin list
server.tool(
"files.admin_list",
"Admin: list bucket keys with enrichment (GET /files/admin/list?prefix=...).",
z.object({ prefix: z.string().optional().default("") }),
async (args: any) => {
const qs = new URLSearchParams();
if (args.prefix) qs.set("prefix", args.prefix);
const url = qs.toString() ? `${api("/files/admin/list")}?${qs}` : api("/files/admin/list");

      const r = await httpRequest("GET", url, {
        headers: baseHeaders(),
        timeoutMs: cfg.httpTimeoutMs,
        expect: "json"
      });
      return { content: [{ type: "json", json: r }] };
    }

);

server.tool(
"files.admin_get_download_url",
"Admin: get a signed URL for a storage key (POST /files/admin/download-url).",
z.object({ key: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("POST", api("/files/admin/download-url"), {
headers: baseHeaders(),
json: { key: args.key },
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"files.admin_delete_key",
"Admin: delete a storage key (DELETE /files/admin/delete?key=...). Requires approval at gateway level.",
z.object({ key: z.string().min(1) }),
async (args: any) => {
const qs = new URLSearchParams({ key: args.key });
const r = await httpRequest("DELETE", `${api("/files/admin/delete")}?${qs}`, {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "text"
});
return { content: [{ type: "json", json: r }] };
}
);
}

src/tools/documents.ts (NEW)

import { z } from "zod";
import { httpRequest } from "../http.js";
import type { GlassboxMcpConfig } from "../config.js";
import { parseExtraHeaders } from "../config.js";

export function registerDocumentsTools(server: any, cfg: GlassboxMcpConfig) {
const extra = parseExtraHeaders(cfg.apiExtraHeadersJson);

const baseHeaders = () => {
const h: Record<string, string> = { ...extra };
if (cfg.apiAuthValue) h[cfg.apiAuthHeader] = cfg.apiAuthValue;
return h;
};

const api = (path: string) =>
`${cfg.apiBaseUrl.replace(/\/$/, "")}${cfg.apiPrefix}${path}`;

server.tool(
"documents.get_by_slug",
"Fetch a document by slug (GET /documents/{slug}).",
z.object({ slug: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("GET", api(`/documents/${encodeURIComponent(args.slug)}`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"documents.admin_list",
"Admin: list documents (GET /documents/).",
z.object({}),
async () => {
const r = await httpRequest("GET", api("/documents/"), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"documents.admin_create",
"Admin: create a document (POST /documents/). Requires approval at gateway level.",
z.object({
slug: z.string().min(1),
title: z.string().min(1),
content: z.any()
}),
async (args: any) => {
const r = await httpRequest("POST", api("/documents/"), {
headers: baseHeaders(),
json: { slug: args.slug, title: args.title, content: args.content },
timeoutMs: cfg.httpTimeoutMs,
expect: "json"
});
return { content: [{ type: "json", json: r }] };
}
);

server.tool(
"documents.admin_update",
"Admin: patch a document by document_id (PATCH /documents/{document_id}). Requires approval at gateway level.",
z.object({
document_id: z.string().min(1),
title: z.string().optional(),
content: z.any().optional()
}),
async (args: any) => {
const patch: any = {};
if (args.title !== undefined) patch.title = args.title;
if (args.content !== undefined) patch.content = args.content;

      const r = await httpRequest("PATCH", api(`/documents/${encodeURIComponent(args.document_id)}`), {
        headers: baseHeaders(),
        json: patch,
        timeoutMs: cfg.httpTimeoutMs,
        expect: "json"
      });
      return { content: [{ type: "json", json: r }] };
    }

);

server.tool(
"documents.admin_delete",
"Admin: delete a document by document_id (DELETE /documents/{document_id}). Requires approval at gateway level.",
z.object({ document_id: z.string().min(1) }),
async (args: any) => {
const r = await httpRequest("DELETE", api(`/documents/${encodeURIComponent(args.document_id)}`), {
headers: baseHeaders(),
timeoutMs: cfg.httpTimeoutMs,
expect: "text"
});
return { content: [{ type: "json", json: r }] };
}
);
}

✅ Update 3: Register the new tools in the MCP server
src/index.ts (REPLACE with this)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { loadConfigFromEnv } from "./config.js";

import { registerOrchestratorTools } from "./tools/orchestrator.js";
import { registerBlogTools } from "./tools/blog.js";
import { registerReportsTools } from "./tools/reports.js";
import { registerIntakeTools } from "./tools/intake.js";
import { registerContactTools } from "./tools/contact.js";

import { registerProjectsTools } from "./tools/projects.js";
import { registerPipelineTools } from "./tools/pipeline.js";
import { registerFilesTools } from "./tools/files.js";
import { registerDocumentsTools } from "./tools/documents.js";

async function main() {
const cfg = loadConfigFromEnv();

const server = new McpServer({
name: "glassbox-mcp",
version: "0.2.0"
});

// Core tools (from your earlier paste)
registerOrchestratorTools(server, cfg);
registerBlogTools(server, cfg);
registerReportsTools(server, cfg);
registerIntakeTools(server, cfg);
registerContactTools(server, cfg);

// New tools (from your latest paste)
registerProjectsTools(server, cfg);
registerPipelineTools(server, cfg);
registerFilesTools(server, cfg);
registerDocumentsTools(server, cfg);

// Minimal health/ping
server.tool("glassbox.ping", "Ping Glassbox MCP server.", z.object({}), async () => {
return { content: [{ type: "json", json: { ok: true, service: "glassbox-mcp", version: "0.2.0" } }] };
});

const transport = new StreamableHTTPServerTransport({ endpoint: cfg.mcpPath });
await server.connect(transport);

const http = await import("node:http");
const srv = http.createServer(async (req, res) => {
// Inbound auth: keep MCP private
const key = req.headers[cfg.inboundApiKeyHeader.toLowerCase()] as string | undefined;
if (!key || key !== cfg.inboundApiKeyValue) {
res.statusCode = 401;
res.setHeader("content-type", "application/json");
res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
return;
}

    try {
      await transport.handleRequest(req, res);
    } catch (e: any) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "MCP_SERVER_ERROR", detail: e?.message ?? String(e) }));
    }

});

srv.listen(cfg.port, () => {
console.log(`glassbox-mcp listening on :${cfg.port}${cfg.mcpPath}`);
});
}

main().catch((e) => {
console.error(e);
process.exit(1);
});

✅ Update 4: Make sure your Operator Gateway treats uploads as “write”

In the gateway classifier I gave earlier, add "upload" to the write verbs list so these tools get approval-gated:

const writeVerbs = [
"create", "update", "delete", "remove", "set", "deploy", "rollback",
"publish", "send", "post", "merge", "close", "open", "restart", "scale",
"rotate", "invalidate", "trigger", "upload" // <-- add this
];

Environment variables (Glassbox MCP)

Use these (examples):

export PORT=8080
export GB_MCP_PATH="/mcp"
export GB_MCP_INBOUND_KEY="super_long_random_shared_secret_32+"
export GB_MCP_INBOUND_KEY_HEADER="x-gb-mcp-key"

# Your two services

export GB_ORCHESTRATOR_BASE_URL="https://YOUR-ORCHESTRATOR-SERVICE"
export GB_API_BASE_URL="https://api.glassbox-bio.com"
export GB_API_PREFIX="/api/v1"

# Auth to call your backend (admin JWT or service token)

export GB_API_AUTH_HEADER="Authorization"
export GB_API_AUTH_VALUE="Bearer YOUR_ADMIN_JWT"

# Optional

export GB_HTTP_TIMEOUT_MS=120000
export GB_LONG_TIMEOUT_MS=900000

Then:

npm i
npm run build
npm start

Where this lands (your single-app control layer)

    Your ChatGPT App activates only one app: the Operator.

    Operator calls upstream MCP servers:

        vercel.*

        gcp.*

        github.*

        glassbox.* (this server)

Now you can do things like:

    “Run P5 for project X” → glassbox.pipeline.run_phase or glassbox.orchestrator.trigger_phase

    “Upload this CSV to project Y” → glassbox.files.upload_file

    “List my projects” → glassbox.projects.my_summary

    “Draft + publish a blog post, then deploy” → glassbox.blog.create_post + vercel.deploy... (with approval gates)

If you want the next step (high leverage)

The next step isn’t more endpoints — it’s composite operator actions (still one app), like:

    ops.publish_blog_and_deploy

    ops.run_pipeline_and_attach_results

    ops.create_report_summary_post

These are bundled workflows that call multiple tools in sequence inside the gateway, with one approval. That’s where it starts to feel like a real operator.

If you want, tell me which 2–3 workflows you run most often and I’ll implement those composites in the gateway layer cleanly.
You said:
no we need to start with the crm and clientelling operations. - clay, airtable, email , linked in,
ChatGPT said:

CAN: Got it — start with CRM + clienteling ops (Clay, Airtable, email, LinkedIn) and make one ChatGPT App that acts as the control layer and can call multiple MCP servers behind the scenes.

Given how new the ChatGPT Apps App Store / App Directory is, the winning move isn’t “another CRM assistant.” It’s: an operator that actually runs your revenue system end-to-end (data → enrichment → outreach → follow-ups → logging → pipeline hygiene → reporting), with you as the approval gate on anything risky.

OpenAI’s Apps SDK is explicitly designed for this pattern (an app can connect to external tools via MCP and also render UI components).
OpenAI Help Center+3OpenAI+3OpenAI Platform+3

Below is a tight, buildable proposal that’s useful even if OpenAI improves “Pulse” or general CRM features, because it’s anchored in: your data model + your playbooks + your actions.
The App: “Revenue Operator” (one app, many capabilities)
What it does (V1 scope, high ROI, low bloat)

    System of record in Airtable

        Accounts / Contacts / Opportunities / Interactions / Tasks.

    Enrichment & list building via Clay

        Turn “company + role” into verified person records and context.

    Email outreach + follow-up autopilot

        Drafts + sends (with your approval rules).

    LinkedIn assist (compliance-safe)

        Draft connection notes, DM drafts, post drafts, and “open in LinkedIn” deep links.

        Avoid automation that risks your account.

You can absolutely build this as a private app for yourself/workspace first (custom apps are supported; “developer mode” exists for testing and deployment in workspace environments).
OpenAI Help Center+1
Why this is the right starting wedge (vs Pulse-related stuff)

Pulse is a feed/briefing layer and OpenAI will iterate fast. Pulse already supports “save for later” and follow-ups as a concept.
OpenAI Help Center+1

But revenue ops is harder for OpenAI to “just ship,” because it’s:

    highly business-specific

    needs write access (CRM updates, sequences, tasks)

    depends on your ICP + your offer + your deal stages

    lives in your proprietary pipeline + playbooks

So you get durability.
Architecture: One ChatGPT App → One “Gateway MCP” → many MCPs
Control-layer pattern (your exact ask)

Your ChatGPT App should expose a small set of “operator tools” (stable API), and the server implements those tools by calling:

    Clay MCP server (official exists)
    GitHub+1

    Airtable MCP server (multiple exist)
    Awesome MCP Servers+1

    Gmail MCP server (multiple exist)
    Glama – MCP Hosting Platform+2LobeHub+2

    LinkedIn: strongly recommend drafting + official posting only, not scraping/automation.

This keeps your app as the orchestration brain, not a pile of one-off integrations.
The MCP choices that fit your stack
Airtable

There are already MCP servers that do schema discovery + CRUD against Airtable.
Awesome MCP Servers+1

For your use case (CRM), Airtable is perfect as the “truth layer.”
Clay

Clay has an official MCP server repo and Clay has announced MCP support.
GitHub+1

Clay becomes your enrichment + research “factory.”
Email (Gmail)

There are MCP servers that support read/write/send (with OAuth or app-password patterns depending on implementation).
LobeHub+2Docker Hub+2

For revenue ops, Gmail actions matter: search threads, label, draft reply, send, log.
LinkedIn (be careful)

LinkedIn explicitly prohibits many forms of third‑party automation/bots/scraping of the website.
LinkedIn

Even if there are “LinkedIn MCP servers” floating around, many rely on scraping flows that can put your account at risk.

Safe approach for V1:

    Use LinkedIn only for:

        drafting messages/posts in your app

        optionally posting via official APIs if you have access to the right scopes

        “open LinkedIn profile / open compose window” links for manual send

LinkedIn’s official docs exist for creating shares/posts (UGC/Posts APIs).
Microsoft Learn+1

Messaging APIs are commonly restricted/partner-gated in practice (so don’t build your system assuming you’ll get it).
LinkedIn+2Stack Overflow+2
Airtable CRM schema that makes the operator actually work

If you don’t nail the schema, the agent will hallucinate structure or you’ll drown in edge cases. Here’s a minimal-but-powerful base:

1. Accounts

   account_id (stable id)

   name, domain, industry

   ICP_fit (A/B/C)

   source (Clay / referral / inbound / LinkedIn)

   status (Target / Active / Dormant / Disqualified)

   last_touch_at, next_touch_at

2. Contacts

   contact_id

   account_id (link)

   name, title, email, linkedin_url

   persona (Buyer / Influencer / Champion)

   relationship_strength (1–5)

   last_replied_at

   notes

3. Opportunities

   opp_id

   account_id

   stage (Prospecting → Qualified → Proposal → Negotiation → Closed Won/Lost)

   value_est, probability, close_date_est

   primary_contact_id

   next_step, next_step_due

   blockers

4. Interactions (the lifeblood)

   interaction_id

   contact_id, account_id, opp_id

   channel (Email / Call / LinkedIn / Meeting)

   timestamp

   summary

   outcome (Positive/Neutral/Negative)

   followup_needed (Y/N)

   followup_task_id

5. Tasks

   task_id

   type (Follow-up / Research / Draft / Send / Update CRM)

   owner (you)

   due_date

   status

   linked_contact/opp

This is enough to support: daily pipeline review, follow-up automation, stuck-deal detection, and “next best action.”
The “Operator Tools” your single app should expose (V1)

These are the few, composable primitives that replace 100 tiny commands:

    capture_lead()

        Input: name/company/link/email snippet

        Output: creates/updates Airtable records + returns a “lead card”

    enrich_lead_with_clay()

        Input: contact/account ids

        Output: firmographics, role, verified email, notes → writes back to Airtable

    generate_outreach_assets()

        Input: contact_id + goal (“book intro call”, “revive dormant”)

        Output: 3-email sequence + 2 LinkedIn drafts + objection angles (stored as artifacts)

    send_or_schedule_email()

        Input: draft + rules (send now vs schedule)

        Output: sent message id + logs Interaction + updates next_touch_at

    log_interaction()

        Input: raw email thread/call notes

        Output: interaction record + suggested next task

    daily_revenue_brief()

        Output: dashboard (stuck opps, overdue followups, high-intent replies, top next actions)

This is the control layer you described: stable “operator API,” while the backend calls Airtable/Clay/Gmail MCPs.
Guardrails so it doesn’t burn you

You want “agentic,” but sales channels are brittle. Here’s the safety model that still feels fast:
Auto-allowed (no approval)

    read CRM

    create/update notes

    create tasks

    generate drafts

    enrich in Clay (rate-limited)

Approval required (one-click approve in UI)

    send email

    bulk updates (e.g., modify 50 contacts)

    stage changes (Qualified → Proposal)

    anything that could spam or corrupt pipeline

LinkedIn: default to “draft + deep link”

Because LinkedIn bans many automation behaviors and third-party scraping tools.
LinkedIn

So: your app generates the perfect message, then you manually hit send.
How this becomes a ChatGPT App (realistically)

OpenAI’s Apps SDK is built on MCP and supports creating an app that connects to tools + can render UI components.
OpenAI+2OpenAI Developers+2

And OpenAI explicitly documents building MCP servers for ChatGPT “connectors/apps.”
OpenAI Platform+1

So your path is:

    Deploy Gateway MCP (your server) to a stable HTTPS endpoint

    Configure the app in ChatGPT developer mode / workspace

    Add a lightweight UI:

        “Lead card”

        “Approve send” button

        “Pipeline snapshot” widget

That’s enough to feel like “Jarvis for revenue.”
What I’d build first (V1 that immediately pays for itself)
Week 1: CRM core + enrichment loop

    Airtable base schema + MCP connection

    capture_lead() + enrich_lead_with_clay()

    “Lead card” UI (shows completeness, ICP score, recommended next step)

Week 2: Outreach loop

    generate_outreach_assets()

    Gmail integration for draft + send + log interaction

    “Approval UI” for sending + scheduling follow-ups

Week 3: Daily operator mode

    daily_revenue_brief() widget

    stuck-deal detection

    “today’s 10 actions” list

LinkedIn stays draft-only until you’re 100% sure you want to pursue official API access (posting is easier; messaging is usually the hard part).
Microsoft Learn+2Stack Overflow+2
If you want, I can turn this into an exact build spec

If you tell me just two things, I can produce a precise, build-ready technical spec (and then full code when you say “write it”):

    Are you on Gmail / Google Workspace (vs Outlook)?

    Do you already have an Airtable base for CRM, or are we creating it fresh?

(If you don’t answer, I’ll assume Gmail + fresh Airtable base, which is the fastest path.)
Recent coverage of the new ChatGPT App Store
The ChatGPT app store is here
The Verge
The ChatGPT app store is here
2 days ago
The ChatGPT app store is now live - and these are the 5 apps you should try first
TechRadar
The ChatGPT app store is now live - and these are the 5 apps you should try first
2 days ago
Apple Music integration could be coming to ChatGPT - here's what we know
Tom's Guide
Apple Music integration could be coming to ChatGPT - here's what we know
3 days ago
MarketWatch
DoorDash joins Instacart in the newest shopping battleground - ChatGPT
3 days ago
ChatGPT can now use Adobe apps to edit your photos and PDFs for free
The Verge
ChatGPT can now use Adobe apps to edit your photos and PDFs for free
10 days ago
OpenAI launches ChatGPT App Store: Here's what it means for developers and users
timesofindia.indiatimes.com
OpenAI launches ChatGPT App Store: Here's what it means for developers and users
Yesterday
You said:
This is all supposed to be added to the app from earlier.
ChatGPT said:

CAN: Got it — we’ll keep the single “control-layer” ChatGPT App from earlier, but shift v1 to CRM + clienteling ops (Clay + Airtable + email + LinkedIn), and then later plug in Vercel/GCP/GitHub + your Glassbox backend ops.

This aligns with how the new ChatGPT Apps SDK is designed: you ship (1) a web UI component + (2) one MCP server that exposes tools to ChatGPT.
OpenAI Developers+2OpenAI Developers+2
The right “single app” shape: Founder Revenue OS (CRM-first)
Key idea

Your ChatGPT App is the operator console.
It’s not “an Airtable app” or “a Clay app.” It’s a workflow brain that:

    keeps Airtable as your system-of-record

    uses Clay for enrichment + research bursts

    uses Email for outreach + reply triage + follow-ups

    uses LinkedIn in a compliant way (drafts + assist, not botting)

…and later, the same app also runs DevOps + product ops (Vercel/GCP/GitHub + Glassbox pipelines).

This is the “Tony Stark assistant” as a control layer, not a bunch of one-off connectors.
Architecture update: same Operator Gateway, new CRM “cluster”
Layer 1 — ChatGPT App UI (web component)

A tabbed console inside ChatGPT:

    Leads Inbox (new inbound + outbound targets)

    Account Brief (company + people + why-now + deal notes)

    Outreach Studio (email + LinkedIn drafts + sequences)

    Pipeline Board (stages + next actions)

    Approvals Queue (anything that sends or mutates data)

(You can still keep “Ops / Engineering / Deployments” tabs — just not in v1.)
Layer 2 — Your one MCP server (“Operator Gateway”)

This is the only app-enabled MCP server ChatGPT talks to.
Inside it you do two things:

    Proxy upstream MCP servers (Clay, Airtable, Gmail)

    Provide composite tools like crm.enrich_and_score_lead that call multiple systems in one shot.

OpenAI explicitly expects an Apps SDK app to be exposed via an MCP server, and recommends Streamable HTTP.
OpenAI Developers+1
Layer 3 — Upstream systems (via MCP)

    Clay MCP (official): clay-inc/clay-mcp
    GitHub

    Airtable MCP (packaged server): mcp/airtable-mcp-server
    Docker Hub+1

    Email MCP (pick one approach):

        Gmail MCP servers exist (community)
        GitHub+2GitHub+2

        or you implement a minimal internal “email tool” yourself later (more control, less dependency)

    LinkedIn: no “real automation” in v1 (details below)

What we build first: CRM + clienteling workflows that actually compound

If this is for you (not the public) the winning move is:
tight loop: capture → enrich → pick angle → draft → send → log → follow up automatically.
Core v1 workflows (high adoption for you, low build complexity)

1. Lead capture (inbound + outbound)

Inputs:

    a LinkedIn URL

    an email

    a domain

    a “company + role” string

    inbound form submissions from your own backend (optional)

Outputs:

    Airtable Contact + Account created/updated

    a “Next Action” task created

Composite tool: crm.capture_lead 2) Enrich + score (Clay → Airtable)

    Ask Clay for:

        role validation, company size, funding, tech stack, recent signals, etc.

    Compute a Founder-fit score (your rubric)

    Store the entire “why I should care” snapshot in Airtable

Composite tool: crm.enrich_and_score_lead

    This is where your advantage is: you’re not “doing enrichment.”
    You’re producing a decision-ready brief + next action.

3. Outreach studio (multi-channel drafts)

For each lead, generate:

    2 cold emails (different angles)

    1 warm email (if there’s an intro path)

    1 LinkedIn DM draft

    1 “follow-up if no reply in 3 days” draft

Store drafts in Airtable + show in UI.

Composite tool: crm.generate_outreach_pack 4) Send + log (email) with human approval

    Create a draft

    require explicit approval before sending

    log the sent message back into Airtable (touchpoint history)

Composite tool: crm.send_email_with_logging 5) Reply triage → tasks

    Pull last N threads with “open loops”

    Classify replies: hot / warm / objection / scheduling / ignore

    Create tasks + suggested response drafts

Composite tool: crm.triage_replies 6) Daily “Revenue Brief” (your Pulse-like feed, but actionable)

Every morning (or on-demand):

    leads to contact today

    deals stuck too long

    follow-ups due

    warm signals detected (funding, hiring, new posts)

Composite tool: crm.daily_brief

This mirrors why you like Pulse, but it’s your pipeline + next actions, not just content.
Airtable schema that won’t paint you into a corner

Keep Airtable simple but “operator-friendly.”

Tables

    Accounts

    People

    Opportunities

    Touchpoints (email/LI/call logs)

    Tasks

    Drafts (email + LI messages + sequences)

    Signals (Clay/web-sourced events)

Important fields

    People: email, linkedin_url, title, account, persona, score, status

    Accounts: domain, industry, size, priority, notes

    Tasks: type, due_date, owner, status, linked_record

    Touchpoints: channel, timestamp, summary, thread_id

This structure is what makes your “single app” feel like an OS.
LinkedIn: how to include it without getting you banned

LinkedIn is extremely sensitive to automation (scraping, bots, auto-messaging). Their policies explicitly prohibit certain automated activity and “software” behaviors.
LinkedIn+1

So v1 LinkedIn integration should be:
✅ Safe / high leverage

    Draft generation (DMs, comments, posts)

    Message personalization based on the lead brief

    “Copy-ready” + “Open LinkedIn” actions

    Follow-up reminders if you didn’t send

    Post ideation + weekly content calendar

⚠️ Only if you have approved access

If you’re approved for the official LinkedIn APIs (harder than most people expect), you can do limited posting / org actions depending on your permissions.
LinkedIn
❌ Avoid

    scraping profiles automatically

    auto-sending DMs

    automating connection requests

The app can still dominate without those.
How this connects to “the app from earlier” (your full control layer)

You now have two clusters inside one Operator app:
Cluster A: Revenue Ops (v1)

    Clay MCP
    GitHub

    Airtable MCP
    Docker Hub+1

    Email MCP (Gmail)
    GitHub+2GitHub+2

    LinkedIn Draft tools (no API automation)

Cluster B: Product + Engineering Ops (v2)

    Vercel MCP

    Google Cloud MCP

    GitHub MCP

    Glassbox MCP (wrapping your FastAPI routers you pasted)

Your earlier instinct was correct: one app, one control plane, multiple tool backends.
The “not-obvious” wedge that won’t get obsoleted quickly

You were worried about building something OpenAI will just bake into Pulse.

So don’t build “a nicer Pulse.” Build what OpenAI won’t ship as a generic feature:

A founder-specific Revenue Operator that:

    owns your CRM schema

    has your scoring rubric

    produces your outreach angles

    logs your touchpoints

    enforces your follow-up discipline

    and connects to your proprietary backend + data (Glassbox)

Even if Pulse improves, your compounding advantage is the closed loop across systems + your proprietary context.

Also: OpenAI has now added Tasks in Pulse (which hints exactly where they’re going), but Tasks ≠ a CRM control plane.
OpenAI Help Center
Concrete proposal: the first 10 tools to define in the Operator Gateway

If we keep it tight, I’d start with exactly these (names are illustrative):

    crm.capture_lead

    crm.upsert_account

    crm.enrich_person_clay

    crm.score_lead

    crm.generate_outreach_pack

    crm.create_email_draft

    crm.send_email_with_logging

    crm.sync_email_threads

    crm.triage_replies

    crm.daily_brief

Everything else is “nice later.”
Your next best move (decision, not questions)

Make v1 a Founder Revenue Cockpit with:

    Airtable as truth

    Clay enrichment

    Email send + logging (approval-gated)

    LinkedIn drafts (copy/paste workflow)

    Daily brief

Then we bolt on:

    inbound leads from your website backend (your routers)

    content marketing automation (your blog router)

    devops automation (Vercel/GCP/GitHub)

That sequencing compounds fastest.

turn2news16,turn2news17,turn2news18
You said:
I need the code for all of this

You now have two clusters inside one Operator app:

Cluster A: Revenue Ops (v1)

Clay MCP
GitHub

Airtable MCP
Docker Hub
+1

Email MCP (Gmail)
GitHub
+2
GitHub
+2

LinkedIn Draft tools (no API automation)

Cluster B: Product + Engineering Ops (v2)

Vercel MCP

Google Cloud MCP

GitHub MCP

Glassbox MCP (wrapping your FastAPI routers you pasted)

Your earlier instinct was correct: one app, one control plane, multiple tool backends.

Cluster A: Revenue Ops (v1)

Clay MCP
GitHub

Airtable MCP
Docker Hub
+1

Email MCP (Gmail)
GitHub
+2
GitHub
+2

LinkedIn Draft tools (no API automation)

Cluster B: Product + Engineering Ops (v2)

Vercel MCP

Google Cloud MCP

GitHub MCP
