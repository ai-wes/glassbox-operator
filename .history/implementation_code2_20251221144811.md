ChatGPT said:

Yes — that’s the right architecture: one private ChatGPT App whose own MCP server is a control-plane / router, and it can call out to multiple upstream MCP servers (Vercel, Google Cloud, GitHub, plus your custom “Glassbox MCP”). That keeps you in one app context while still getting “Tony Stark operator” power.

This pattern is basically an MCP Gateway: a single MCP endpoint that federates many MCP endpoints behind it. (The idea shows up explicitly in “MCP gateway” discussions, and it maps cleanly to how MCP tool calls work: ChatGPT calls one MCP server, which can then call other tools/services.)
OpenAI Platform+1

Below is a V1 implementation plan + a production-ready gateway skeleton you can run privately, plus a config-driven Glassbox MCP server you can extend once you paste your API endpoints.

1.  Target architecture
    You will run:

        ChatGPT App UI (single app)

        Operator MCP Gateway (single MCP server exposed to ChatGPT App)

        Upstream MCP servers (do not live inside your app):

            Vercel MCP
            Vercel+2Vercel+2

            Google Cloud MCP (host on Cloud Run if needed)
            Google Cloud Documentation+2Google Cloud Documentation+2

            GitHub MCP (either official/third-party, or your own)

            Glassbox MCP (your private tool surface for your backend HTTP actions)

Flow

ChatGPT App ⇄ Operator MCP Gateway ⇄ {Vercel MCP, GCP MCP, GitHub MCP, Glassbox MCP}

The gateway does:

    tool discovery aggregation

    tool naming + namespacing (so collisions never happen)

    policy checks / approval gates

    audit logs

    optional caching and rate-limits

    “safe mode” defaults

This is exactly aligned with MCP: “When the model decides to call an MCP tool, the API will call the remote MCP server tool and inject results into context.”
OpenAI Platform 2) Key design decisions (so this doesn’t become fragile)
A) Namespacing is non-negotiable

Every upstream tool becomes:

    vercel.<toolName>

    gcp.<toolName>

    github.<toolName>

    glassbox.<toolName>

So “deploy” can exist 4 times, safely.
B) Approval gates in the gateway (not in ChatGPT)

You want “agentic”, but not reckless.
So the gateway enforces:

    read-only tools auto-run

    write tools require explicit approval token (one-click in the app UI)

This gives you Level 2 autonomy (execute with approval) without relying on the model to behave.
C) You’ll run the gateway as your “single tool surface”

ChatGPT only sees one MCP server: Operator. Everything else is behind it. 3) Operator MCP Gateway — production-ready skeleton (TypeScript)

This uses the official MCP TypeScript SDK (@modelcontextprotocol/sdk) which explicitly supports Streamable HTTP and “McpServer + transport” patterns.
npm+2Model Context Protocol+2
What this gateway does today (V1)

    Connects to each upstream MCP server as an MCP client

    Pulls their tools/list

    Re-exports those tools with prefixes

    Proxies tools/call to the correct upstream

    Enforces a simple policy layer (read/write + approvals)

    Note: This is an MVP gateway. You can later add resource proxying, tool metadata shaping, caching, auth passthrough, etc.

package.json

