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
      const data = await gbRequest(
        "GET",
        `/reports/${encodeURIComponent(job_id)}/sections/${encodeURIComponent(section_id)}`,
        q
      );
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
