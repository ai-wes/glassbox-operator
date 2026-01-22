import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GoogleAuth } from "google-auth-library";
import { jsonRequest } from "./http.js";

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

function toText(obj: any) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

async function getProjectId(explicit?: string) {
  if (explicit) return explicit;
  const env = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  if (env) return env;
  try {
    return await auth.getProjectId();
  } catch {
    throw new Error("Missing project id. Set GOOGLE_CLOUD_PROJECT.");
  }
}

async function gcpRequest(method: "GET" | "POST", url: string, body?: any) {
  const headers = await auth.getRequestHeaders();
  return await jsonRequest({
    method,
    url,
    headers: { ...headers, "Content-Type": "application/json" },
    body,
    timeoutMs: 30000
  });
}

export function registerGcpTools(server: McpServer) {
  server.tool(
    "gcp.cloudrun.list_services",
    {
      project_id: z.string().optional(),
      region: z.string().optional()
    },
    async ({ project_id, region }) => {
      try {
        const project = await getProjectId(project_id);
        const loc = region || process.env.GOOGLE_CLOUD_REGION || "us-central1";
        const url = `https://run.googleapis.com/v2/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(loc)}/services`;
        const data = await gcpRequest("GET", url);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "gcp.cloudrun.list_revisions",
    {
      project_id: z.string().optional(),
      region: z.string().optional(),
      service: z.string().min(1)
    },
    async ({ project_id, region, service }) => {
      try {
        const project = await getProjectId(project_id);
        const loc = region || process.env.GOOGLE_CLOUD_REGION || "us-central1";
        const url = `https://run.googleapis.com/v2/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(loc)}/services/${encodeURIComponent(service)}/revisions`;
        const data = await gcpRequest("GET", url);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "gcp.logs.query",
    {
      project_id: z.string().optional(),
      filter: z.string().min(1),
      limit: z.number().int().min(1).max(1000).optional(),
      order_by: z.string().optional()
    },
    async ({ project_id, filter, limit, order_by }) => {
      try {
        const project = await getProjectId(project_id);
        const url = "https://logging.googleapis.com/v2/entries:list";
        const body: any = {
          resourceNames: [`projects/${project}`],
          filter,
          pageSize: limit || 100,
          orderBy: order_by || "timestamp desc"
        };
        const data = await gcpRequest("POST", url, body);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );
}
