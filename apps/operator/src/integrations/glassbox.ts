import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonRequest } from "./http.js";

function toText(obj: any) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function gbConfig() {
  const baseUrl = process.env.GLASSBOX_API_BASE_URL || process.env.GLASSBOX_BASE_URL;
  if (!baseUrl) throw new Error("Missing required env: GLASSBOX_API_BASE_URL (or GLASSBOX_BASE_URL)");
  const cleanBase = baseUrl.replace(/\/+$/, "");
  let apiPrefix = normalizePrefix(process.env.GLASSBOX_API_PREFIX);
  if (!apiPrefix) {
    apiPrefix = cleanBase.endsWith("/api/v1") ? "" : "/api/v1";
  }
  return {
    baseUrl: cleanBase,
    apiPrefix,
    bearer: process.env.GLASSBOX_BEARER_TOKEN || process.env.GLASSBOX_API_KEY || "",
    internalKey: process.env.GLASSBOX_INTERNAL_API_KEY || process.env.GBTA_SECRET_KEY || "",
    timeoutMs: Number(process.env.GLASSBOX_HTTP_TIMEOUT_MS || "45000")
  };
}

async function gbRequest(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, query?: any, body?: any) {
  const cfg = gbConfig();
  if (!path.startsWith("/")) throw new Error("path must start with '/'" );
  if (path.includes("://")) throw new Error("absolute URLs not allowed");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (cfg.bearer) headers["Authorization"] = `Bearer ${cfg.bearer}`;
  if (cfg.internalKey) headers["X-API-Key"] = cfg.internalKey;

  const base = cfg.apiPrefix && !cfg.baseUrl.endsWith(cfg.apiPrefix) ? `${cfg.baseUrl}${cfg.apiPrefix}` : cfg.baseUrl;
  return await jsonRequest({
    method,
    url: `${base}${path}`,
    headers,
    query,
    body,
    timeoutMs: cfg.timeoutMs
  });
}

function normalizePrefix(prefix?: string) {
  if (!prefix) return "";
  const trimmed = prefix.trim();
  if (!trimmed) return "";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, "");
}