{
"name": "glassbox-operator-mcp-gateway",
"private": true,
"type": "module",
"scripts": {
"dev": "node --watch dist/index.js",
"build": "tsc -p tsconfig.json",
"start": "node dist/index.js"
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

import { z } from "zod";

export const UpstreamConfig = z.object({
prefix: z.string().min(1), // e.g. "vercel"
url: z.string().url(), // e.g. "https://mcp.vercel.com/mcp"
// optional: headers for auth (Bearer, OAuth, etc.)
headers: z.record(z.string()).optional(),
// policy classification: is this upstream allowed to do writes?
allowWrites: z.boolean().default(false)
});

export const GatewayConfig = z.object({
port: z.number().int().positive().default(8787),
// if true, ALL tools require approval except those explicitly read-only
safeMode: z.boolean().default(true),
// a shared secret used by your App UI to approve actions
approvalSecret: z.string().min(16),

upstreams: z.array(UpstreamConfig).min(1)
});

export type GatewayConfigT = z.infer<typeof GatewayConfig>;

export function loadConfigFromEnv(): GatewayConfigT {
const raw = process.env.GB_OPERATOR_CONFIG_JSON;
if (!raw) throw new Error("Missing GB_OPERATOR_CONFIG_JSON env var (JSON config).");
const parsed = JSON.parse(raw);
return GatewayConfig.parse(parsed);
}

src/policy.ts

export type ToolPolicy = {
// If true, tool is considered “write” (needs approval).
isWrite: boolean;
};

/\*\*

- Heuristic classifier:
- - default: treat tools as write if name contains certain verbs
- - you can replace this with an explicit allowlist/denylist per tool later
    \*/
    export function classifyTool(toolName: string): ToolPolicy {
    const n = toolName.toLowerCase();
    const writeVerbs = [
    "create", "update", "delete", "remove", "set", "deploy", "rollback",
    "publish", "send", "post", "merge", "close", "open", "restart", "scale",
    "rotate", "invalidate", "trigger"
    ];
    const isWrite = writeVerbs.some(v => n.includes(v));
    return { isWrite };
    }

export function requireApproval(isWrite: boolean, safeMode: boolean): boolean {
if (!isWrite) return false;
return true; // always require approval for writes in V1
}

src/upstream.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export type Upstream = {
prefix: string;
client: Client;
url: string;
headers?: Record<string, string>;
allowWrites: boolean;
};

export async function connectUpstream(prefix: string, url: string, headers?: Record<string, string>, allowWrites = false): Promise<Upstream> {
const client = new Client({ name: `gb-operator-upstream-${prefix}`, version: "0.1.0" });

const transport = new StreamableHTTPClientTransport(new URL(url), {
headers: headers ?? {}
});

await client.connect(transport);
return { prefix, client, url, headers, allowWrites };
}

src/index.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { loadConfigFromEnv } from "./config.js";
import { connectUpstream, Upstream } from "./upstream.js";
import { classifyTool, requireApproval } from "./policy.js";

type ToolDef = {
name: string;
description?: string;
inputSchema?: any; // MCP uses JSON schema / zod-derived; keep passthrough for now
};

type ToolMapEntry = {
upstreamPrefix: string;
upstreamToolName: string;
toolDef: ToolDef;
isWrite: boolean;
};

function mkQualified(prefix: string, toolName: string) {
return `${prefix}.${toolName}`;
}

function isApproved(args: any, approvalSecret: string): boolean {
// Your App UI should inject this for write actions it approves.
// V1 is simple; later we can add per-tool one-time tokens, time-bounds, etc.
return Boolean(args && args.**approval && args.**approval === approvalSecret);
}

async function fetchTools(up: Upstream): Promise<ToolDef[]> {
const resp = await up.client.listTools();
return (resp.tools ?? []) as ToolDef[];
}

async function main() {
const cfg = loadConfigFromEnv();

// Connect all upstreams
const upstreams: Upstream[] = [];
for (const u of cfg.upstreams) {
upstreams.push(await connectUpstream(u.prefix, u.url, u.headers, u.allowWrites));
}

// Aggregate tool defs
const toolMap = new Map<string, ToolMapEntry>();

for (const up of upstreams) {
const tools = await fetchTools(up);
for (const t of tools) {
const qualified = mkQualified(up.prefix, t.name);
const { isWrite } = classifyTool(t.name);

      toolMap.set(qualified, {
        upstreamPrefix: up.prefix,
        upstreamToolName: t.name,
        toolDef: {
          ...t,
          name: qualified,
          description: t.description ? `[${up.prefix}] ${t.description}` : `[${up.prefix}]`
        },
        isWrite
      });
    }

}

// Expose a single MCP server to ChatGPT: the Operator Gateway
const server = new McpServer({
name: "glassbox-operator-gateway",
version: "0.1.0"
});

// Gateway introspection tool (helpful in-chat)
server.tool(
"operator.list_upstreams",
"List configured upstream MCP servers and tool counts.",
z.object({}),
async () => {
const counts: Record<string, number> = {};
for (const [name, entry] of toolMap.entries()) {
counts[entry.upstreamPrefix] = (counts[entry.upstreamPrefix] ?? 0) + 1;
}
return {
content: [{
type: "json",
json: {
upstreams: cfg.upstreams.map(u => ({ prefix: u.prefix, url: u.url, allowWrites: u.allowWrites })),
toolCounts: counts
}
}]
};
}
);

// Re-export every upstream tool as a gateway tool
for (const [qualifiedName, entry] of toolMap.entries()) {
const inputSchema = entry.toolDef.inputSchema ?? { type: "object", additionalProperties: true };

    server.tool(
      qualifiedName,
      entry.toolDef.description ?? "",
      // We accept any object. You can tighten this later by converting JSON schema to Zod.
      z.object({}).passthrough(),
      async (args: any) => {
        const needsApproval = requireApproval(entry.isWrite, cfg.safeMode);

        if (needsApproval && !isApproved(args, cfg.approvalSecret)) {
          return {
            content: [{
              type: "json",
              json: {
                error: "APPROVAL_REQUIRED",
                tool: qualifiedName,
                message: "This tool performs a write/action and requires approval. Provide __approval token from UI."
              }
            }]
          };
        }

        // Strip internal fields before forwarding
        const { __approval, ...forwardArgs } = (args ?? {});
        const up = upstreams.find(u => u.prefix === entry.upstreamPrefix);
        if (!up) throw new Error(`Upstream not found: ${entry.upstreamPrefix}`);

        // Call upstream tool
        const result = await up.client.callTool({
          name: entry.upstreamToolName,
          arguments: forwardArgs
        });

        // TODO: add audit logs here (tool, args summary, timestamp, success/failure)
        return result;
      }
    );

}

// Start Streamable HTTP transport
const transport = new StreamableHTTPServerTransport({ endpoint: "/mcp" });
await server.connect(transport);

// Minimal HTTP server (node built-in)
const http = await import("node:http");
const srv = http.createServer(async (req, res) => {
try {
await transport.handleRequest(req, res);
} catch (e: any) {
res.statusCode = 500;
res.end(`Gateway error: ${e?.message ?? String(e)}`);
}
});

srv.listen(cfg.port, () => {
console.log(`Glassbox Operator MCP Gateway listening on :${cfg.port}/mcp`);
});
}

main().catch((e) => {
console.error(e);
process.exit(1);
});

Why this is “correct”

    It uses the official SDK to create a server and connect via Streamable HTTP
    npm+2Model Context Protocol+2

    It matches OpenAI’s connector tool call mechanism (ChatGPT → remote MCP server tool call)
    OpenAI Platform

    It treats the gateway as a first-class control plane (approval + policy)

4. Config: wiring Vercel + GCP + GitHub + Glassbox

You set one env var: GB_OPERATOR_CONFIG_JSON

Example:

{
"port": 8787,
"safeMode": true,
"approvalSecret": "CHANGE_ME_TO_A_LONG_RANDOM_SECRET_32+",
"upstreams": [
{
"prefix": "vercel",
"url": "https://mcp.vercel.com/mcp",
"headers": {
"Authorization": "Bearer YOUR_VERCEL_OAUTH_OR_TOKEN"
},
"allowWrites": false
},
{
"prefix": "gcp",
"url": "https://YOUR_GCP_MCP_SERVER/mcp",
"headers": {
"Authorization": "Bearer YOUR_GCP_TOKEN"
},
"allowWrites": true
},
{
"prefix": "github",
"url": "https://YOUR_GITHUB_MCP_SERVER/mcp",
"headers": {
"Authorization": "Bearer YOUR_GITHUB_TOKEN"
},
"allowWrites": true
},
{
"prefix": "glassbox",
"url": "https://YOUR_GLASSBOX_MCP_SERVER/mcp",
"headers": {
"Authorization": "Bearer YOUR_GLASSBOX_MCP_TOKEN"
},
"allowWrites": true
}
]
}

Notes:

    Vercel’s official MCP is public beta and OAuth-based; it’s currently more read-oriented, but they’re expanding workflows.
    Vercel+1

    Google Cloud has explicit guidance for hosting MCP servers on Cloud Run.
    Google Cloud Documentation+2Google Cloud Documentation+2

5. Your “Glassbox MCP” (config-driven server)

You said: “I’ll drop server codes; build an MCP server that can call those APIs.”

That’s perfect. The cleanest way is:
Glassbox MCP = thin adaptor

    It exposes a set of tools that correspond to your HTTP endpoints

    It handles auth (service-to-service)

    It returns structured JSON (so the Operator can reason and take action)

    It never leaks secrets into chat

Best practice: define your internal API as an OpenAPI spec or a typed manifest, then auto-generate tool schemas. (We can do that once you paste endpoints.)

For now, we’ll do a robust placeholder that you can populate with an endpoints.json manifest (method/url/schema).

If you paste your backend routes next, I’ll convert them into proper tools in one pass. 6) What I need from you next (no “back and forth,” just drop it)

To generate the Glassbox MCP server concretely, paste either:
Option A (best): OpenAPI spec

    openapi.yaml or openapi.json

Option B (fine): HTTP routes list

For each route:

    name

    method

    path

    auth type (bearer? internal key? none?)

    request body shape

    response shape (or example)

Example:

POST /api/blog/publish
Auth: Bearer (internal)
Body: { title: string, slug: string, markdown: string, tags: string[] }
Returns: { post_id: string, url: string }

Then I’ll produce:

    glassbox-mcp/ server (Streamable HTTP /mcp)

    strong request validation (zod)

    safe logging

    rate-limits

    and an allowlist so only intended endpoints are callable

7. Immediate payoff: “single app” control layer is achieved

Once the Operator Gateway is connected inside your ChatGPT App:

    You stay in one app

    The model can call:

        vercel.* (deploy info / logs)

        gcp.* (Cloud Run health / logs / deploy)

        github.* (issues / PRs / commits)

        glassbox.* (publish blog / update site content / internal ops endpoints)

…and your gateway can enforce:

    approvals

    safety mode

    audit logs

That’s your “state-of-the-art execution layer” without building 4 separate apps.

If you paste your Glassbox API routes (or OpenAPI), I’ll generate the Glassbox MCP server next, and then we’ll wire it into the gateway config so glassbox.\* tools show up instantly.
You said:
"""
Minimal FastAPI wrapper around the TNaaS orchestrator.

Exposes a single endpoint to run any phase of the orchestrator
(scripts/streamlit/refactored_app_3.py) with the required flags
--project-id and --phase.

This version automatically downloads project data from Google Cloud Storage
before running the pipeline, and optionally uploads results back after completion.

Run locally:
PYTHONPATH=src uvicorn app.main:app --host 0.0.0.0 --port 8080

Request example:
POST /orchestrator/run
{
"project_id": "tnaas-demo",
"phase": "P5",
"extra_args": ["--no-cache"]
}

Response:
{
"ok": true,
"exit_code": 0,
"stdout": "...",
"stderr": "...",
"duration_sec": 123.4,
"cmd": "python -m scripts.streamlit.refactored_app_3 --project-id ..."
}

Environment Variables:
GCS_BUCKET: Google Cloud Storage bucket name (required for GCS sync)
TN_PROJECTS_DIR: Local directory for projects (default: /tmp/projects)
USE_CLOUD_STORAGE: Set to "1" to enable GCS download/upload (default: auto-detect from GCS_BUCKET)
"""
from **future** import annotations

import asyncio
import json
import os
import shlex
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import List, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Ensure orchestrator modules are importable when running inside container

# Force absolute /app/src first to avoid relative-path resolution failures in subprocess

os.environ["PYTHONPATH"] = "/app/src"

app = FastAPI(title="Glassbox Computational Target Diligence API", version="0.1.0")

app.add_middleware(
CORSMiddleware,
allow_origins=["*"],
allow_credentials=False,
allow_methods=["*"],
allow_headers=["*"],
)

class RunRequest(BaseModel):
project_id: str = Field(..., min_length=1, description="Project slug/id")
phase: str = Field(..., min_length=2, description="Phase code e.g. P1, P5, P7a")
extra_args: Optional[List[str]] = Field(default=None, description="Additional CLI flags to pass through verbatim")
upload_results: Optional[bool] = Field(default=True, description="Upload results back to GCS after completion")

class RunResponse(BaseModel):
ok: bool
exit_code: int
stdout: str
stderr: str
duration_sec: float
cmd: str

@app.get("/health")
def health() -> dict:
return {"status": "ok"}

def \_is_phase5(phase: str) -> bool:
token = (phase or "").strip().upper()
return token == "P5" or token == "PHASE5" or token == "PHASE_5"

def \_extract_int_flag(args: Optional[List[str]], flag: str) -> Optional[int]:
if not args:
return None
for i, arg in enumerate(args):
if arg == flag and i + 1 < len(args):
try:
return int(args[i + 1])
except Exception:
return None
if arg.startswith(f"{flag}="):
try:
return int(arg.split("=", 1)[1])
except Exception:
return None
return None

async def \_delegate_phase5(req: RunRequest) -> RunResponse:
"""Delegate Phase 5 execution to a dedicated Phase 5 service (if configured)."""
phase5_url = os.getenv("PHASE5_SERVICE_URL")
if not phase5_url:
raise HTTPException(status_code=500, detail="PHASE5_SERVICE_URL not configured")

    internal_key = (os.getenv("GB_INTERNAL_API_KEY") or "").strip()

    # Cloud Run-to-Cloud Run auth: mint an ID token for the Phase 5 service and attach it.
    # This keeps Phase 5 private (no allUsers invoker) while still allowing internal delegation.
    auth_header = None
    try:
        from google.auth.transport.requests import Request as _GoogleAuthRequest  # type: ignore
        from google.oauth2 import id_token as _google_id_token  # type: ignore

        audience = phase5_url.rstrip("/")
        auth_header = f"Bearer {_google_id_token.fetch_id_token(_GoogleAuthRequest(), audience)}"
    except Exception:
        # If token minting fails, we still attempt the request; it will work only if Phase 5 is public.
        auth_header = None

    # Mirror orchestrator defaults as closely as possible.
    global_topk = _extract_int_flag(req.extra_args, "--global-topk")
    max_n = min(max(int(global_topk or 2000), 1), 250)

    payload = {
        "project_id": req.project_id,
        "max_n": max_n,
        "selection_tag": "final_portfolio",
        "upload_results": req.upload_results,
        "clean_local": True,
        # Let the Phase 5 service decide from env defaults unless caller overrides later.
        "include_proteomics": None,
        "extra_args": None,
    }

    url = f"{phase5_url.rstrip('/')}/run"
    timeout = httpx.Timeout(connect=30.0, read=900.0, write=900.0, pool=30.0)
    headers = {}
    if auth_header:
        headers["Authorization"] = auth_header
    if internal_key:
        headers["X-API-Key"] = internal_key
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.post(url, json=payload, headers=headers)
        except httpx.RequestError as exc:  # pragma: no cover
            raise HTTPException(status_code=502, detail=f"Phase 5 service request failed: {exc}") from exc

    if resp.status_code != 200:
        # Preserve upstream detail for debugging.
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    try:
        data = resp.json()
    except Exception as exc:  # pragma: no cover
        raise HTTPException(status_code=502, detail=f"Phase 5 service returned non-JSON: {exc}") from exc

    return RunResponse(**data)

def \_load_gcs_client():
"""Load Google Cloud Storage client, return None if not available."""
try:
from google.cloud import storage
return storage.Client()
except Exception:
return None

def \_download_project_from_gcs(bucket_name: str, project_id: str, dest_dir: Path) -> bool:
"""Download project data from GCS bucket to local directory.

    Args:
        bucket_name: GCS bucket name
        project_id: Project identifier
        dest_dir: Local destination directory

    Returns:
        True if download succeeded, False otherwise
    """
    client = _load_gcs_client()
    if not client:
        return False

    try:
        bucket = client.bucket(bucket_name)
        prefix = f"projects/{project_id}/"
        blobs = list(client.list_blobs(bucket, prefix=prefix))

        if not blobs:
            # Try alternative prefix structure
            prefix = f"{project_id}/"
            blobs = list(client.list_blobs(bucket, prefix=prefix))

        if not blobs:
            return False

        dest_dir.mkdir(parents=True, exist_ok=True)
        project_dest = dest_dir / project_id
        project_dest.mkdir(parents=True, exist_ok=True)

        for blob in blobs:
            # Calculate relative path from prefix
            if blob.name.startswith(f"projects/{project_id}/"):
                rel_path = blob.name[len(f"projects/{project_id}/"):]
            elif blob.name.startswith(f"{project_id}/"):
                rel_path = blob.name[len(f"{project_id}/"):]
            else:
                rel_path = blob.name

            if not rel_path:  # Skip if it's just the prefix itself
                continue

            target = project_dest / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            blob.download_to_filename(target)

        return True
    except Exception as e:
        print(f"Error downloading from GCS: {e}", file=sys.stderr)
        return False

def \_upload_project_to_gcs(bucket_name: str, project_id: str, source_dir: Path) -> bool:
"""Upload project results back to GCS bucket.

    Args:
        bucket_name: GCS bucket name
        project_id: Project identifier
        source_dir: Local source directory containing project data

    Returns:
        True if upload succeeded, False otherwise
    """
    client = _load_gcs_client()
    if not client:
        return False

    try:
        bucket = client.bucket(bucket_name)
        project_source = source_dir / project_id

        if not project_source.exists():
            return False

        prefix = f"projects/{project_id}/"

        for file_path in project_source.rglob("*"):
            if file_path.is_dir():
                continue

            rel_path = file_path.relative_to(project_source)
            blob_name = f"{prefix}{rel_path.as_posix()}"
            blob = bucket.blob(blob_name)
            blob.upload_from_filename(file_path)

        return True
    except Exception as e:
        print(f"Error uploading to GCS: {e}", file=sys.stderr)
        return False

@app.post("/orchestrator/run", response_model=RunResponse)
async def run_orchestrator(req: RunRequest) -> RunResponse:
"""Run a single orchestrator phase via subprocess and return captured output.

    This function:
    1. Downloads project data from GCS if GCS_BUCKET is configured
    2. Sets up the environment for the orchestrator
    3. Runs the orchestrator phase
    4. Optionally uploads results back to GCS
    """
    # Optionally offload Phase 5 to a dedicated microservice (keeps this container lean).
    if _is_phase5(req.phase) and os.getenv("PHASE5_SERVICE_URL"):
        return await _delegate_phase5(req)

    gcs_bucket = os.getenv("GCS_BUCKET")
    use_cloud_storage = os.getenv("USE_CLOUD_STORAGE", "").lower() in ("1", "true", "yes")

    # Determine projects directory
    projects_dir = Path(os.getenv("TN_PROJECTS_DIR", "/tmp/projects"))
    temp_projects_dir = None
    project_downloaded = False

    # Download from GCS if configured
    if gcs_bucket:
        print(f"[API] Downloading project {req.project_id} from gs://{gcs_bucket}/projects/{req.project_id}")
        # Use a temporary directory for GCS downloads to avoid conflicts
        temp_projects_dir = Path(tempfile.mkdtemp(prefix="tnaas_projects_"))
        project_downloaded = _download_project_from_gcs(gcs_bucket, req.project_id, temp_projects_dir)

        if project_downloaded:
            projects_dir = temp_projects_dir
            print(f"[API] Project downloaded to {projects_dir}")
        else:
            print(f"[API] Warning: Failed to download from GCS, using local projects directory")

    # Build command
    cmd = [sys.executable, "-m", "scripts.streamlit.refactored_app_3", "--project-id", req.project_id, "--phase", req.phase]
    if req.extra_args:
        cmd.extend(req.extra_args)

    # Set up environment
    env = dict(os.environ)
    env["PYTHONPATH"] = "/app/src"
    env["TN_PROJECTS_DIR"] = str(projects_dir)

    # Also set for models if GCS is being used
    if gcs_bucket and project_downloaded:
        models_dir = Path(os.getenv("ADMET_PIPELINE_MODEL_DIR", "/tmp/models/admet_pipeline_model_v2"))
        env["ADMET_PIPELINE_MODEL_DIR"] = str(models_dir)

    start = time.time()
    stdout_bytes = None
    stderr_bytes = None
    proc = None

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            cwd="/app",
        )
        stdout_bytes, stderr_bytes = await proc.communicate()
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Python executable not found in container")
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=500, detail=f"Failed to start orchestrator: {e}")
    finally:
        # Upload results back to GCS if configured and requested
        if gcs_bucket and req.upload_results and project_downloaded and projects_dir:
            print(f"[API] Uploading results for project {req.project_id} to gs://{gcs_bucket}")
            upload_success = _upload_project_to_gcs(gcs_bucket, req.project_id, projects_dir)
            if upload_success:
                print(f"[API] Results uploaded successfully")
            else:
                print(f"[API] Warning: Failed to upload results to GCS")

        # Clean up temporary directory if we created one
        if temp_projects_dir and temp_projects_dir.exists():
            try:
                shutil.rmtree(temp_projects_dir)
                print(f"[API] Cleaned up temporary directory {temp_projects_dir}")
            except Exception as e:
                print(f"[API] Warning: Failed to clean up temp directory: {e}", file=sys.stderr)

    duration = time.time() - start
    stdout = stdout_bytes.decode(errors="replace") if stdout_bytes else ""
    stderr = stderr_bytes.decode(errors="replace") if stderr_bytes else ""
    ok = proc.returncode == 0 if proc else False

    if not ok:
        # Include some guidance in the response; caller can show stderr to user
        msg = {
            "cmd": " ".join(shlex.quote(x) for x in cmd),
            "exit_code": proc.returncode if proc else -1,
            "stderr_tail": stderr[-2000:],
        }
        raise HTTPException(status_code=500, detail=json.dumps(msg))

    return RunResponse(
        ok=ok,
        exit_code=proc.returncode if proc else -1,
        stdout=stdout,
        stderr=stderr,
        duration_sec=duration,
        cmd=" ".join(shlex.quote(x) for x in cmd),
    )

# Convenience alias

@app.post("/run")
async def run_alias(req: RunRequest):
return await run_orchestrator(req)

THis is a seperate server this is my CRUD vercel website backend server that has my admin dashboard etc
import os
import asyncio
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .mongodb import get_mongo_client, close_mongo_connection
from .routers import (
auth,
intake,
jobs,
users,
billing,
blog,
documents,
contact,
gallery,
files,
projects,
tcb_adapter,
pipeline,
reports,
validation_cases,
world_models,
reproducibility, # voice_agent router removed (SQL-dependent)
)
settings = get_settings()
app = FastAPI(
title=settings.app_name,
version="1.0.0",
openapi_url=f"{settings.api_v1_prefix}/openapi.json",
redirect_slashes=True, # Automatically redirect /path to /path/ and vice versa
)

# Mongo startup resilience settings

