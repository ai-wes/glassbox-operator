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

  // Spec-aligned aliases (orchestrator/pipeline)
  server.tool(
    "glassbox.orchestrator.run_phase",
    {
      project_id: z.string().min(1),
      phase: z.string().min(1),
      options: z.any().optional()
    },
    async ({ project_id, phase, options }) => {
      const body = { project_id, phase, options: options ?? {} };
      const data = await gbRequest("POST", "/orchestrator/run", undefined, body);
      return toText({ ok: true, data });
    }
  );

  server.tool("glassbox.pipeline.list_phases", {}, async () => {
    const data = await gbRequest("GET", "/pipeline/phases");
    return toText({ ok: true, data });
  });

  server.tool(
    "glassbox.pipeline.run",
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

  // Spec-aligned reports tools
  server.tool(
    "glassbox.reports.get_report",
    { job_id: z.string().min(1) },
    async ({ job_id }) => {
      const data = await gbRequest("GET", `/reports/${encodeURIComponent(job_id)}`);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.reports.get_tiered_report",
    { job_id: z.string().min(1) },
    async ({ job_id }) => {
      const data = await gbRequest("GET", `/reports/${encodeURIComponent(job_id)}/tiered`);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.reports.list_sections",
    { job_id: z.string().min(1) },
    async ({ job_id }) => {
      const data = await gbRequest("GET", `/reports/${encodeURIComponent(job_id)}/sections`);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.reports.get_section",
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

  server.tool(
    "glassbox.reports.get_artifact",
    { job_id: z.string().min(1), artifact_id: z.string().min(1) },
    async ({ job_id, artifact_id }) => {
      const data = await gbRequest(
        "GET",
        `/reports/${encodeURIComponent(job_id)}/artifacts/${encodeURIComponent(artifact_id)}`
      );
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.reports.get_executive_summary",
    { job_id: z.string().min(1) },
    async ({ job_id }) => {
      const data = await gbRequest("GET", `/reports/${encodeURIComponent(job_id)}/executive_summary`);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.reports.ingest_summary_json",
    { payload: z.any() },
    async ({ payload }) => {
      const data = await gbRequest("POST", "/reports/ingest_summary_json", undefined, payload);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.reports.ingest_full_report",
    { payload: z.any() },
    async ({ payload }) => {
      const data = await gbRequest("POST", "/reports/ingest_full_report", undefined, payload);
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

  // Spec-aligned documents tools
  server.tool("glassbox.documents.list_documents", {}, async () => {
    const data = await gbRequest("GET", "/documents");
    return toText({ ok: true, data });
  });

  server.tool(
    "glassbox.documents.fetch_document",
    { document_id: z.string().min(1) },
    async ({ document_id }) => {
      const data = await gbRequest("GET", `/documents/${encodeURIComponent(document_id)}`);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.documents.create_document",
    { slug: z.string().min(1), title: z.string().min(1), content: z.any() },
    async (payload) => {
      const data = await gbRequest("POST", "/documents", undefined, payload);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.documents.update_document",
    { document_id: z.string().min(1), patch: z.any() },
    async ({ document_id, patch }) => {
      const data = await gbRequest("PATCH", `/documents/${encodeURIComponent(document_id)}`, undefined, patch);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.documents.delete_document",
    { document_id: z.string().min(1) },
    async ({ document_id }) => {
      const data = await gbRequest("DELETE", `/documents/${encodeURIComponent(document_id)}`);
      return toText({ ok: true, data });
    }
  );

  // Spec-aligned blog tools
  server.tool("glassbox.blog.list_posts", {}, async () => {
    const data = await gbRequest("GET", "/blog/posts");
    return toText({ ok: true, data });
  });

  server.tool(
    "glassbox.blog.read_post",
    { slug: z.string().min(1) },
    async ({ slug }) => {
      const data = await gbRequest("GET", `/blog/posts/${encodeURIComponent(slug)}`);
      return toText({ ok: true, data });
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
      const data = await gbRequest("POST", "/blog/posts", undefined, payload);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.blog.update_post",
    { slug: z.string().min(1), patch: z.any() },
    async ({ slug, patch }) => {
      const data = await gbRequest("PATCH", `/blog/posts/${encodeURIComponent(slug)}`, undefined, patch);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.blog.delete_post",
    { slug: z.string().min(1) },
    async ({ slug }) => {
      const data = await gbRequest("DELETE", `/blog/posts/${encodeURIComponent(slug)}`);
      return toText({ ok: true, data });
    }
  );

  // Spec-aligned files/intake tools
  server.tool(
    "glassbox.files.upload",
    {
      filename: z.string().min(1),
      content_base64: z.string().min(1),
      content_type: z.string().optional(),
      metadata: z.record(z.any()).optional()
    },
    async ({ filename, content_base64, content_type, metadata }) => {
      const body = { filename, content_base64, content_type, metadata };
      const data = await gbRequest("POST", "/files/upload", undefined, body);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.files.list",
    { prefix: z.string().optional(), limit: z.number().int().optional() },
    async ({ prefix, limit }) => {
      const data = await gbRequest("GET", "/files", { prefix, limit });
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.files.get_metadata",
    { file_id: z.string().min(1) },
    async ({ file_id }) => {
      const data = await gbRequest("GET", `/files/${encodeURIComponent(file_id)}`);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.files.download",
    { file_id: z.string().min(1) },
    async ({ file_id }) => {
      const data = await gbRequest("GET", `/files/${encodeURIComponent(file_id)}/download`);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.files.delete",
    { file_id: z.string().min(1) },
    async ({ file_id }) => {
      const data = await gbRequest("DELETE", `/files/${encodeURIComponent(file_id)}`);
      return toText({ ok: true, data });
    }
  );

  server.tool("glassbox.files.list_bucket", {}, async () => {
    const data = await gbRequest("GET", "/files/admin/bucket");
    return toText({ ok: true, data });
  });

  server.tool(
    "glassbox.files.get_download_url",
    { key: z.string().min(1) },
    async ({ key }) => {
      const data = await gbRequest("GET", "/files/admin/download_url", { key });
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.files.delete_key",
    { key: z.string().min(1) },
    async ({ key }) => {
      const data = await gbRequest("DELETE", "/files/admin/delete_key", { key });
      return toText({ ok: true, data });
    }
  );

  server.tool("glassbox.intake.list_submissions", {}, async () => {
    const data = await gbRequest("GET", "/intake/submissions");
    return toText({ ok: true, data });
  });

  server.tool(
    "glassbox.intake.download_archive",
    { submission_id: z.string().min(1) },
    async ({ submission_id }) => {
      const data = await gbRequest("GET", `/intake/submissions/${encodeURIComponent(submission_id)}/archive`);
      return toText({ ok: true, data });
    }
  );

  // Spec-aligned users/projects tools
  server.tool("glassbox.users.me", {}, async () => {
    const data = await gbRequest("GET", "/me");
    return toText({ ok: true, data });
  });

  server.tool(
    "glassbox.users.update_me",
    { patch: z.any() },
    async ({ patch }) => {
      const data = await gbRequest("PATCH", "/me", undefined, patch);
      return toText({ ok: true, data });
    }
  );

  server.tool("glassbox.users.list", {}, async () => {
    const data = await gbRequest("GET", "/admin/users");
    return toText({ ok: true, data });
  });

  server.tool(
    "glassbox.users.update_role",
    { user_id: z.string().min(1), patch: z.any() },
    async ({ user_id, patch }) => {
      const data = await gbRequest("PATCH", `/admin/users/${encodeURIComponent(user_id)}`, undefined, patch);
      return toText({ ok: true, data });
    }
  );

  server.tool(
    "glassbox.users.delete",
    { user_id: z.string().min(1) },
    async ({ user_id }) => {
      const data = await gbRequest("DELETE", `/admin/users/${encodeURIComponent(user_id)}`);
      return toText({ ok: true, data });
    }
  );

  server.tool("glassbox.projects.summary", {}, async () => {
    const data = await gbRequest("GET", "/me/projects/summary");
    return toText({ ok: true, data });
  });

  return server;
}