export function registerGlassboxTools(server: McpServer) {
  server.tool(
    "gb_request",
    {
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string().min(1),
      query: z.record(z.any()).optional(),
      body: z.any().optional()
    },
    async ({ method, path, query, body }) => {
      try {
        const data = await gbRequest(method as any, path, query, body);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool("gb_projects_summary", {}, async () => {
    try {
      const data = await gbRequest("GET", "/me/projects/summary");
      return toText({ ok: true, data });
    } catch (err: any) {
      return toText({ ok: false, error: err?.message || String(err) });
    }
  });

  server.tool(
    "gb_pipeline_run",
    {
      project_id: z.string().min(1),
      phase: z.string().min(1),
      options: z.any().optional()
    },
    async ({ project_id, phase, options }) => {
      try {
        const body = { project_id, phase, options: options ?? {} };
        const data = await gbRequest("POST", "/pipeline/run", undefined, body);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.orchestrator.run_phase",
    {
      project_id: z.string().min(1),
      phase: z.string().min(1),
      options: z.any().optional()
    },
    async ({ project_id, phase, options }) => {
      try {
        const body = { project_id, phase, options: options ?? {} };
        const data = await gbRequest("POST", "/orchestrator/run", undefined, body);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool("glassbox.pipeline.list_phases", {}, async () => {
    try {
      const data = await gbRequest("GET", "/pipeline/phases");
      return toText({ ok: true, data });
    } catch (err: any) {
      return toText({ ok: false, error: err?.message || String(err) });
    }
  });

  server.tool(
    "glassbox.pipeline.run",
    {
      project_id: z.string().min(1),
      phase: z.string().min(1),
      options: z.any().optional()
    },
    async ({ project_id, phase, options }) => {
      try {
        const body = { project_id, phase, options: options ?? {} };
        const data = await gbRequest("POST", "/pipeline/run", undefined, body);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  // Reports
  server.tool(
    "glassbox.reports.get_report",
    { job_id: z.string().min(1) },
    async ({ job_id }) => {
      try {
        const data = await gbRequest("GET", `/reports/${encodeURIComponent(job_id)}`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.reports.get_tiered_report",
    { job_id: z.string().min(1) },
    async ({ job_id }) => {
      try {
        const data = await gbRequest("GET", `/reports/${encodeURIComponent(job_id)}/tiered`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.reports.list_sections",
    { job_id: z.string().min(1) },
    async ({ job_id }) => {
      try {
        const data = await gbRequest("GET", `/reports/${encodeURIComponent(job_id)}/sections`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.reports.get_section",
    {
      job_id: z.string().min(1),
      section_id: z.string().min(1)
    },
    async ({ job_id, section_id }) => {
      try {
        const data = await gbRequest(
          "GET",
          `/reports/${encodeURIComponent(job_id)}/sections/${encodeURIComponent(section_id)}`
        );
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.reports.get_artifact",
    {
      job_id: z.string().min(1),
      artifact_id: z.string().min(1)
    },
    async ({ job_id, artifact_id }) => {
      try {
        const data = await gbRequest(
          "GET",
          `/reports/${encodeURIComponent(job_id)}/artifacts/${encodeURIComponent(artifact_id)}`
        );
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.reports.get_executive_summary",
    { job_id: z.string().min(1) },
    async ({ job_id }) => {
      try {
        const data = await gbRequest("GET", `/reports/${encodeURIComponent(job_id)}/executive_summary`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.reports.ingest_summary_json",
    { payload: z.any() },
    async ({ payload }) => {
      try {
        const data = await gbRequest("POST", "/reports/ingest_summary_json", undefined, payload);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.reports.ingest_full_report",
    { payload: z.any() },
    async ({ payload }) => {
      try {
        const data = await gbRequest("POST", "/reports/ingest_full_report", undefined, payload);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  // Documents
  server.tool("glassbox.documents.list_documents", {}, async () => {
    try {
      const data = await gbRequest("GET", "/documents");
      return toText({ ok: true, data });
    } catch (err: any) {
      return toText({ ok: false, error: err?.message || String(err) });
    }
  });

  server.tool(
    "glassbox.documents.fetch_document",
    { document_id: z.string().min(1) },
    async ({ document_id }) => {
      try {
        const data = await gbRequest("GET", `/documents/${encodeURIComponent(document_id)}`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.documents.create_document",
    { payload: z.any() },
    async ({ payload }) => {
      try {
        const data = await gbRequest("POST", "/documents", undefined, payload);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.documents.update_document",
    {
      document_id: z.string().min(1),
      patch: z.any()
    },
    async ({ document_id, patch }) => {
      try {
        const data = await gbRequest("PATCH", `/documents/${encodeURIComponent(document_id)}`, undefined, patch);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.documents.delete_document",
    { document_id: z.string().min(1) },
    async ({ document_id }) => {
      try {
        const data = await gbRequest("DELETE", `/documents/${encodeURIComponent(document_id)}`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  // Blog
  server.tool("glassbox.blog.list_posts", {}, async () => {
    try {
      const data = await gbRequest("GET", "/blog/posts");
      return toText({ ok: true, data });
    } catch (err: any) {
      return toText({ ok: false, error: err?.message || String(err) });
    }
  });

  server.tool(
    "glassbox.blog.read_post",
    { slug: z.string().min(1) },
    async ({ slug }) => {
      try {
        const data = await gbRequest("GET", `/blog/posts/${encodeURIComponent(slug)}`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.blog.create_post",
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
      try {
        const data = await gbRequest("POST", "/blog/posts", undefined, payload);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.blog.update_post",
    {
      slug: z.string().min(1),
      patch: z.any()
    },
    async ({ slug, patch }) => {
      try {
        const data = await gbRequest("PATCH", `/blog/posts/${encodeURIComponent(slug)}`, undefined, patch);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.blog.delete_post",
    { slug: z.string().min(1) },
    async ({ slug }) => {
      try {
        const data = await gbRequest("DELETE", `/blog/posts/${encodeURIComponent(slug)}`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  // Files
  server.tool(
    "glassbox.files.upload",
    { payload: z.any() },
    async ({ payload }) => {
      try {
        const data = await gbRequest("POST", "/files/upload", undefined, payload);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.files.list",
    {
      prefix: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional()
    },
    async ({ prefix, limit }) => {
      try {
        const data = await gbRequest("GET", "/files", { prefix, limit });
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.files.get_metadata",
    { file_id: z.string().min(1) },
    async ({ file_id }) => {
      try {
        const data = await gbRequest("GET", `/files/${encodeURIComponent(file_id)}`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.files.download",
    { file_id: z.string().min(1) },
    async ({ file_id }) => {
      try {
        const data = await gbRequest("GET", `/files/${encodeURIComponent(file_id)}/download`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.files.delete",
    { file_id: z.string().min(1) },
    async ({ file_id }) => {
      try {
        const data = await gbRequest("DELETE", `/files/${encodeURIComponent(file_id)}`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool("glassbox.files.list_bucket", {}, async () => {
    try {
      const data = await gbRequest("GET", "/files/admin/bucket");
      return toText({ ok: true, data });
    } catch (err: any) {
      return toText({ ok: false, error: err?.message || String(err) });
    }
  });

  server.tool(
    "glassbox.files.get_download_url",
    { key: z.string().min(1) },
    async ({ key }) => {
      try {
        const data = await gbRequest("GET", "/files/admin/download_url", { key });
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.files.delete_key",
    { key: z.string().min(1) },
    async ({ key }) => {
      try {
        const data = await gbRequest("DELETE", "/files/admin/delete_key", { key });
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  // Users / projects
  server.tool("glassbox.users.me", {}, async () => {
    try {
      const data = await gbRequest("GET", "/users/me");
      return toText({ ok: true, data });
    } catch (err: any) {
      return toText({ ok: false, error: err?.message || String(err) });
    }
  });

  server.tool(
    "glassbox.users.update_me",
    { patch: z.any() },
    async ({ patch }) => {
      try {
        const data = await gbRequest("PATCH", "/users/me", undefined, patch);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool("glassbox.users.list", {}, async () => {
    try {
      const data = await gbRequest("GET", "/admin/users");
      return toText({ ok: true, data });
    } catch (err: any) {
      return toText({ ok: false, error: err?.message || String(err) });
    }
  });

  server.tool(
    "glassbox.users.update_role",
    {
      user_id: z.string().min(1),
      patch: z.any()
    },
    async ({ user_id, patch }) => {
      try {
        const data = await gbRequest("PATCH", `/admin/users/${encodeURIComponent(user_id)}`, undefined, patch);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "glassbox.users.delete",
    { user_id: z.string().min(1) },
    async ({ user_id }) => {
      try {
        const data = await gbRequest("DELETE", `/admin/users/${encodeURIComponent(user_id)}`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );
}