MONGO_STARTUP_MAX_RETRIES = int(os.getenv("MONGO_STARTUP_MAX_RETRIES", "3"))
MONGO_STARTUP_BACKOFF_SECONDS = float(os.getenv("MONGO_STARTUP_BACKOFF_SECONDS", "1.5"))
MONGO_STARTUP_STRICT = os.getenv("MONGO_STARTUP_STRICT", "true").lower() == "true"

default_origins = [
"http://localhost:3000",
"http://127.0.0.1:3000",
"http://localhost:5173",
"http://127.0.0.1:5173",
"https://glassbox-bio.com",
"https://www.glassbox-bio.com",
"https://api.glassbox-bio.com",
]

def \_parse_origins(env_val: str | None) -> list[str]:
if not env_val:
return default_origins
return [o.strip() for o in env_val.split(",") if o.strip()]

allow_origins = \_parse_origins(os.getenv("CORS_ALLOW_ORIGINS"))

# Add Vercel preview URLs dynamically via middleware

def \_is_vercel_origin(origin: str) -> bool:
"""Check if origin is a Vercel preview URL"""
if not origin:
return False
return (
origin.endswith(".vercel.app") or
origin.endswith(".vercel.sh") or
"vercel" in origin.lower()
)

# Use regex to allow all Vercel preview URLs and glassbox-bio.com subdomains

vercel*origin_regex = r"https://.*\.vercel\.app|https://.\_\.vercel\.sh|https://.\*\.glassbox-bio\.com"

app.add_middleware(
CORSMiddleware,
allow_origins=allow_origins,
allow_origin_regex=vercel_origin_regex,
allow_credentials=True,
allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
allow_headers=["*"],
expose_headers=["*"],
max_age=3600,
)

app.include_router(auth.router, prefix=settings.api_v1_prefix)
app.include_router(users.router, prefix=settings.api_v1_prefix)
app.include_router(jobs.router, prefix=settings.api_v1_prefix)
app.include_router(intake.router, prefix=settings.api_v1_prefix)
app.include_router(billing.router, prefix=settings.api_v1_prefix)
app.include_router(blog.router, prefix=settings.api_v1_prefix)
app.include_router(documents.router, prefix=settings.api_v1_prefix)
app.include_router(contact.router, prefix=settings.api_v1_prefix)

# voice_agent router disabled (SQL removed)

app.include_router(gallery.router, prefix=settings.api_v1_prefix)
app.include_router(files.router, prefix=settings.api_v1_prefix)
app.include_router(projects.router, prefix=settings.api_v1_prefix)
app.include_router(tcb_adapter.router, prefix=settings.api_v1_prefix)
app.include_router(pipeline.router, prefix=settings.api_v1_prefix)
app.include_router(reports.router, prefix=settings.api_v1_prefix)
app.include_router(validation_cases.router, prefix=settings.api_v1_prefix)
app.include_router(world_models.router, prefix=settings.api_v1_prefix)
app.include_router(reproducibility.router, prefix=settings.api_v1_prefix)

deliverables_path = Path(settings.deliverables_dir).resolve()
os.makedirs(deliverables_path, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=deliverables_path), name="deliverables")

@app.on_event("startup")
async def on_startup() -> None:
import logging
logger = logging.getLogger(**name**)
for attempt in range(1, MONGO_STARTUP_MAX_RETRIES + 1):
try:
get_mongo_client()
logger.info("✅ MongoDB connection initialized")
break
except Exception as e:
logger.error(f"❌ MongoDB connection failed (attempt {attempt}/{MONGO_STARTUP_MAX_RETRIES}): {e}")
if attempt == MONGO_STARTUP_MAX_RETRIES:
if MONGO_STARTUP_STRICT: # Preserve existing behavior: fail startup so Cloud Run keeps retrying
raise
logger.warning(
"Continuing startup without MongoDB because MONGO_STARTUP_STRICT is false; "
"API requests that hit the database will fail until connectivity is restored."
)
break
await asyncio.sleep(min(MONGO_STARTUP_BACKOFF_SECONDS \* attempt, 10))

@app.on_event("shutdown")
async def on_shutdown() -> None:
close_mongo_connection()

@app.get("/")
async def root():
return {"status": "ok", "service": settings.app_name}

@app.options("/{full_path:path}")
async def options_handler(full_path: str):
"""Handle OPTIONS preflight requests for all paths"""
return {"status": "ok"}

# Global exception handler to ensure CORS headers are added to error responses

from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
"""Handle HTTP exceptions with CORS headers"""
response = JSONResponse(
status_code=exc.status_code,
content={"detail": exc.detail},
) # Add CORS headers
origin = request.headers.get("origin")
if origin and (
origin in allow_origins or
any(origin.endswith(domain) for domain in [".vercel.app", ".vercel.sh", ".glassbox-bio.com"])
):
response.headers["Access-Control-Allow-Origin"] = origin
response.headers["Access-Control-Allow-Credentials"] = "true"
return response

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
"""Handle all other exceptions with CORS headers"""
import logging
logger = logging.getLogger(**name**)
logger.error(f"Unhandled exception: {exc}", exc_info=True)

    response = JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
    # Add CORS headers
    origin = request.headers.get("origin")
    if origin and (
        origin in allow_origins or
        any(origin.endswith(domain) for domain in [".vercel.app", ".vercel.sh", ".glassbox-bio.com"])
    ):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
    return response

from datetime import datetime
from typing import Dict, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from ..auth import get_admin_user, get_current_user, get_password_hash, verify_password
from ..config import get_settings
from ..mongo_repos import (
find_user_by_id,
find_user_by_email,
update_user as update_user_doc,
list_users as list_users_docs,
delete_user as delete_user_doc,
list_projects_for_user,
)
from .. import schemas
from ..schemas import UserPasswordUpdate, UserRead, UserRoleUpdate, UserUpdate
from ..utils.email import send_email
from .auth import \_build_action_link, \_generate_token, \_smtp_configured, \_verification_email_body

router = APIRouter(prefix="/users", tags=[
"users"
])
settings = get_settings()

def \_get_user_id(doc: Dict[str, Any]) -> str:
"""Get user_id from document, falling back to \_id conversion for backward compatibility."""
return doc.get("user_id") or str(doc.get("\_id") or doc.get("id"))

def \_user_to_read(doc: Dict[str, Any]) -> UserRead:

# Use user_id field if available, otherwise fall back to converting \_id (for backward compatibility)

user_id = \_get_user_id(doc)

# Fetch all projects for the user (projects are stored in a separate collection)

user_projects = list_projects_for_user(user_id)
project_reads = [
schemas.ProjectRead(
id=str(project["_id"]),
name=project["name"],
slug=project["slug"],
is_example=project.get("is_example", False),
created_at=project.get("created_at"),
updated_at=project.get("updated_at"),
latest_audit=None, # Can be populated later if needed
)
for project in user_projects
]

return UserRead(
id=user_id,
email=doc.get("email"),
full_name=doc.get("full_name"),
company_name=doc.get("company_name"),
job_title=doc.get("job_title"),
phone_number=doc.get("phone_number"),
timezone=doc.get("timezone"),
billing_email=doc.get("billing_email"),
preferences=doc.get("preferences", {}),
created_at=doc.get("created_at"),
stripe_customer_id=doc.get("stripe_customer_id"),
role=doc.get("role"),
onboarding_completed=doc.get("onboarding_completed", False),
is_email_verified=doc.get("is_email_verified", False),
email_verified_at=doc.get("email_verified_at"),
default_project_id=doc.get("default_project_id"),
projects=project_reads, # Google OAuth fields (if available)
avatar_url=doc.get("avatar_url"),
google_id=doc.get("google_id"),
auth_provider=doc.get("auth_provider"),
)

@router.get("/me", response_model=UserRead)
async def read_current_user(current_user: Dict[str, Any] = Depends(get_current_user)):
return \_user_to_read(current_user)

@router.patch("/me", response_model=UserRead)
async def update_current_user(
payload: UserUpdate,
background_tasks: BackgroundTasks,
current_user: Dict[str, Any] = Depends(get_current_user),
):
updates: Dict[str, Any] = {}
if payload.full_name is not None:
updates[
"full_name"
] = payload.full_name
if payload.company_name is not None:
updates[
"company_name"
] = payload.company_name
if payload.job_title is not None:
updates[
"job_title"
] = payload.job_title
if payload.phone_number is not None:
updates[
"phone_number"
] = payload.phone_number
if payload.timezone is not None:
updates[
"timezone"
] = payload.timezone
if payload.billing_email is not None:
updates[
"billing_email"
] = payload.billing_email.lower()
if payload.email is not None:
normalized_email = payload.email.lower()
if normalized_email != current_user.get("email"):
existing = find_user_by_email(normalized_email)
if existing:
raise HTTPException(
status_code=status.HTTP_400_BAD_REQUEST,
detail="Email already registered",
)
updates[
"email"
] = normalized_email
updates[
"is_email_verified"
] = False
updates[
"email_verified_at"
] = None
token, hashed_token = \_generate_token(\_get_user_id(current_user))
updates[
"email_verification_token"
] = hashed_token
updates[
"email_verification_sent_at"
] = datetime.utcnow()
if background_tasks and \_smtp_configured():
link = \_build_action_link("verify-email", token)
subject, html_body = \_verification_email_body(link, current_user.get("full_name"))
background_tasks.add_task(
send_email,
[normalized_email],
subject,
html_body,
None,
settings.smtp_host,
settings.smtp_port,
settings.smtp_user,
settings.smtp_password,
settings.smtp_from_email or settings.smtp_user,
)
if payload.preferences is not None:
updates[
"preferences"
] = {
**(current_user.get("preferences") or {}),
**{key: value for key, value in payload.preferences.items() if value is not None},
}

if not updates:
return current_user

updated = update_user_doc(\_get_user_id(current_user), updates)
return \_user_to_read(updated or current_user)

@router.put("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def update_password(
payload: UserPasswordUpdate,
current_user: Dict[str, Any] = Depends(get_current_user),
):
if not verify_password(payload.current_password, current_user.get("hashed_password")):
raise HTTPException(
status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect"
)

update_user_doc(
\_get_user_id(current_user),
{"hashed_password": get_password_hash(payload.new_password)}
)
return None

@router.get("/", response*model=list[UserRead])
async def list_users(
*: Dict[str, Any] = Depends(get_admin_user),
):
return [
_user_to_read(u)
for u in list_users_docs()
]

@router.patch("/{user*id}/role", response_model=UserRead)
async def update_user_role(
user_id: str,
payload: UserRoleUpdate,
*: Dict[str, Any] = Depends(get_admin_user),
):
user = find_user_by_id(user_id)
if not user:
raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
updated = update_user_doc(user_id, {"role": payload.role})
return \_user_to_read(updated or user)

@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
current_user: Dict[str, Any] = Depends(get_current_user),
):
delete_user_doc(\_get_user_id(current_user))
return None

@router.delete("/{user*id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
user_id: str,
*: Dict[str, Any] = Depends(get_admin_user),
):
deleted = delete_user_doc(user_id)
if not deleted:
raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
return None

"""
Tiered Report Dashboard API Endpoints

Provides endpoints for the tiered dashboard visualization system:

- TLDR (GB-TAR): Executive summary with Level 0 content
- Standard: Key metrics with Levels 0-2
- Deep Dive: Full Virtual Lab Panel with Levels 0-3

Endpoints:

- GET /reports/{job_id} - Get full report model
- GET /reports/{job_id}/tier/{tier} - Get tier-filtered report
- GET /reports/{job_id}/sections - List available sections with access info
- GET /reports/{job_id}/sections/{section_id} - Get specific section data
- GET /reports/{job_id}/artifacts/{artifact_id} - Get artifact content
  """

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Literal
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field

from ..auth import get_current_user, get_admin_user
from ..mongo_repos import find_job, update_job, jobs_col
from bson import ObjectId

logger = logging.getLogger(**name**)
router = APIRouter(prefix="/reports", tags=["reports"])

# ============================================================================

# ENUMS & CONSTANTS (mirroring frontend reportTypes.js)

# ============================================================================

class Tier(str, Enum):
fast_fail = "fast_fail"
standard = "standard"
deep_dive = "deep_dive"

class SectionId(str, Enum):
summary = "summary"
biology = "biology"
sar = "sar"
risk = "risk"
commercial = "commercial"
market = "market"
regulatory = "regulatory"
portfolio = "portfolio"
manifest = "manifest"
proteomics = "proteomics"
ip = "ip"
evidence = "evidence"
repro = "repro"
xai = "xai"
config = "config"
meta = "meta"
sow = "sow"

# Section ID mapping (CSV section -> canonical section)

SECTION_ID_MAP = {
"bio": "biology",
"chemistry-sar": "sar",
"commercial": "commercial",
"config": "config",
"evidence": "evidence",
"ip": "ip",
"manifest": "manifest",
"market": "market",
"meta": "meta",
"portfolio": "portfolio",
"proteomics": "proteomics",
"regulatory": "regulatory",
"repro": "repro",
"risk": "risk",
"sow": "sow",
"summary": "summary",
"xai": "xai",
}

# Section -> default detail level

SECTION_LEVEL_MAP = {
"summary": 0,
"manifest": 0,
"sow": 0,
"biology": 1,
"risk": 1,
"commercial": 1,
"market": 1,
"config": 1,
"meta": 1,
"regulatory": 1,
"portfolio": 1,
"proteomics": 2,
"sar": 2,
"ip": 2,
"evidence": 3,
"repro": 3,
"xai": 3,
}

# Tier entitlements

TIER_ENTITLEMENTS = {
"fast_fail": {
"max_level": 1,
"sections": ["summary", "risk", "biology", "commercial"],
"description": "Executive summary with key risk flags",
},
"standard": {
"max_level": 2,
"sections": [
"summary", "risk", "biology", "commercial", "market",
"regulatory", "sar", "portfolio", "manifest"
],
"description": "Standard analysis with key metrics and evidence",
},
"deep_dive": {
"max_level": 3,
"sections": [
"summary", "risk", "biology", "commercial", "market",
"regulatory", "sar", "portfolio", "manifest", "proteomics",
"ip", "evidence", "repro", "xai", "config", "meta", "sow"
],
"description": "Full Virtual Lab Panel with all artifacts and provenance",
},
}

# Section metadata for UI display

SECTION_CONFIG = {
"summary": {"label": "Summary", "icon": "📊", "color": "#3B82F6"},
"biology": {"label": "Biology", "icon": "🧬", "color": "#10B981"},
"sar": {"label": "SAR / Chemistry", "icon": "⚗️", "color": "#8B5CF6"},
"risk": {"label": "Risk Assessment", "icon": "⚠️", "color": "#EF4444"},
"commercial": {"label": "Commercial", "icon": "💰", "color": "#F59E0B"},
"market": {"label": "Market", "icon": "📈", "color": "#06B6D4"},
"regulatory": {"label": "Regulatory", "icon": "📋", "color": "#6366F1"},
"portfolio": {"label": "Portfolio", "icon": "📁", "color": "#EC4899"},
"manifest": {"label": "Manifest", "icon": "📝", "color": "#84CC16"},
"proteomics": {"label": "Proteomics", "icon": "🔬", "color": "#14B8A6"},
"ip": {"label": "IP Landscape", "icon": "⚖️", "color": "#A855F7"},
"evidence": {"label": "Evidence", "icon": "📚", "color": "#F97316"},
"repro": {"label": "Reproducibility", "icon": "🔄", "color": "#22C55E"},
"xai": {"label": "Explainability", "icon": "🧠", "color": "#0EA5E9"},
"config": {"label": "Configuration", "icon": "⚙️", "color": "#64748B"},
"meta": {"label": "Metadata", "icon": "🏷️", "color": "#78716C"},
"sow": {"label": "Scope of Work", "icon": "📄", "color": "#0D9488"},
}

# ============================================================================

# PYDANTIC MODELS

# ============================================================================

class MetricValue(BaseModel):
"""A single metric value with optional status and metadata"""
key: str
value: Any
unit: Optional[str] = None
label: Optional[str] = None
status: Optional[Literal["green", "amber", "red", "unknown"]] = None
threshold: Optional[float] = None
description: Optional[str] = None
source: Optional[str] = None

class ArtifactContent(BaseModel):
"""Content of an artifact (text, table, or reference)"""
type: Literal["text", "table", "reference"]
value: Optional[str] = None
rows: Optional[List[Dict[str, Any]]] = None
truncated: Optional[bool] = False

class Artifact(BaseModel):
"""A report artifact (file, table, chart, etc.)"""
id: str
path: str
media_type: str
label: Optional[str] = None
section_id: str
level: int = 0
widget_id: Optional[str] = None
content: Optional[ArtifactContent] = None
meta: Optional[Dict[str, Any]] = None

class LevelData(BaseModel):
"""Data for a specific detail level within a section"""
level: int
metrics: List[MetricValue] = Field(default_factory=list)
artifacts: List[Artifact] = Field(default_factory=list)
content: Optional[str] = None

class Section(BaseModel):
"""A report section with levels of detail"""
id: str
label: str
icon: Optional[str] = None
color: Optional[str] = None
base_level: int = 0
levels: Dict[int, LevelData] = Field(default_factory=dict)

class SectionSummary(BaseModel):
"""Summary info for a section (for listing)"""
id: str
label: str
icon: Optional[str] = None
color: Optional[str] = None
base_level: int = 0
available_levels: List[int] = Field(default_factory=list)
accessible: bool = True
locked_reason: Optional[str] = None

class ReportMeta(BaseModel):
"""Report metadata"""
project_id: str
target_id: Optional[str] = None
generated_at: datetime
tier: Tier = Tier.standard
source: Optional[str] = None
version: Optional[str] = None

class ReportModel(BaseModel):
"""The canonical report model for frontend rendering"""
job_id: Optional[str] = None
project_id: str
target_id: Optional[str] = None
generated_at: datetime
tier: Tier = Tier.standard
sections: Dict[str, Section] = Field(default_factory=dict)
meta: Optional[Dict[str, Any]] = None

    class Config:
        use_enum_values = True

class TieredReportResponse(BaseModel):
"""Response for tier-filtered report data"""
report: ReportModel
tier_info: Dict[str, Any]
accessible_sections: List[str]
locked_sections: List[str]

class SectionsListResponse(BaseModel):
"""Response for listing sections with access info"""
sections: List[SectionSummary]
current_tier: str
max_level: int

# ============================================================================

# HELPER FUNCTIONS

# ============================================================================

def \_get_user_id(doc: Dict[str, Any]) -> str:
"""Get user_id from document, falling back to \_id conversion for backward compatibility."""
user_id = doc.get("user_id") or str(doc.get("\_id") or doc.get("id"))
print(f"DEBUG: \_get_user_id - doc keys: {list(doc.keys())}, extracted user_id: {user_id}")
return user_id

def get_job_with_access(job_id: str, current_user: Dict[str, Any]) -> Dict[str, Any]:
"""Get job and verify user access"""
print(f"DEBUG: get_job_with_access - job_id: {job_id}, user_id: {\_get_user_id(current_user)}, role: {current_user.get('role')}")
job = find_job(job_id)
if not job:
print(f"DEBUG: get_job_with_access - Job not found: {job_id}")
raise HTTPException(status_code=404, detail="Job not found")

    job_user_id = job.get("user_id")
    current_user_id = _get_user_id(current_user)
    is_admin = current_user.get("role") == "admin"
    print(f"DEBUG: get_job_with_access - job.user_id: {job_user_id}, current_user_id: {current_user_id}, is_admin: {is_admin}")

    if job_user_id != current_user_id and not is_admin:
        print(f"DEBUG: get_job_with_access - Access denied: job belongs to {job_user_id}, user is {current_user_id}")
        raise HTTPException(status_code=403, detail="Not authorized to access this job")

    print(f"DEBUG: get_job_with_access - Access granted for job_id: {job_id}")
    return job

def get_user_tier(job: Dict[str, Any], current_user: Dict[str, Any]) -> str:
"""Determine user's tier access for a job"""
print(f"DEBUG: get_user_tier - user role: {current_user.get('role')}, subscription_tier: {current_user.get('subscription_tier')}, job.tier_access: {job.get('tier_access')}") # Admin gets deep_dive
if current_user.get("role") == "admin":
print("DEBUG: get_user_tier - Admin user, returning deep_dive")
return "deep_dive"

    # Check job-specific tier override
    if job.get("tier_access"):
        print(f"DEBUG: get_user_tier - Using job tier_access override: {job['tier_access']}")
        return job["tier_access"]

    # Check user subscription tier
    user_tier = current_user.get("subscription_tier", "standard")
    if user_tier in TIER_ENTITLEMENTS:
        print(f"DEBUG: get_user_tier - Using user subscription_tier: {user_tier}")
        return user_tier

    print(f"DEBUG: get_user_tier - Defaulting to standard tier")
    return "standard"

def is_section_accessible(section_id: str, tier: str) -> bool:
"""Check if a section is accessible for a tier"""
entitlement = TIER_ENTITLEMENTS.get(tier, TIER_ENTITLEMENTS["standard"])
return section_id in entitlement["sections"]

def get_max_level_for_tier(tier: str) -> int:
"""Get maximum detail level for a tier"""
entitlement = TIER_ENTITLEMENTS.get(tier, TIER_ENTITLEMENTS["standard"])
return entitlement["max_level"]

def normalize_section_id(raw_id: str) -> str:
"""Normalize a raw section ID to canonical form"""
canonical_id = SECTION_ID_MAP.get(raw_id, raw_id)
if raw_id != canonical_id:
print(f"DEBUG: normalize_section_id - Mapped '{raw_id}' -> '{canonical_id}'")
return canonical_id

def build_report_model_from_audit_data(
job: Dict[str, Any],
tier: str,
filter_by_tier: bool = True
) -> ReportModel:
"""
Build a ReportModel from job audit_data.

    Handles both:
    1. Legacy audit_data format (flat structure with score, features, etc.)
    2. New summary.json format (section_id, levels structure)
    """
    print(f"DEBUG: build_report_model_from_audit_data - job_id: {job.get('_id')}, tier: {tier}, filter_by_tier: {filter_by_tier}")
    audit_data = job.get("audit_data") or {}
    report_data = job.get("report_data") or {}  # New tiered format

    print(f"DEBUG: build_report_model_from_audit_data - has audit_data: {bool(audit_data)}, has report_data: {bool(report_data)}, report_data has sections: {bool(report_data and 'sections' in report_data)}")

    # Use report_data if available (new format), otherwise transform audit_data
    if report_data and "sections" in report_data:
        print(f"DEBUG: build_report_model_from_audit_data - Using report_data format, sections count: {len(report_data.get('sections', {}))}")
        sections = _parse_report_sections(report_data.get("sections", {}))
        print(f"DEBUG: build_report_model_from_audit_data - Parsed {len(sections)} sections from report_data")
    else:
        print(f"DEBUG: build_report_model_from_audit_data - Using legacy audit_data format")
        sections = _transform_legacy_audit_to_sections(audit_data)
        print(f"DEBUG: build_report_model_from_audit_data - Transformed {len(sections)} sections from audit_data")

    # Filter by tier if requested
    if filter_by_tier:
        print(f"DEBUG: build_report_model_from_audit_data - Filtering sections by tier: {tier}")
        sections_before = len(sections)
        sections = _filter_sections_by_tier(sections, tier)
        print(f"DEBUG: build_report_model_from_audit_data - Filtered from {sections_before} to {len(sections)} sections")

    report_model = ReportModel(
        job_id=job.get("job_id") or str(job.get("_id")),
        project_id=str(job.get("_id")),
        target_id=job.get("target"),
        generated_at=job.get("updated_at") or job.get("submitted_at") or datetime.utcnow(),
        tier=tier,
        sections=sections,
        meta={
            "source": "audit_data" if not report_data else "report_data",
            "indication": job.get("indication"),
            "status": job.get("status"),
        }
    )
    print(f"DEBUG: build_report_model_from_audit_data - Built ReportModel with {len(sections)} sections, target: {job.get('target')}")
    return report_model

def \_parse_report_sections(raw_sections: Dict[str, Any]) -> Dict[str, Section]:
"""Parse sections from the new report_data format"""
print(f"DEBUG: \_parse_report_sections - Parsing {len(raw_sections)} raw sections")
sections = {}

    for section_id, section_data in raw_sections.items():
        canonical_id = normalize_section_id(section_id)
        config = SECTION_CONFIG.get(canonical_id, {})
        print(f"DEBUG: _parse_report_sections - Processing section '{section_id}' -> '{canonical_id}', has config: {bool(config)}")

        levels = {}
        raw_levels = section_data.get("levels", {})
        print(f"DEBUG: _parse_report_sections - Section '{canonical_id}' has {len(raw_levels)} levels")

        for level_key, level_data in raw_levels.items():
            level_num = int(level_key)
            print(f"DEBUG: _parse_report_sections - Processing level {level_num} for section '{canonical_id}'")

            # Parse metrics
            metrics = []
            raw_metrics = level_data.get("metrics", [])
            print(f"DEBUG: _parse_report_sections - Level {level_num} has {len(raw_metrics)} metrics")
            for m in raw_metrics:
                metrics.append(MetricValue(
                    key=m.get("key", m.get("name", "unknown")),
                    value=m.get("value"),
                    unit=m.get("unit"),
                    label=m.get("label"),
                    status=m.get("status"),
                    threshold=m.get("threshold"),
                    description=m.get("description"),
                    source=m.get("source"),
                ))

            # Parse artifacts
            artifacts = []
            raw_artifacts = level_data.get("artifacts", [])
            print(f"DEBUG: _parse_report_sections - Level {level_num} has {len(raw_artifacts)} artifacts")
            for a in raw_artifacts:
                content = None
                if a.get("content"):
                    raw_content = a["content"]
                    # Handle both dict format and list format (e.g., table rows)
                    if isinstance(raw_content, dict):
                        content = ArtifactContent(
                            type=raw_content.get("type", "text"),
                            value=raw_content.get("value"),
                            rows=raw_content.get("rows"),
                            truncated=raw_content.get("truncated", False),
                        )
                    elif isinstance(raw_content, list):
                        # If content is a list, treat it as table rows
                        content = ArtifactContent(
                            type="table",
                            rows=raw_content,
                            truncated=False,
                        )
                    elif isinstance(raw_content, str):
                        # If content is a string, treat it as text
                        content = ArtifactContent(
                            type="text",
                            value=raw_content,
                        )

                artifacts.append(Artifact(
                    id=a.get("widget_id") or a.get("id") or a.get("path", "").replace("/", "_"),
                    path=a.get("path", ""),
                    media_type=a.get("media_type", "application/octet-stream"),
                    label=a.get("label"),
                    section_id=canonical_id,
                    level=level_num,
                    widget_id=a.get("widget_id"),
                    content=content,
                    meta=a.get("meta"),
                ))

            levels[level_num] = LevelData(
                level=level_num,
                metrics=metrics,
                artifacts=artifacts,
                content=level_data.get("content"),
            )

        sections[canonical_id] = Section(
            id=canonical_id,
            label=config.get("label", canonical_id.title()),
            icon=config.get("icon"),
            color=config.get("color"),
            base_level=SECTION_LEVEL_MAP.get(canonical_id, 0),
            levels=levels,
        )
        print(f"DEBUG: _parse_report_sections - Created section '{canonical_id}' with {len(levels)} levels")

    print(f"DEBUG: _parse_report_sections - Completed parsing, total sections: {len(sections)}")
    return sections

def \_transform_legacy_audit_to_sections(audit_data: Dict[str, Any]) -> Dict[str, Section]:
"""Transform legacy audit_data format to section-based structure"""
print(f"DEBUG: \_transform_legacy_audit_to_sections - Starting transformation, audit_data keys: {list(audit_data.keys())}")
sections = {}

    if not audit_data:
        print("DEBUG: _transform_legacy_audit_to_sections - Empty audit_data, returning empty sections")
        return sections

    # Create summary section from score data
    score = audit_data.get("score", {})
    print(f"DEBUG: _transform_legacy_audit_to_sections - Score data: {bool(score)}, keys: {list(score.keys()) if score else []}")
    if score:
        summary_metrics = [
            MetricValue(
                key="overall_score",
                value=score.get("value"),
                label="Overall Score",
                status=_rag_to_status(score.get("rag")),
            ),
            MetricValue(
                key="s100",
                value=score.get("s100"),
                label="S100 Score",
                unit="%",
            ),
            MetricValue(
                key="confidence",
                value=score.get("confidence"),
                label="Confidence",
                description=f"Index: {score.get('confidence_index', 'N/A')}",
            ),
            MetricValue(
                key="verdict",
                value=score.get("verdict"),
                label="Verdict",
                status=_verdict_to_status(score.get("verdict")),
            ),
        ]

        sections["summary"] = Section(
            id="summary",
            label="Summary",
            icon="📊",
            color="#3B82F6",
            base_level=0,
            levels={
                0: LevelData(level=0, metrics=summary_metrics),
            },
        )

    # Create risk section from gate_audit
    gate_audit = score.get("gate_audit", [])
    if gate_audit:
        risk_metrics = []
        for gate in gate_audit:
            risk_metrics.append(MetricValue(
                key=gate.get("gate", "unknown"),
                value=gate.get("observed"),
                label=gate.get("gate", "").replace("_", " ").title(),
                threshold=_parse_threshold(gate.get("threshold")),
                status="red" if gate.get("severity") == "hard" else "amber",
                description=gate.get("message"),
            ))

        sections["risk"] = Section(
            id="risk",
            label="Risk Assessment",
            icon="⚠️",
            color="#EF4444",
            base_level=1,
            levels={
                1: LevelData(level=1, metrics=risk_metrics),
            },
        )

    # Create biology section from features
    features = audit_data.get("features", {})
    if features:
        bio_metrics = []
        for key, feature in features.items():
            if isinstance(feature, dict):
                bio_metrics.append(MetricValue(
                    key=key,
                    value=feature.get("value"),
                    label=key.replace("_", " ").title(),
                    description=feature.get("notes"),
                ))

        if bio_metrics:
            sections["biology"] = Section(
                id="biology",
                label="Biology",
                icon="🧬",
                color="#10B981",
                base_level=1,
                levels={
                    1: LevelData(level=1, metrics=bio_metrics),
                },
            )

    # Create evidence section from reasons
    reasons = audit_data.get("reasons", {})
    positive = reasons.get("positive", [])
    negative = reasons.get("negative", [])

    if positive or negative:
        evidence_artifacts = []

        # Build markdown content for evidence
        evidence_md = "## Key Evidence\n\n"

        if positive:
            evidence_md += "### Supporting Evidence\n"
            for item in positive:
                evidence_md += f"- **{item.get('feature', 'Unknown')}** (+{item.get('weight', 0)}): {item.get('text', '')}\n"

        if negative:
            evidence_md += "\n### Concerns\n"
            for item in negative:
                evidence_md += f"- **{item.get('feature', 'Unknown')}** (-{item.get('weight', 0)}): {item.get('text', '')}\n"

        evidence_artifacts.append(Artifact(
            id="evidence_summary",
            path="evidence/summary.md",
            media_type="text/markdown",
            label="Evidence Summary",
            section_id="evidence",
            level=3,
            content=ArtifactContent(type="text", value=evidence_md),
        ))

        sections["evidence"] = Section(
            id="evidence",
            label="Evidence",
            icon="📚",
            color="#F97316",
            base_level=3,
            levels={
                3: LevelData(level=3, artifacts=evidence_artifacts),
            },
        )
        print(f"DEBUG: _transform_legacy_audit_to_sections - Created evidence section with {len(evidence_artifacts)} artifacts")

    print(f"DEBUG: _transform_legacy_audit_to_sections - Completed transformation, total sections: {len(sections)}")
    return sections

def \_filter_sections_by_tier(
sections: Dict[str, Section],
tier: str
) -> Dict[str, Section]:
"""Filter sections and levels by tier entitlement"""
entitlement = TIER_ENTITLEMENTS.get(tier, TIER_ENTITLEMENTS["standard"])
max_level = entitlement["max_level"]
allowed_sections = entitlement["sections"]
print(f"DEBUG: \_filter_sections_by_tier - tier: {tier}, max_level: {max_level}, allowed_sections: {allowed_sections}")
print(f"DEBUG: \_filter_sections_by_tier - Input sections: {list(sections.keys())}")

    filtered = {}
    for section_id, section in sections.items():
        if section_id not in allowed_sections:
            print(f"DEBUG: _filter_sections_by_tier - Filtering out section '{section_id}' (not in allowed list)")
            continue

        # Filter levels by max_level
        filtered_levels = {
            level: data
            for level, data in section.levels.items()
            if level <= max_level
        }

        if filtered_levels:
            filtered[section_id] = Section(
                id=section.id,
                label=section.label,
                icon=section.icon,
                color=section.color,
                base_level=section.base_level,
                levels=filtered_levels,
            )
            print(f"DEBUG: _filter_sections_by_tier - Included section '{section_id}' with {len(filtered_levels)} levels (original: {len(section.levels)})")
        else:
            print(f"DEBUG: _filter_sections_by_tier - Excluded section '{section_id}' (no levels <= {max_level})")

    print(f"DEBUG: _filter_sections_by_tier - Filtered from {len(sections)} to {len(filtered)} sections")
    return filtered

def \_rag_to_status(rag: Optional[str]) -> Optional[str]:
"""Convert RAG rating to status"""
if not rag:
return None
rag_lower = rag.lower()
if rag_lower in ("green", "g"):
return "green"
if rag_lower in ("amber", "yellow", "a", "y"):
return "amber"
if rag_lower in ("red", "r"):
return "red"
return "unknown"

def \_verdict_to_status(verdict: Optional[str]) -> Optional[str]:
"""Convert verdict to status"""
if not verdict:
return None
verdict_lower = verdict.lower()
if verdict_lower in ("pass", "go", "proceed"):
return "green"
if verdict_lower in ("watch", "caution", "review"):
return "amber"
if verdict_lower in ("fail", "kill", "drop", "stop"):
return "red"
return "unknown"

def \_parse_threshold(threshold_str: Optional[str]) -> Optional[float]:
"""Parse threshold string to float"""
if not threshold_str:
return None
try: # Remove comparison operators
cleaned = threshold_str.replace("<=", "").replace(">=", "").replace("<", "").replace(">", "").strip()
return float(cleaned)
except (ValueError, TypeError):
return None

# ============================================================================

# API ENDPOINTS

# ============================================================================

@router.get("/{job_id}", response_model=ReportModel)
async def get_report(
job_id: str,
current_user: Dict[str, Any] = Depends(get_current_user),
):
"""
Get the full report model for a job.

    Returns the canonical ReportModel with all sections and levels
    that the user's tier allows.
    """
    print(f"DEBUG: get_report - job_id: {job_id}, user: {_get_user_id(current_user)}")
    job = get_job_with_access(job_id, current_user)
    tier = get_user_tier(job, current_user)
    print(f"DEBUG: get_report - User tier determined: {tier}")

    report = build_report_model_from_audit_data(job, tier, filter_by_tier=True)
    print(f"DEBUG: get_report - Returning report with {len(report.sections)} sections")
    return report

@router.get("/{job_id}/tier/{tier}", response_model=TieredReportResponse)
async def get_tiered_report(
job_id: str,
tier: Tier,
current_user: Dict[str, Any] = Depends(get_current_user),
):
"""
Get report data filtered for a specific tier view.

    - fast_fail: Executive summary (Level 0-1, limited sections)
    - standard: Key metrics (Level 0-2, most sections)
    - deep_dive: Full analysis (Level 0-3, all sections)
    """
    print(f"DEBUG: get_tiered_report - job_id: {job_id}, requested_tier: {tier.value}")
    job = get_job_with_access(job_id, current_user)
    user_tier = get_user_tier(job, current_user)
    print(f"DEBUG: get_tiered_report - user_tier: {user_tier}, requested_tier: {tier.value}")

    # Check if user can access requested tier
    tier_order = ["fast_fail", "standard", "deep_dive"]
    if tier_order.index(tier.value) > tier_order.index(user_tier):
        print(f"DEBUG: get_tiered_report - Access denied: user_tier {user_tier} < requested {tier.value}")
        raise HTTPException(
            status_code=403,
            detail=f"Your subscription tier ({user_tier}) does not include access to {tier.value} reports"
        )

    report = build_report_model_from_audit_data(job, tier.value, filter_by_tier=True)

    entitlement = TIER_ENTITLEMENTS[tier.value]
    all_sections = list(SECTION_CONFIG.keys())
    accessible = [s for s in all_sections if s in entitlement["sections"]]
    locked = [s for s in all_sections if s not in entitlement["sections"]]
    print(f"DEBUG: get_tiered_report - Accessible sections: {len(accessible)}, Locked sections: {len(locked)}")

    return TieredReportResponse(
        report=report,
        tier_info={
            "tier": tier.value,
            "max_level": entitlement["max_level"],
            "description": entitlement["description"],
        },
        accessible_sections=accessible,
        locked_sections=locked,
    )

@router.get("/{job_id}/sections", response_model=SectionsListResponse)
async def list_sections(
job_id: str,
current_user: Dict[str, Any] = Depends(get_current_user),
):
"""
List all sections with access information for the current user's tier.

    Returns section metadata, available levels, and whether each section
    is accessible or locked based on the user's tier.
    """
    print(f"DEBUG: list_sections - job_id: {job_id}")
    job = get_job_with_access(job_id, current_user)
    tier = get_user_tier(job, current_user)
    max_level = get_max_level_for_tier(tier)
    print(f"DEBUG: list_sections - tier: {tier}, max_level: {max_level}")

    # Build full report to get available levels
    report = build_report_model_from_audit_data(job, tier, filter_by_tier=False)
    print(f"DEBUG: list_sections - Report has {len(report.sections)} sections")

    sections = []
    for section_id, config in SECTION_CONFIG.items():
        accessible = is_section_accessible(section_id, tier)
        section_data = report.sections.get(section_id)

        available_levels = []
        if section_data:
            available_levels = sorted(section_data.levels.keys())

        locked_reason = None
        if not accessible:
            locked_reason = f"Upgrade to deep_dive tier to access {config['label']}"

        sections.append(SectionSummary(
            id=section_id,
            label=config["label"],
            icon=config.get("icon"),
            color=config.get("color"),
            base_level=SECTION_LEVEL_MAP.get(section_id, 0),
            available_levels=available_levels,
            accessible=accessible,
            locked_reason=locked_reason,
        ))

    return SectionsListResponse(
        sections=sections,
        current_tier=tier,
        max_level=max_level,
    )

@router.get("/{job_id}/sections/{section_id}", response_model=Section)
async def get_section(
job_id: str,
section_id: str,
level: Optional[int] = Query(None, description="Specific level to return (omit for all accessible)"),
current_user: Dict[str, Any] = Depends(get_current_user),
):
"""
Get data for a specific section.

    Optionally filter to a specific detail level.
    """
    print(f"DEBUG: get_section - job_id: {job_id}, section_id: {section_id}, level: {level}")
    job = get_job_with_access(job_id, current_user)
    tier = get_user_tier(job, current_user)

    # Check section access
    canonical_id = normalize_section_id(section_id)
    print(f"DEBUG: get_section - Normalized section_id: '{section_id}' -> '{canonical_id}'")
    if not is_section_accessible(canonical_id, tier):
        print(f"DEBUG: get_section - Access denied for section '{canonical_id}' with tier '{tier}'")
        raise HTTPException(
            status_code=403,
            detail=f"Section '{section_id}' requires a higher tier subscription"
        )

    report = build_report_model_from_audit_data(job, tier, filter_by_tier=True)

    section = report.sections.get(canonical_id)
    if not section:
        print(f"DEBUG: get_section - Section '{canonical_id}' not found in report, available sections: {list(report.sections.keys())}")
        raise HTTPException(
            status_code=404,
            detail=f"Section '{section_id}' not found in report"
        )

    print(f"DEBUG: get_section - Found section '{canonical_id}' with {len(section.levels)} levels")
    # Filter to specific level if requested
    if level is not None:
        max_level = get_max_level_for_tier(tier)
        if level > max_level:
            raise HTTPException(
                status_code=403,
                detail=f"Level {level} requires a higher tier (max for {tier}: {max_level})"
            )

        if level not in section.levels:
            raise HTTPException(
                status_code=404,
                detail=f"Level {level} not available for section '{section_id}'"
            )

        section = Section(
            id=section.id,
            label=section.label,
            icon=section.icon,
            color=section.color,
            base_level=section.base_level,
            levels={level: section.levels[level]},
        )

    return section

@router.get("/{job_id}/artifacts/{artifact_id}")
async def get_artifact(
job_id: str,
artifact_id: str,
current_user: Dict[str, Any] = Depends(get_current_user),
):
"""
Get a specific artifact's content.

    Returns the artifact with its content if inline, or a download URL if external.
    """
    print(f"DEBUG: get_artifact - job_id: {job_id}, artifact_id: {artifact_id}")
    job = get_job_with_access(job_id, current_user)
    tier = get_user_tier(job, current_user)

    report = build_report_model_from_audit_data(job, tier, filter_by_tier=False)
    print(f"DEBUG: get_artifact - Searching through {len(report.sections)} sections")

    # Search for artifact across all sections
    for section in report.sections.values():
        if not is_section_accessible(section.id, tier):
            print(f"DEBUG: get_artifact - Skipping inaccessible section '{section.id}'")
            continue

        for level_data in section.levels.values():
            for artifact in level_data.artifacts:
                if artifact.id == artifact_id or artifact.widget_id == artifact_id:
                    print(f"DEBUG: get_artifact - Found artifact '{artifact_id}' in section '{section.id}', level {artifact.level}")
                    return {
                        "artifact": artifact.model_dump(),
                        "section_id": section.id,
                        "level": artifact.level,
                    }

    print(f"DEBUG: get_artifact - Artifact '{artifact_id}' not found")
    raise HTTPException(
        status_code=404,
        detail=f"Artifact '{artifact_id}' not found or not accessible"
    )

@router.get("/{job_id}/summary")
async def get_executive_summary(
job_id: str,
current_user: Dict[str, Any] = Depends(get_current_user),
):
"""
Get executive summary data for quick display.

    Returns key metrics, verdict, and action items suitable for
    the TLDR/GB-TAR view.
    """
    print(f"DEBUG: get_executive_summary - job_id: {job_id}")
    job = get_job_with_access(job_id, current_user)
    tier = get_user_tier(job, current_user)

    report = build_report_model_from_audit_data(job, tier, filter_by_tier=True)

    # Extract summary data
    summary_section = report.sections.get("summary")
    risk_section = report.sections.get("risk")
    print(f"DEBUG: get_executive_summary - Has summary_section: {bool(summary_section)}, Has risk_section: {bool(risk_section)}")

    summary_metrics = []
    if summary_section and 0 in summary_section.levels:
        summary_metrics = [m.model_dump() for m in summary_section.levels[0].metrics]
        print(f"DEBUG: get_executive_summary - Extracted {len(summary_metrics)} summary metrics")

    risk_flags = []
    if risk_section:
        for level_data in risk_section.levels.values():
            for metric in level_data.metrics:
                if metric.status in ("red", "amber"):
                    risk_flags.append(metric.model_dump())
    print(f"DEBUG: get_executive_summary - Found {len(risk_flags)} risk flags")

    # Get action items from artifacts
    action_items = []
    if summary_section:
        for level_data in summary_section.levels.values():
            for artifact in level_data.artifacts:
                if artifact.content and artifact.content.type == "table":
                    if "action" in artifact.path.lower():
                        action_items = artifact.content.rows or []
    print(f"DEBUG: get_executive_summary - Found {len(action_items)} action items")

    # Extract verdict
    verdict = None
    for metric in summary_metrics:
        if metric.get("key") == "verdict":
            verdict = metric.get("value")
            break
    print(f"DEBUG: get_executive_summary - Verdict: {verdict}")

    return {
        "target": job.get("target"),
        "indication": job.get("indication"),
        "verdict": verdict,
        "summary_metrics": summary_metrics[:6],  # Top 6 metrics
        "risk_flags": risk_flags[:5],  # Top 5 risks
        "action_items": action_items[:5],  # Top 5 actions
        "tier": tier,
        "generated_at": report.generated_at.isoformat(),
    }

# ============================================================================

# ADMIN ENDPOINTS

# ============================================================================

@router.put("/{job_id}/report-data")
async def update_report_data(
job_id: str,
report_data: Dict[str, Any],
current_user: Dict[str, Any] = Depends(get_admin_user),
):
"""
Update the report_data for a job (admin only).

    Allows uploading processed pipeline output in the canonical
    section/level format.
    """
    print(f"DEBUG: update_report_data - job_id: {job_id}, report_data keys: {list(report_data.keys())}")
    job = find_job(job_id)
    if not job:
        print(f"DEBUG: update_report_data - Job not found: {job_id}")
        raise HTTPException(status_code=404, detail="Job not found")

    updated = update_job(job_id, {"report_data": report_data})
    if not updated:
        print(f"DEBUG: update_report_data - Failed to update job: {job_id}")
        raise HTTPException(status_code=500, detail="Failed to update job")

    print(f"DEBUG: update_report_data - Successfully updated job: {job_id}")
    return {"status": "success", "message": "Report data updated"}

@router.post("/{job_id}/ingest-summary")
async def ingest_summary_json(
job_id: str,
summary_data: Dict[str, Any],
current_user: Dict[str, Any] = Depends(get_admin_user),
):
"""
Ingest a summary.json file and transform it into report_data.

    Handles the pipeline output format and normalizes it for the dashboard.
    """
    print(f"DEBUG: ingest_summary_json - job_id: {job_id}, summary_data keys: {list(summary_data.keys())}")
    job = find_job(job_id)
    if not job:
        print(f"DEBUG: ingest_summary_json - Job not found: {job_id}")
        raise HTTPException(status_code=404, detail="Job not found")

    # Transform summary.json format to report_data format
    sections = {}

    # Handle single-section format
    if "section_id" in summary_data and "levels" in summary_data:
        sections[summary_data["section_id"]] = {"levels": summary_data["levels"]}
        print(f"DEBUG: ingest_summary_json - Single-section format, section_id: {summary_data['section_id']}")

    # Handle multi-section format
    if "sections" in summary_data:
        sections = summary_data["sections"]
        print(f"DEBUG: ingest_summary_json - Multi-section format, sections count: {len(sections)}")

    report_data = {
        "sections": sections,
        "meta": {
            "ingested_at": datetime.utcnow().isoformat(),
            "source": "summary.json",
        }
    }

    updated = update_job(job_id, {"report_data": report_data})
    if not updated:
        print(f"DEBUG: ingest_summary_json - Failed to update job: {job_id}")
        raise HTTPException(status_code=500, detail="Failed to update job")

    print(f"DEBUG: ingest_summary_json - Successfully ingested {len(sections)} sections for job: {job_id}")
    return {
        "status": "success",
        "message": "Summary data ingested",
        "sections_count": len(sections),
    }

class ReportIngestRequest(BaseModel):
"""Request body for ingesting a complete report with sections."""
target: str = Field(..., description="Target symbol (e.g., PPARG)")
indication: str = Field(..., description="Disease indication")
sections: Dict[str, Any] = Field(..., description="Report sections data keyed by section_id")
status: Optional[str] = Field("completed", description="Job status: pending, running, completed, failed")
project_id: Optional[str] = Field(None, description="Optional project ID reference")
summary: Optional[str] = Field(None, description="Optional job summary/description")
job_id: Optional[str] = Field(None, description="Custom job ID (e.g., user_id-MMDDYYYY). Auto-generated if not provided.")
user_id: Optional[str] = Field(None, description="User ID to assign job to. Defaults to current admin user.")

@router.post("/ingest")
async def ingest_full_report(
request: ReportIngestRequest,
current_user: Dict[str, Any] = Depends(get_admin_user),
):
"""
Ingest a complete report by creating a new job with all section data.

    This endpoint is used by the admin panel to upload report_sections directories.
    It creates a new job document with:
    - target, indication metadata
    - All section data in both audit_data and report_data fields
    - Status as specified (defaults to "completed")
    - Custom job_id if provided (format: user_id-MMDDYYYY)
    """
    print(f"DEBUG: ingest_full_report - target: {request.target}, indication: {request.indication}, sections_count: {len(request.sections)}")
    # Validate status
    valid_statuses = {"pending", "running", "completed", "failed", "received", "queued", "in_progress", "in_review", "cancelled"}
    job_status = request.status if request.status in valid_statuses else "completed"
    print(f"DEBUG: ingest_full_report - job_status: {job_status}")

    now = datetime.utcnow()
    admin_user_id = str(current_user.get("_id") or current_user.get("id"))

    # Use provided user_id or default to admin
    owner_user_id = request.user_id or admin_user_id
    print(f"DEBUG: ingest_full_report - owner_user_id: {owner_user_id}, admin_user_id: {admin_user_id}")

    # Generate custom job_id if not provided
    custom_job_id = request.job_id
    if not custom_job_id:
        date_suffix = now.strftime("%m%d%Y")
        custom_job_id = f"{owner_user_id}-{date_suffix}"
    print(f"DEBUG: ingest_full_report - custom_job_id: {custom_job_id}")

    # Build the report_data structure
    report_data = {
        "sections": request.sections,
        "meta": {
            "ingested_at": now.isoformat() + "Z",
            "source": "admin_upload",
        }
    }
    print(f"DEBUG: ingest_full_report - Built report_data with {len(request.sections)} sections")

    # Create the job document
    job_doc = {
        "job_id": custom_job_id,  # Custom searchable job ID
        "owner_id": owner_user_id,
        "user_id": owner_user_id,
        "target": request.target,
        "indication": request.indication,
        "status": job_status,
        "summary": request.summary or f"Audit for {request.target}",
        "audit_data": report_data,
        "report_data": report_data,
        "submitted_at": now,
        "updated_at": now,
    }

    if request.project_id:
        job_doc["project_id"] = request.project_id
        print(f"DEBUG: ingest_full_report - Added project_id: {request.project_id}")

    # Insert into MongoDB
    result = jobs_col().insert_one(job_doc)
    print(f"DEBUG: ingest_full_report - Inserted job with _id: {result.inserted_id}, job_id: {custom_job_id}")

    return {
        "status": "success",
        "message": "Report ingested successfully",
        "job_id": custom_job_id,
        "_id": str(result.inserted_id),
        "sections_count": len(request.sections),
        "target": request.target,
        "indication": request.indication,
    }

@router.put("/{job_id}/ingest")
async def update_report_with_ingest(
job_id: str,
request: ReportIngestRequest,
current_user: Dict[str, Any] = Depends(get_admin_user),
):
"""
Update an existing job with new report section data.

    Similar to ingest_full_report but updates an existing job instead of creating new.
    """
    print(f"DEBUG: update_report_with_ingest - job_id: {job_id}, target: {request.target}, sections_count: {len(request.sections)}")
    job = find_job(job_id)
    if not job:
        print(f"DEBUG: update_report_with_ingest - Job not found: {job_id}")
        raise HTTPException(status_code=404, detail="Job not found")

    # Validate status
    valid_statuses = {"pending", "running", "completed", "failed"}
    job_status = request.status if request.status in valid_statuses else "completed"
    print(f"DEBUG: update_report_with_ingest - job_status: {job_status}")

    now = datetime.utcnow()

    # Build the report_data structure
    report_data = {
        "sections": request.sections,
        "meta": {
            "ingested_at": now.isoformat() + "Z",
            "source": "admin_upload",
        }
    }
    print(f"DEBUG: update_report_with_ingest - Built report_data with {len(request.sections)} sections")

    # Update the job
    update_fields = {
        "target": request.target,
        "indication": request.indication,
        "status": job_status,
        "audit_data": report_data,
        "report_data": report_data,
        "updated_at": now,
    }

    if request.summary:
        update_fields["summary"] = request.summary
    if request.project_id:
        update_fields["project_id"] = request.project_id
        print(f"DEBUG: update_report_with_ingest - Added project_id: {request.project_id}")

    print(f"DEBUG: update_report_with_ingest - Updating job with fields: {list(update_fields.keys())}")
    updated = update_job(job_id, update_fields)
    if not updated:
        print(f"DEBUG: update_report_with_ingest - Failed to update job: {job_id}")
        raise HTTPException(status_code=500, detail="Failed to update job")

    print(f"DEBUG: update_report_with_ingest - Successfully updated job: {job_id}")
    return {
        "status": "success",
        "message": "Report updated successfully",
        "job_id": job_id,
        "sections_count": len(request.sections),
        "target": request.target,
        "indication": request.indication,
    }

import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from ..auth import get_admin_user, get_current_user as \_get_current_user
get_current_user = \_get_current_user # alias to avoid NameError during import
from ..mongo_repos import (
create_intake,
list_intake,
find_intake,
create_project,
find_first_project_for_user,
create_job,
)
from ..mongodb import get_mongo_db
from ..services.file_storage import file_storage
from ..schemas import (
IntakeSubmissionCreate,
IntakeSubmissionResponse,
IntakeSubmissionRead,
IntakeSubmissionDetail,
)

router = APIRouter(prefix="/intake", tags=["intake"])

@router.get("/admin/all", response*model=list[IntakeSubmissionRead])
async def list_all_intake_submissions(
*: Dict[str, Any] = Depends(get_admin_user),
):
"""Admin endpoint to retrieve all intake submissions"""
submissions = list_intake()
if not submissions:
return []

# counts will be filled when fetching attachments on demand

return [
_serialize_submission(sub, attachment_count=0) for sub in submissions
]

@router.get("/admin/{submission*id}", response_model=IntakeSubmissionDetail)
async def get_intake_submission(
submission_id: str,
*: Dict[str, Any] = Depends(get_admin_user),
):
submission = find_intake(submission_id)
if not submission:
raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

# Query parent docs and flatten the nested uploaded_files arrays

parent_docs = list(get_mongo_db().uploaded_files.find({"submission_id": submission_id}))
attachments = []
for parent in parent_docs:
for f in parent.get("uploaded_files", []):
f_copy = dict(f)
f_copy["id"] = str(f_copy.pop("\_id", f_copy.get("id", ""))) # Ensure required fields have values
f_copy.setdefault("user_id", parent.get("user_id", ""))
f_copy.setdefault("submission_id", submission_id)
attachments.append(f_copy)

# Sort by uploaded_at descending

attachments.sort(key=lambda d: d.get("uploaded_at", ""), reverse=True)

base = \_serialize_submission(submission, attachment_count=len(attachments))
return {
\*\*base,
"attachments": attachments,
}

@router.get("/admin/{submission*id}/download")
async def download_intake_submission(
submission_id: str,
*: Dict[str, Any] = Depends(get_admin_user),
):
submission = find_intake(submission_id)
if not submission:
raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

# Query parent docs and flatten the nested uploaded_files arrays

parent_docs = list(get_mongo_db().uploaded_files.find({"submission_id": submission_id}))
attachments = []
for parent in parent_docs:
for f in parent.get("uploaded_files", []):
attachments.append(f)

# Sort by uploaded_at ascending

attachments.sort(key=lambda d: d.get("uploaded_at", ""))

archive = await \_build_submission_archive(submission, attachments)
filename = \_build_archive_filename(submission)
headers = {
"Content-Disposition": f'attachment; filename="{filename}"'
}
return StreamingResponse(archive, media_type="application/zip", headers=headers)

@router.post("", response_model=IntakeSubmissionResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_intake(
payload: IntakeSubmissionCreate,
current_user: Dict[str, Any] = Depends(get_current_user),
):

# Use user profile as defaults; payload overrides only if provided

company = payload.company_name or current_user.get("company_name") or ""
contact = payload.contact_name or current_user.get("full_name") or ""
email = payload.email or current_user.get("email")
phone = current_user.get("phone_number")

stored_payload = {
\*\*(payload.details or {}),
"company_name": company,
"contact_name": contact,
"email": email,
"phone_number": phone,
"target_of_interest": payload.target_of_interest,
"indication": payload.indication,
}

# Get user_id using helper function

def \_get_user_id(doc: Dict[str, Any]) -> str:
"""Get user_id from document, falling back to \_id conversion for backward compatibility."""
return doc.get("user_id") or str(doc.get("\_id") or doc.get("id"))

user_id = \_get_user_id(current_user)

# Ensure project exists for this user

project = find_first_project_for_user(user_id)
if not project:
project = create_project(
{
"user_id": user_id,
"name": f"Intake - {payload.target_of_interest}",
"slug": f"intake-{payload.target_of_interest}-{str(current_user['_id'])[:6]}",
"is_example": False,
}
) # set default project
from ..mongo_repos import update_user as update_user_doc
update_user_doc(user_id, {"default_project_id": str(project["_id"])})

project_id = str(project["_id"])

# Create job tied to the project

job = create_job(
{
"user_id": user_id,
"project_id": project_id,
"target": payload.target_of_interest,
"indication": payload.indication,
"summary": (payload.details or {}).get("summary") if payload.details else None,
"status": "received",
"audit_data": None,
}
)

submission = create_intake(
{
"user_id": user_id,
"project_id": project_id,
"job_id": str(job["_id"]),
"company_name": company,
"contact_name": contact,
"email": email,
"target_of_interest": payload.target_of_interest,
"indication": payload.indication,
"payload": json.dumps(stored_payload, default=str),
"attachment_ids": [], # Initialize empty list, files will be linked via add_attachment_to_intake
}
)
return IntakeSubmissionResponse(id=str(submission["_id"]), submitted_at=submission.get("submitted_at"))

def \_serialize_submission(submission: Dict[str, Any], attachment_count: int = 0) -> Dict[str, Any]:
return {
"id": str(submission.get("\_id") or submission.get("id")),
"company_name": submission.get("company_name"),
"contact_name": submission.get("contact_name"),
"email": submission.get("email"),
"target_of_interest": submission.get("target_of_interest"),
"indication": submission.get("indication"),
"payload": \_parse_payload(submission.get("payload")),
"submitted_at": submission.get("submitted_at"),
"attachment_count": attachment_count,
"attachment_ids": submission.get("attachment_ids", []),
"job_id": submission.get("job_id"),
"project_id": submission.get("project_id"),
}

def \_parse_payload(payload_raw: str | None) -> Dict[str, Any]:
if not payload_raw:
return {}
try:
parsed = json.loads(payload_raw)
if isinstance(parsed, dict):
return parsed
return {"value": parsed}
except json.JSONDecodeError:
return {}

async def \_build_submission_archive(submission: Dict[str, Any], attachments: list[Dict[str, Any]]) -> io.BytesIO:
buffer = io.BytesIO()
submission_payload = \_serialize_submission(submission, attachment_count=len(attachments))
manifest: Dict[str, Any] = {
"generated_at": datetime.now(timezone.utc).isoformat(),
"submission_id": submission_payload["id"],
"submission": submission_payload,
"attachments": [],
}

with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
zip_file.writestr(
"submission.json",
json.dumps(submission_payload, indent=2, default=str),
)

    for index, attachment in enumerate(attachments, start=1):
      archive_filename = f"attachments/{index:02d}_{_safe_filename(attachment.get('original_filename') or attachment.get('filename') or 'file')}"
      try:
        content = await file_storage.get_file_content(attachment["file_path"])
      except Exception as exc:  # pragma: no cover - network/storage failures
        raise HTTPException(
          status_code=status.HTTP_502_BAD_GATEWAY,
          detail=f"Failed to fetch attachment '{attachment.get('original_filename') or attachment.get('filename')}': {exc}",
        ) from exc

      zip_file.writestr(archive_filename, content)
      manifest["attachments"].append(
        {
          "id": str(attachment.get("_id") or attachment.get("id")),
          "original_filename": attachment.get("original_filename"),
          "stored_filename": attachment.get("filename"),
          "archive_path": archive_filename,
          "category": attachment.get("category"),
          "description": attachment.get("description"),
          "file_type": attachment.get("file_type"),
          "file_size": attachment.get("file_size"),
          "uploaded_at": attachment.get("uploaded_at").isoformat() if attachment.get("uploaded_at") else None,
        }
      )

    zip_file.writestr("manifest.json", json.dumps(manifest, indent=2, default=str))

buffer.seek(0)
return buffer

def _build_archive_filename(submission: Dict[str, Any]) -> str:
submitted_at = submission.get("submitted_at")
timestamp = submitted_at.strftime("%Y%m%dT%H%M%S") if submitted_at else submission.get("id", "intake")
company_slug = \_safe_filename(submission.get("company_name"), fallback="intake")
return f"{company_slug}_{timestamp}\_intake.zip"

def _safe_filename(value: str | None, fallback: str = "file") -> str:
if not value:
return fallback
cleaned = "".join(char if char.isalnum() or char in ("-", "_", ".") else "-" for char in value.strip())
cleaned = cleaned.strip("-\_.")
return cleaned or fallback

from typing import Dict, Any
from fastapi import APIRouter, Depends, status, BackgroundTasks

from ..mongo_repos import create_contact
from ..schemas import ContactSubmissionCreate, ContactSubmissionResponse
from ..config import get_settings
from ..utils.email import send_email, format_contact_submission_email

router = APIRouter(prefix="/contact", tags=["contact"])

async def send_contact_notification_email(
full_name: str,
email: str,
company_name: str | None,
phone_number: str | None,
topic: str | None,
message: str,
allow_contact: bool,
):
"""Background task to send email notification."""
settings = get_settings()

    # Get recipient emails (contact form emails, or fallback to admin emails, or MAIL_* variables)
    recipient_emails = settings.get_contact_recipient_emails()

    if not recipient_emails:
        # If no admin emails configured, skip sending
        return

    # Format email
    subject, html_body = format_contact_submission_email(
        full_name=full_name,
        email=email,
        company_name=company_name,
        phone_number=phone_number,
        topic=topic,
        message=message,
        allow_contact=allow_contact,
    )

    # Get SMTP settings (with fallback to MAIL_* variables)
    smtp_host = settings.get_smtp_host()
    smtp_user = settings.get_smtp_user()
    smtp_password = settings.get_smtp_password()
    smtp_from_email = settings.get_smtp_from_email()

    # Send email (only if SMTP is configured)
    if smtp_host and smtp_user and smtp_password:
        await send_email(
            to_emails=recipient_emails,
            subject=subject,
            html_body=html_body,
            smtp_host=smtp_host,
            smtp_port=settings.smtp_port,
            smtp_user=smtp_user,
            smtp_password=smtp_password,
            from_email=smtp_from_email or smtp_user,
        )

@router.post("/", response_model=ContactSubmissionResponse, status_code=status.HTTP_202_ACCEPTED)
async def submit_contact(
payload: ContactSubmissionCreate,
background_tasks: BackgroundTasks,
):
submission = create_contact(
{
"full_name": payload.full_name.strip(),
"email": str(payload.email),
"company_name": payload.company_name.strip() if payload.company_name else None,
"phone_number": payload.phone_number.strip() if payload.phone_number else None,
"topic": payload.topic.strip() if payload.topic else None,
"message": payload.message.strip(),
"allow_contact": payload.allow_contact,
}
)

    # Send email notification in background
    background_tasks.add_task(
        send_contact_notification_email,
        full_name=submission.get("full_name"),
        email=submission.get("email"),
        company_name=submission.get("company_name"),
        phone_number=submission.get("phone_number"),
        topic=submission.get("topic"),
        message=submission.get("message"),
        allow_contact=submission.get("allow_contact", True),
    )

    return ContactSubmissionResponse(
        id=str(submission["_id"]),
        submitted_at=submission.get("submitted_at"),
    )

from datetime import datetime
from typing import List, Dict, Any

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, get_admin_user
from ..mongo_repos import (
list_blog_published,
find_blog_by_slug,
create_blog,
update_blog,
delete_blog,
blog_col,
)
from ..schemas import (
BlogPostMongoCreate,
BlogPostMongoOut,
BlogPostMongoUpdate,
)

router = APIRouter(prefix="/blog", tags=["blog"])

@router.get("/posts", response_model=List[BlogPostMongoOut])
async def list_posts():
return list_blog_published()

@router.get("/admin/posts", response_model=List[BlogPostMongoOut])
async def list_all_posts_admin(user: Dict[str, Any] = Depends(get_admin_user)):
cursor = blog_col().find({}).sort([("published_at", -1), ("created_at", -1)]).limit(100)
posts = list(cursor)
for post in posts:
post["id"] = str(post.pop("\_id"))
if "updated_at" not in post:
post["updated_at"] = post.get("created_at", datetime.utcnow())
return posts

@router.get("/posts/{slug}", response_model=BlogPostMongoOut)
async def read_post(slug: str):
post = find_blog_by_slug(slug)
if not post:
raise HTTPException(status_code=404, detail="Post not found")
return post

@router.post("/posts", response_model=BlogPostMongoOut)
async def create_post(
payload: BlogPostMongoCreate,
user: Dict[str, Any] = Depends(get_current_user),
): # Convert Pydantic model to dict, handling HttpUrl fields
try: # Try Pydantic v2 method first
payload_dict = payload.model_dump(mode="json")
except AttributeError: # Fallback to Pydantic v1 method
payload_dict = payload.dict()

    # Explicitly convert HttpUrl fields to strings
    if "featured_image" in payload_dict:
        payload_dict["featured_image"] = str(payload_dict["featured_image"]) if payload_dict.get("featured_image") else None

    payload_dict["slug"] = payload_dict["slug"].lower()
    existing = blog_col().find_one({"slug": payload_dict["slug"]})
    if existing:
        raise HTTPException(status_code=400, detail="Slug already in use")
    post = create_blog(payload_dict)
    return post

@router.patch("/posts/{slug}", response_model=BlogPostMongoOut)
async def update_post(
slug: str,
payload: BlogPostMongoUpdate,
user: Dict[str, Any] = Depends(get_current_user),
): # Convert Pydantic model to dict, handling HttpUrl fields
try: # Try Pydantic v2 method first
update_data = payload.model_dump(mode="json", exclude_unset=True)
except AttributeError: # Fallback to Pydantic v1 method
update_data = payload.dict(exclude_unset=True)

    # Explicitly convert HttpUrl fields to strings
    if "featured_image" in update_data:
        update_data["featured_image"] = str(update_data["featured_image"]) if update_data.get("featured_image") else None

    if "slug" in update_data:
        update_data["slug"] = update_data["slug"].lower()
        existing = blog_col().find_one({"slug": update_data["slug"]})
        if existing and existing.get("slug") != slug:
            raise HTTPException(status_code=400, detail="Slug already in use")
    updated = update_blog(slug, update_data)
    if not updated:
        raise HTTPException(status_code=404, detail="Post not found")
    return updated

@router.delete("/posts/{slug}")
async def delete_post(
slug: str,
user: Dict[str, Any] = Depends(get_current_user),
):
deleted = delete_blog(slug)
if not deleted:
raise HTTPException(status_code=404, detail="Post not found")
return {"detail": "deleted"}

"""
File storage service for handling molecular data file uploads using Google Cloud Storage.
"""
import os
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import UploadFile
from google.cloud import storage
from google.cloud.exceptions import Conflict, NotFound

class FileStorageService:
def **init**(self):
"""Initialize Google Cloud Storage client (lazy initialization)."""
self.\_client: Optional[storage.Client] = None
self.\_bucket: Optional[storage.Bucket] = None
self.bucket_name = (
os.getenv("GCS_BUCKET_NAME")
or os.getenv("S3_BUCKET_NAME") # Backwards compatibility with existing env vars
or "molecular-data-storage"
)
self.bucket_location = os.getenv("GCS_BUCKET_LOCATION", "US")
self.project_id = os.getenv("GOOGLE_CLOUD_PROJECT")

    def reset_client(self):
        """Reset cached client/bucket so credentials or project changes take effect."""
        self._client = None
        self._bucket = None

    @property
    def client(self) -> storage.Client:
        """Lazy initialization of Google Cloud Storage client."""
        if self._client is None:
            if self.project_id:
                self._client = storage.Client(project=self.project_id)
            else:
                self._client = storage.Client()
        return self._client

    @property
    def bucket(self) -> storage.Bucket:
        """Return the configured bucket, creating it if necessary."""
        if self._bucket is None:
            client = self.client
            bucket = client.bucket(self.bucket_name)
            try:
                exists = bucket.exists(client=client)
            except Exception as exc:  # pragma: no cover - network/permissions failure
                raise RuntimeError(f"Unable to verify bucket '{self.bucket_name}': {exc}") from exc

            if not exists:
                try:
                    bucket = client.create_bucket(self.bucket_name, location=self.bucket_location)
                except Conflict:
                    # Bucket already exists but was created by another project; just reference it
                    bucket = client.bucket(self.bucket_name)
                except Exception as exc:  # pragma: no cover
                    raise RuntimeError(f"Unable to create bucket '{self.bucket_name}': {exc}") from exc

            self._bucket = bucket
        return self._bucket

    def _get_file_size_str(self, size_bytes: int) -> str:
        """Convert bytes to human-readable format."""
        for unit in ["B", "KB", "MB", "GB"]:
            if size_bytes < 1024.0:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024.0
        return f"{size_bytes:.1f} TB"

    def _determine_category(self, filename: str, file_type: str) -> str:
        """Determine file category based on extension and type."""
        ext = Path(filename).suffix.lower()

        # Molecular structure files
        if ext in [".sdf", ".mol", ".mol2", ".pdb", ".xyz", ".smiles"]:
            return "structures"

        # Data files
        if ext in [".csv", ".tsv", ".xlsx", ".xls"]:
            return "assay_results"

        # Documents
        if ext in [".pdf", ".doc", ".docx"]:
            return "literature"

        # JSON/XML data
        if ext in [".json", ".xml"]:
            return "molecular_data"

        # Protocols/text
        if ext in [".txt", ".md", ".rtf"]:
            return "protocols"

        return "other"

    def _build_blob_path(
        self,
        user_id: str,
        category: str,
        filename: str,
        *,
        project_id: Optional[str] = None,
        job_id: Optional[str] = None,
        submission_id: Optional[str] = None,
    ) -> str:
        """
        Build bucket path for uploaded files.

        Path structure:
        - users/{user_id}/projects/{project_id}/jobs/{job_id}/01_sources/{filename}

        Falls back to simpler paths if project_id or job_id not provided:
        - users/{user_id}/projects/{project_id}/01_sources/{filename}
        - users/{user_id}/01_sources/{filename}
        """
        base_path = f"users/{user_id}"

        if project_id:
            base_path = f"{base_path}/projects/{project_id}"

        if job_id:
            base_path = f"{base_path}/jobs/{job_id}"

        # Always use 01_sources folder for uploaded files
        return f"{base_path}/01_sources/{filename}"

    async def save_file(
        self,
        file: UploadFile,
        user_id: str,
        category: Optional[str] = None,
        project_id: Optional[str] = None,
        job_id: Optional[str] = None,
        submission_id: Optional[str] = None,
    ) -> dict:
        """
        Save uploaded file to Google Cloud Storage and return metadata.

        Args:
            file: The uploaded file from FastAPI
            user_id: User ID who owns the file
            category: Optional category override
            project_id: Optional project ID (stored in DB, not path)
            job_id: Optional job ID (stored in DB, not path)
            submission_id: Optional submission ID (stored in DB, not path)

        Returns:
            dict with file metadata:
                'filename': stored filename (with UUID prefix),
                'original_filename': original filename,
                'file_path': GCS object path,
                'file_size': human-readable size,
                'file_type': MIME type,
                'file_extension': file extension,
                'category': file category
        """
        original_filename = file.filename or "upload"
        file_ext = Path(original_filename).suffix.lower()

        # Keep original filename readable but add short UUID prefix to prevent collisions
        # Format: {short_uuid}_{original_filename}
        short_uuid = str(uuid.uuid4())[:8]
        safe_original = self._sanitize_filename(original_filename)
        stored_filename = f"{short_uuid}_{safe_original}"

        if category is None:
            category = self._determine_category(original_filename, file.content_type or "")

        blob_path = self._build_blob_path(
            user_id,
            category,
            stored_filename,
            project_id=project_id,
            job_id=job_id,
            submission_id=submission_id,
        )

        content = await file.read()
        file_size = len(content)
        blob = self.bucket.blob(blob_path)
        blob.metadata = {
            "original_filename": original_filename,
            "category": category,
        }
        blob.upload_from_string(content, content_type=file.content_type or "application/octet-stream")

        return {
            "filename": stored_filename,
            "original_filename": original_filename,
            "file_path": blob_path,
            "file_size": self._get_file_size_str(file_size),
            "file_type": file.content_type or "application/octet-stream",
            "file_extension": file_ext,
            "category": category,
        }

    def _sanitize_filename(self, filename: str) -> str:
        """Sanitize filename to be safe for storage while keeping it readable."""
        # Replace problematic characters with underscores
        safe_chars = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_")
        result = "".join(c if c in safe_chars else "_" for c in filename)
        # Collapse multiple underscores
        while "__" in result:
            result = result.replace("__", "_")
        return result.strip("_") or "file"

    async def delete_file(self, file_path: str) -> bool:
        """Delete a file from Google Cloud Storage."""
        blob = self.bucket.blob(file_path)
        try:
            blob.delete()
            return True
        except NotFound:
            return False
        except Exception as exc:  # pragma: no cover
            print(f"Error deleting file from GCS: {exc}")
            return False

    def get_presigned_url(self, file_path: str, expiration: int = 3600) -> Optional[str]:
        """
        Generate a signed URL for downloading a file from GCS.

        Args:
            file_path: Storage key of the file
            expiration: URL expiration time in seconds (default 1 hour)

        Returns:
            Signed URL string, or None if generation fails
        """
        import logging
        logger = logging.getLogger(__name__)

        if not file_path:
            logger.error("get_presigned_url: file_path is empty")
            return None

        blob = self.bucket.blob(file_path)
        try:
            # Check if blob exists first
            if not blob.exists():
                logger.error(f"get_presigned_url: Blob does not exist at path: {file_path}")
                return None

            url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(seconds=expiration),
                method="GET",
            )
            logger.info(f"get_presigned_url: Successfully generated URL for {file_path}")
            return url
        except Exception as exc:
            logger.error(f"Error generating signed URL for {file_path}: {exc}", exc_info=True)
            return None

    async def get_file_content(self, file_path: str) -> bytes:
        """
        Download file content from GCS.

        Args:
            file_path: Storage key of the file

        Returns:
            File content as bytes
        """
        blob = self.bucket.blob(file_path)
        try:
            return blob.download_as_bytes()
        except NotFound:
            raise
        except Exception as exc:  # pragma: no cover
            print(f"Error downloading file from GCS: {exc}")
            raise

    def list_files(self, prefix: str = "") -> list:
        """
        List files and folders in GCS bucket with optional prefix.

        Args:
            prefix: Key prefix to filter files/folders (default root)

        Returns:
            List of dicts with keys: 'key', 'size', 'last_modified'
        """
        iterator = self.client.list_blobs(
            self.bucket_name,
            prefix=prefix or None,
            delimiter="/",
        )

        files = []
        for page in iterator.pages:
            for folder in getattr(page, "prefixes", []):
                files.append({"key": folder, "size": 0, "last_modified": None})
            for blob in page:
                if blob.name.endswith("/"):
                    continue
                files.append(
                    {
                        "key": blob.name,
                        "size": blob.size,
                        "last_modified": blob.updated.isoformat() if blob.updated else None,
                    }
                )

        return files

    def file_exists(self, file_path: str) -> bool:
        """Check if a file exists in GCS."""
        blob = self.bucket.blob(file_path)
        try:
            return blob.exists()
        except Exception as exc:  # pragma: no cover
            print(f"Error checking file existence: {exc}")
            return False

# Global instance

file_storage = FileStorageService()

from datetime import datetime
from typing import Optional, List, Dict, Any
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorCollection
from pydantic import HttpUrl

from .mongodb import get_mongo_db

def \_convert_httpurls_to_strings(data: Any) -> Any:
"""
Recursively convert HttpUrl instances to strings in a data structure.
Handles dicts, lists, and nested structures.
"""
if isinstance(data, HttpUrl):
return str(data)
elif isinstance(data, dict):
return {key: \_convert_httpurls_to_strings(value) for key, value in data.items()}
elif isinstance(data, list):
return [_convert_httpurls_to_strings(item) for item in data]
else:
return data

def get_blog_collection() -> AsyncIOMotorCollection:
"""Get blog_posts collection."""
db = get_mongo_db()
return db.blog_posts

async def list_published(limit: int = 100) -> List[Dict[str, Any]]:
"""List published posts, sorted by published_at descending."""
collection = get_blog_collection()
cursor = collection.find(
{"status": "published"}
).sort("published_at", -1).limit(limit)
posts = await cursor.to_list(length=limit) # Convert ObjectId to string and ensure required fields
for post in posts:
post["id"] = str(post.pop("\_id")) # Ensure updated_at exists (use created_at as fallback if missing)
if "updated_at" not in post:
post["updated_at"] = post.get("created_at", datetime.utcnow())
return posts

async def get_by_slug(slug: str, include_draft: bool = False) -> Optional[Dict[str, Any]]:
"""Get a post by slug. By default only returns published posts."""
collection = get_blog_collection()
query = {"slug": slug}
if not include_draft:
query["status"] = "published"
post = await collection.find_one(query)
if post:
post["id"] = str(post.pop("\_id")) # Ensure updated_at exists (use created_at as fallback if missing)
if "updated_at" not in post:
post["updated_at"] = post.get("created_at", datetime.utcnow())
return post

async def create_post(payload: Dict[str, Any]) -> Dict[str, Any]:
"""Create a new blog post."""
collection = get_blog_collection()
now = datetime.utcnow()

    # Convert any HttpUrl instances to strings before inserting
    payload = _convert_httpurls_to_strings(payload)

    # Prepare document
    doc = {
        "title": payload["title"],
        "slug": payload["slug"],
        "excerpt": payload.get("excerpt"),
        "category": payload.get("category"),
        "featured_image": payload.get("featured_image"),
        "body_html": payload["body_html"],
        "status": payload.get("status", "draft"),
        "published_at": payload.get("published_at"),
        "authors": payload.get("authors"),
        "tags": payload.get("tags"),
        "created_at": now,
        "updated_at": now,
    }

    # If status is published and no published_at set, use now
    if doc["status"] == "published" and not doc["published_at"]:
        doc["published_at"] = now

    result = await collection.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)

    # Ensure updated_at is present (should already be set above)
    if "updated_at" not in doc:
        doc["updated_at"] = doc.get("created_at", datetime.utcnow())

    return doc

async def update_post(slug: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
"""Update a blog post by slug (works for both draft and published)."""
collection = get_blog_collection()

    # Convert any HttpUrl instances to strings before updating
    payload = _convert_httpurls_to_strings(payload)

    # Build update document
    update_doc = {"updated_at": datetime.utcnow()}

    if "title" in payload:
        update_doc["title"] = payload["title"]
    if "slug" in payload:
        update_doc["slug"] = payload["slug"]
    if "excerpt" in payload:
        update_doc["excerpt"] = payload["excerpt"]
    if "category" in payload:
        update_doc["category"] = payload["category"]
    if "featured_image" in payload:
        update_doc["featured_image"] = payload["featured_image"]
    if "body_html" in payload:
        update_doc["body_html"] = payload["body_html"]
    if "status" in payload:
        update_doc["status"] = payload["status"]
        # If status changed to published and no published_at, set it
        if payload["status"] == "published":
            existing = await collection.find_one({"slug": slug})
            if existing and not existing.get("published_at"):
                update_doc["published_at"] = datetime.utcnow()
    if "published_at" in payload:
        update_doc["published_at"] = payload["published_at"]
    if "authors" in payload:
        update_doc["authors"] = payload["authors"]
    if "tags" in payload:
        update_doc["tags"] = payload["tags"]

    result = await collection.find_one_and_update(
        {"slug": slug},
        {"$set": update_doc},
        return_document=True
    )

    if result:
        result["id"] = str(result.pop("_id"))
        # Ensure updated_at exists (should be set above, but double-check)
        if "updated_at" not in result:
            result["updated_at"] = result.get("created_at", datetime.utcnow())

    return result

async def delete_post(slug: str) -> bool:
"""Delete a blog post by slug."""
collection = get_blog_collection()
result = await collection.delete_one({"slug": slug})
return result.deleted_count > 0
