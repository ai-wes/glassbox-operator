import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { nanoid } from "nanoid";
import type { ActionMap } from "../upstreams/types.js";
import { UpstreamManager } from "../upstreams/upstreamManager.js";

import { isProbablyMutatingTool } from "../playbooks/actionRunner.js";

import { revopsLeadCapture, RevOpsPlaybookInputSchema } from "../playbooks/revops.js";
import { revopsInboxTriageToCrm, RevOpsInboxTriageInputSchema } from "../playbooks/revopsInboxTriage.js";
import { revopsPipelineHygiene, RevOpsPipelineHygieneInputSchema } from "../playbooks/revopsPipelineHygiene.js";
import { revopsWeeklyExecBrief, RevOpsWeeklyExecBriefInputSchema } from "../playbooks/revopsWeeklyExecBrief.js";
import { engopsStatus, EngOpsStatusInputSchema } from "../playbooks/engops.js";
import { opsGlassboxDaily, OpsDailyInputSchema } from "../playbooks/opsDaily.js";

import { registerOutlookTools } from "../integrations/outlook.js";
import { registerAirtableTools } from "../integrations/airtable.js";
import { registerClayTools } from "../integrations/clay.js";
import { registerGcpTools } from "../integrations/gcp.js";
import { registerGlassboxTools } from "../integrations/glassbox.js";

import type { KnowledgeVault } from "../kb/knowledgeVault.js";
import type { Neo4jGraph, GraphArtifact, GraphAction } from "../graph/neo4j.js";
import { sha256Text } from "../graph/hash.js";
import type { OperatorDb } from "../controlPlane/persistence/db.js";
import type { Audit } from "../controlPlane/audit.js";
import type { Neo4jGraph as ControlPlaneGraph } from "../controlPlane/graph/neo4j.js";
import { buildExecutionPlan, executeApprovedActions } from "../controlPlane/execution.js";
import { expandDraftKindFilter, normalizeDraftKind } from "../controlPlane/persistence/drafts.js";
import type { DraftCreateInput, DraftKindInput } from "../controlPlane/persistence/drafts.js";
import { parseTags, tagsToJson } from "../controlPlane/persistence/kb.js";

function toText(obj: any) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function safeStr(x: any, max = 20000): string {
  const s = x == null ? "" : String(x);
  return s.length > max ? s.slice(0, max) : s;
}

function collectArtifactsFromObject(obj: any): GraphArtifact[] {
  const artifacts: GraphArtifact[] = [];

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
  db: OperatorDb;
  audit: Audit;
  controlPlaneGraph?: ControlPlaneGraph;
  actorId: string;
  operatorVersion: string;
  maxPersistBytes: number;
}) {
  const { mgr, actionMap, allowWriteGlobal, kb, graph, db, audit, controlPlaneGraph, actorId, operatorVersion, maxPersistBytes } = opts;
  const server = new McpServer({ name: "operator", version: operatorVersion || "1.2.0" });

  const childServers = new Map(
    mgr.listUpstreams().map((u) => [
      u.id,
      {
        name: u.id,
        tools: u.tools,
        callTool: async (toolName: string, args: Record<string, any>) => {
          return await u.callTool(toolName, args);
        }
      }
    ])
  );

  const ArpActionType = z.enum([
    "email_draft_create",
    "email_followup_draft",
    "email_send",
    "crm_create_lead",
    "crm_update_opportunity",
    "crm_stage_change",
    "lead_enrich_person",
    "lead_enrich_company",
    "lead_enrich_batch",
    "linkedin_post_draft_create",
    "linkedin_comment_draft_create",
    "linkedin_post_ready_to_publish",
    "blog_post_draft_create",
    "blog_post_publish",
    "vercel_deploy_redeploy",
    "vercel_env_update",
    "gcp_deploy_cloudrun",
    "gcp_logs_query",
    "github_issue_create",
    "github_pr_review_draft",
    "github_pr_merge",
    "glassbox_pipeline_run_phase",
    "glassbox_report_publish_or_ingest",
    "kb_doc_upsert",
    "kb_doc_link_to_action",
    "graph_log_event",
    "send_email",
    "update_crm",
    "publish_post",
    "deploy",
    "enrich_lead",
    "create_task",
    "other"
  ]);

  const ArpActionSchema = z
    .object({
      id: z.string().min(1),
      type: ArpActionType,
      risk: z.enum(["low", "medium", "high"]),
      requires_approval: z.boolean(),
      payload_ref: z.string().min(1),
      notes: z.string().optional(),
      executor: z
        .object({
          server: z.string().min(1),
          tool: z.string().min(1),
          arguments: z.record(z.any()).optional(),
          pass_draft: z.boolean().optional(),
          operation: z.enum(["draft", "send", "update", "create", "other"]).optional()
        })
        .optional()
    })
    .passthrough();

  // ---------------------------
  // Status / routing
  // ---------------------------
  server.tool("operator_status", {}, async () => {
    const dbHealth = db.healthCheck();
    const children = mgr.listUpstreams().map((u) => ({
      name: u.id,
      connected: !u.lastError,
      toolCount: u.tools.length,
      error: u.lastError
    }));
    return toText({
      ok: true,
      version: operatorVersion,
      actorId,
      dbHealthy: dbHealth.ok,
      dbError: dbHealth.ok ? null : dbHealth.error || "unknown",
      neo4jEnabled: Boolean(controlPlaneGraph),
      childServers: children,
      featureFlags: {
        kb: true,
        drafts: true,
        arp: true,
        execution_v0: true,
        audit: true,
        graph: Boolean(controlPlaneGraph),
        child_routing: children.length > 0
      }
    });
  });

  const enableChildRouting =
    process.env.OPERATOR_ENABLE_CHILD_ROUTING === "1" || mgr.listUpstreams().length > 0;
  if (enableChildRouting) {
    server.tool("child_tools_list", {}, async () => {
      const payload = mgr.listUpstreams().map((u) => ({
        server: u.id,
        tools: u.tools
      }));
      return toText(payload);
    });

    server.tool(
      "child_tool_call",
      {
        server: z.string().min(1),
        tool: z.string().min(1),
        arguments: z.record(z.any()).optional()
      },
      async ({ server: childName, tool, arguments: toolArgs }) => {
        const child = mgr.get(childName);
        const toolDef = child.tools.find((t) => t.name === tool);
        if (!toolDef) {
          return toText({ ok: false, error: `child server "${childName}" does not have tool "${tool}"` });
        }

        const { value } = await audit.withToolRun(
          tool,
          childName,
          { tool, arguments: toolArgs || {} },
          async () => {
            return await child.callTool(tool, toolArgs || {});
          }
        );

        return value as any;
      }
    );
  }

  // ---------------------------
  // KB tools
  // ---------------------------
  server.tool(
    "kb_upsert",
    {
      id: z.string().optional(),
      type: z.enum([
        "policy",
        "procedure",
        "messaging",
        "legal",
        "sales_playbook",
        "faq",
        "product_spec",
        "pricing",
        "case_study",
        "sales",
        "marketing",
        "product",
        "engineering",
        "other"
      ]),
      title: z.string().min(1),
      body: z.string().min(1),
      source: z.string().optional(),
      owner: z.string().optional(),
      visibility: z.enum(["public", "internal", "restricted"]).optional(),
      tags: z.array(z.string()).optional()
    },
    async (input) => {
      const { runId, value } = await audit.withToolRun("kb_upsert", "operator", input, async (runId) => {
        const id = input.id || `${input.title}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
        const now = new Date().toISOString();
        const existing = db.getKbDoc(id);

        db.upsertKbDoc({
          id,
          type: input.type,
          title: input.title,
          body: input.body,
          source: input.source || null,
          owner: input.owner || null,
          visibility: input.visibility || null,
          tags_json: tagsToJson(input.tags),
          created_at: existing?.created_at || now,
          updated_at: now
        });

        db.insertEvent({
          id: nanoid(),
          type: existing ? "kb_doc_updated" : "kb_doc_created",
          entityId: id,
          payloadJson: JSON.stringify({
            id,
            type: input.type,
            title: input.title,
            source: input.source || null,
            tags: input.tags || []
          }),
          createdAt: now
        });

        if (controlPlaneGraph) {
          await controlPlaneGraph.upsertDocument({
            docId: id,
            type: input.type,
            title: input.title,
            source: input.source || null,
            owner: input.owner || null,
            visibility: input.visibility || null,
            tags: input.tags || null,
            updatedAt: now
          });
          await controlPlaneGraph.linkToolRunToDocument(runId, id, existing ? "updated" : "created");
        }

        // Keep legacy KnowledgeVault in sync for UI reads
        kb.upsert({ slug: id, title: input.title, content: input.body, tags: input.tags ?? [], updated_at: now });

        return { id, updatedAt: now };
      });

      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "kb_upsert_doc",
    {
      slug: z.string().min(1),
      title: z.string().min(1),
      content: z.any(),
      tags: z.array(z.string()).optional()
    },
    async ({ slug, title, content, tags }) => {
      const { runId, value } = await audit.withToolRun(
        "kb_upsert_doc",
        "operator",
        { slug, title, tags },
        async (runId) => {
          const now = new Date().toISOString();
          const body = typeof content === "string" ? content : JSON.stringify(content ?? null);
          const existing = db.getKbDoc(slug);

          db.upsertKbDoc({
            id: slug,
            type: "other",
            title,
            body,
            source: null,
            owner: null,
            visibility: null,
            tags_json: tagsToJson(tags),
            created_at: existing?.created_at || now,
            updated_at: now
          });

          db.insertEvent({
            id: nanoid(),
            type: existing ? "kb_doc_updated" : "kb_doc_created",
            entityId: slug,
            payloadJson: JSON.stringify({ id: slug, type: "other", title, tags: tags || [] }),
            createdAt: now
          });

          if (controlPlaneGraph) {
            await controlPlaneGraph.upsertDocument({
              docId: slug,
              type: "other",
              title,
              source: null,
              owner: null,
              visibility: null,
              tags: tags || null,
              updatedAt: now
            });
            await controlPlaneGraph.linkToolRunToDocument(runId, slug, existing ? "updated" : "created");
          }

          kb.upsert({ slug, title, content, tags: tags ?? [], updated_at: now });

          await graph.logEvent({
            kind: "kb.upsert",
            status: "EXECUTED",
            actor: "operator",
            payload: { slug, title, tags }
          });

          return { slug };
        }
      );

      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "kb_list",
    { limit: z.number().int().min(1).max(100).optional().default(20), offset: z.number().int().min(0).optional().default(0) },
    async ({ limit, offset }) => {
      const { runId, value } = await audit.withToolRun("kb_list", "operator", { limit, offset }, async () => {
        const rows = db.listKbDocs(limit, offset);
        return {
          limit,
          offset,
          docs: rows.map((d) => ({
            id: d.id,
            type: d.type,
            title: d.title,
            source: d.source,
            owner: d.owner ?? null,
            visibility: d.visibility ?? null,
            tags: parseTags(d.tags_json),
            createdAt: d.created_at,
            updatedAt: d.updated_at
          }))
        };
      });
      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "kb_get",
    { id: z.string().optional(), slug: z.string().optional() },
    async ({ id, slug }) => {
      const docId = (id || slug || "").trim();
      if (!docId) return toText({ ok: false, error: "missing id" });

      const { runId, value } = await audit.withToolRun("kb_get", "operator", { id: docId }, async (runId) => {
        const doc = db.getKbDoc(docId);
        if (!doc) return { found: false };

        audit.touchDocFromRun(runId, docId, "touched");

        return {
          found: true,
          doc: {
            id: doc.id,
            type: doc.type,
            title: doc.title,
            body: doc.body,
            source: doc.source,
            owner: doc.owner ?? null,
            visibility: doc.visibility ?? null,
            tags: parseTags(doc.tags_json),
            createdAt: doc.created_at,
            updatedAt: doc.updated_at
          }
        };
      });
      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "kb_delete",
    { id: z.string().min(1) },
    async ({ id }) => {
      const { runId, value } = await audit.withToolRun("kb_delete", "operator", { id }, async () => {
        const ok = db.deleteKbDoc(id);
        db.insertEvent({
          id: nanoid(),
          type: "kb_doc_deleted",
          entityId: id,
          payloadJson: JSON.stringify({ id, ok }),
          createdAt: new Date().toISOString()
        });
        return { ok };
      });
      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "kb_doc_link_to_action",
    {
      action_id: z.string().min(1),
      doc_id: z.string().min(1),
      relation: z.string().optional()
    },
    async ({ action_id, doc_id, relation }) => {
      const { runId, value } = await audit.withToolRun(
        "kb_doc_link_to_action",
        "operator",
        { action_id, doc_id, relation },
        async () => {
          const action = db.getArpAction(action_id);
          const doc = db.getKbDoc(doc_id);
          if (!action) return { ok: false, error: "action_not_found" };
          if (!doc) return { ok: false, error: "doc_not_found" };

          const now = new Date().toISOString();
          db.linkDoc({
            id: nanoid(),
            fromKind: "action",
            fromId: action_id,
            toDocId: doc_id,
            relation: relation || "cited",
            createdAt: now
          });

          db.insertEvent({
            id: nanoid(),
            type: "kb_doc_linked_to_action",
            entityId: action_id,
            payloadJson: JSON.stringify({ action_id, doc_id, relation: relation || "cited" }),
            createdAt: now
          });

          if (controlPlaneGraph) {
            await controlPlaneGraph.linkDocumentToAction(doc_id, action_id);
          }

          return { ok: true, action_id, doc_id, relation: relation || "cited" };
        }
      );

      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "kb_search",
    { query: z.string().min(1), limit: z.number().int().min(1).max(50).optional().default(10) },
    async ({ query, limit }) => {
      const { runId, value } = await audit.withToolRun("kb_search", "operator", { query, limit }, async (runId) => {
        const rows = db.searchKb(query, limit);
        const results = rows.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          source: r.source,
          owner: r.owner ?? null,
          visibility: r.visibility ?? null,
          tags: parseTags(r.tags_json),
          updatedAt: r.updated_at,
          snippet: r.snippet
        }));

        for (const r of results) {
          audit.touchDocFromRun(runId, r.id, "touched");
        }

        return { query, results };
      });
      return toText({ ok: true, runId, ...value });
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
      try {
        parsed = txt ? JSON.parse(txt) : null;
      } catch {
        // ignore
      }

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

      for (const d of docs) {
        const now = new Date().toISOString();
        const body = typeof d.content === "string" ? d.content : JSON.stringify(d.content ?? null);
        const existing = db.getKbDoc(d.slug);
        db.upsertKbDoc({
          id: d.slug,
          type: "other",
          title: d.title,
          body,
          source: "glassbox",
          owner: null,
          visibility: null,
          tags_json: tagsToJson(d.tags),
          created_at: existing?.created_at || now,
          updated_at: d.updated_at || now
        });
      }

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
  // Drafts
  // ---------------------------
  server.tool(
    "draft_create",
    {
      kind: z.enum([
        "email_draft",
        "linkedin_post_draft",
        "blog_post_draft",
        "crm_note_draft",
        "proposal_draft",
        "ops_runbook_draft",
        "other",
        "email",
        "linkedin_post",
        "blog_post",
        "proposal",
        "meeting_notes"
      ]),
      title: z.string().optional(),
      body: z.string().min(1),
      meta: z.record(z.any()).optional(),
      status: z
        .enum([
          "draft",
          "ready_for_review",
          "approved",
          "queued",
          "executed",
          "archived",
          "rejected",
          "ready_to_send",
          "ready_to_post",
          "ready_to_publish"
        ])
        .optional()
    },
    async (input: DraftCreateInput & { meta?: Record<string, any> }) => {
      const { runId, value } = await audit.withToolRun("draft_create", "operator", input, async (runId) => {
        const id = nanoid();
        const now = new Date().toISOString();
        const normalizedKind = normalizeDraftKind(input.kind as DraftKindInput);
        const status = input.status || "draft";
        db.createDraft({
          id,
          kind: normalizedKind,
          title: input.title || null,
          body: input.body,
          status,
          meta_json: input.meta ? JSON.stringify(input.meta) : null,
          created_at: now,
          updated_at: now
        });

        db.insertEvent({
          id: nanoid(),
          type: "draft_created",
          entityId: id,
          payloadJson: JSON.stringify({ id, kind: normalizedKind, title: input.title || null }),
          createdAt: now
        });

        if (controlPlaneGraph) {
          await controlPlaneGraph.upsertDraft({
            id,
            kind: normalizedKind,
            title: input.title || null,
            status,
            createdAt: now,
            updatedAt: now
          });
          await controlPlaneGraph.linkToolRunToDraft(runId, id);
        }

        audit.recordDraftCreated(runId, id);
        return { id, status, createdAt: now };
      });

      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "draft_get",
    { id: z.string().min(1) },
    async ({ id }) => {
      const { runId, value } = await audit.withToolRun("draft_get", "operator", { id }, async () => {
        const d = db.getDraft(id);
        if (!d) return { found: false };
        return {
          found: true,
          draft: {
            id: d.id,
            kind: d.kind,
            title: d.title,
            body: d.body,
            status: d.status,
            meta: d.meta_json ? JSON.parse(d.meta_json) : null,
            createdAt: d.created_at,
            updatedAt: d.updated_at
          }
        };
      });
      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "draft_list",
    {
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
      kind: z
        .enum([
          "email_draft",
          "linkedin_post_draft",
          "blog_post_draft",
          "crm_note_draft",
          "proposal_draft",
          "ops_runbook_draft",
          "other",
          "email",
          "linkedin_post",
          "blog_post",
          "proposal",
          "meeting_notes"
        ])
        .optional(),
      status: z.string().optional()
    },
    async ({ limit, offset, kind, status }) => {
      const { runId, value } = await audit.withToolRun("draft_list", "operator", { limit, offset, kind, status }, async () => {
        const kindFilter = expandDraftKindFilter(kind as DraftKindInput | undefined);
        const rows = db.listDrafts(limit, offset, kindFilter, status);
        return {
          limit,
          offset,
          drafts: rows.map((d) => ({
            id: d.id,
            kind: d.kind,
            title: d.title,
            status: d.status,
            createdAt: d.created_at,
            updatedAt: d.updated_at
          }))
        };
      });
      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "draft_set_status",
    { id: z.string().min(1), status: z.string().min(1) },
    async ({ id, status }) => {
      const { runId, value } = await audit.withToolRun("draft_set_status", "operator", { id, status }, async () => {
        const now = new Date().toISOString();
        db.updateDraftStatus(id, status, now);
        db.insertEvent({
          id: nanoid(),
          type: "draft_status_changed",
          entityId: id,
          payloadJson: JSON.stringify({ id, status }),
          createdAt: now
        });
        if (controlPlaneGraph) {
          const d = db.getDraft(id);
          if (d) {
            await controlPlaneGraph.upsertDraft({
              id: d.id,
              kind: d.kind,
              title: d.title,
              status,
              createdAt: d.created_at,
              updatedAt: now
            });
          }
        }
        return { id, status, updatedAt: now };
      });
      return toText({ ok: true, runId, ...value });
    }
  );

  // ---------------------------
  // ARP + execution v0
  // ---------------------------
  server.tool(
    "arp_ingest",
    { arp_json: z.any(), actor: z.string().optional() },
    async ({ arp_json, actor }) => {
      const { runId, value } = await audit.withToolRun("arp_ingest", "operator", { actor }, async () => {
        const now = new Date().toISOString();
        const packetId = String(arp_json?.run_id || arp_json?.packet_id || nanoid());

        if (db.getArpPacket(packetId)) {
          return { ok: false, error: "Packet already exists", packet_id: packetId };
        }

        const rawActions = Array.isArray(arp_json?.proposed_actions)
          ? arp_json.proposed_actions
          : Array.isArray(arp_json?.actions)
            ? arp_json.actions
            : [];

        const parsedActions = rawActions.map((a: any) => {
          const parsed = ArpActionSchema.safeParse(a);
          if (!parsed.success) {
            throw new Error(`Invalid action: ${parsed.error.message}`);
          }
          return parsed.data;
        });

        db.createArpPacket({
          id: packetId,
          source: String(arp_json?.run_id || ""),
          actor: actor || actorId,
          payloadJson: JSON.stringify(arp_json ?? null),
          createdAt: now
        });

        if (controlPlaneGraph) {
          await controlPlaneGraph.upsertRun({
            runId: packetId,
            source: String(arp_json?.run_id || ""),
            actor: actor || actorId,
            createdAt: now
          });
        }

        for (const a of parsedActions) {
          const details = a.executor ? { executor: a.executor } : (a as any).details;
          const payloadKind = (a as any).payload_kind ? String((a as any).payload_kind) : null;
          const status = (a as any).status ? String((a as any).status) : a.requires_approval ? "proposed" : "approved";

          db.createArpAction({
            id: a.id,
            packetId,
            actionType: a.type,
            risk: a.risk,
            requiresApproval: a.requires_approval,
            status,
            payloadKind,
            payloadRef: a.payload_ref,
            notes: a.notes || null,
            detailsJson: details ? JSON.stringify(details) : null,
            createdAt: now,
            updatedAt: now
          });

          db.insertEvent({
            id: nanoid(),
            type: "arp_action_created",
            entityId: a.id,
            payloadJson: JSON.stringify({ action_id: a.id, packet_id: packetId, type: a.type }),
            createdAt: now
          });

          if (controlPlaneGraph) {
            await controlPlaneGraph.upsertAction({
              id: a.id,
              type: a.type,
              risk: a.risk,
              requiresApproval: a.requires_approval,
              status,
              payloadKind,
              payloadRef: a.payload_ref
            });
            await controlPlaneGraph.linkRunToAction(packetId, a.id, "proposed");
            if (payloadKind === "draft" && a.payload_ref) {
              await controlPlaneGraph.linkActionToDraft(a.id, a.payload_ref);
            }
          }
        }

        db.insertEvent({
          id: nanoid(),
          type: "arp_packet_ingested",
          entityId: packetId,
          payloadJson: JSON.stringify({ packet_id: packetId, action_count: parsedActions.length }),
          createdAt: now
        });

        return { ok: true, packet_id: packetId, action_count: parsedActions.length };
      });

      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "arp_get",
    { packet_id: z.string().min(1) },
    async ({ packet_id }) => {
      const { runId, value } = await audit.withToolRun("arp_get", "operator", { packet_id }, async () => {
        const packet = db.getArpPacket(packet_id);
        if (!packet) return { found: false };
        const actions = db.listArpActions(packet_id);
        let payload: any = null;
        if (packet.payload_json) {
          try {
            payload = JSON.parse(packet.payload_json);
          } catch {
            payload = null;
          }
        }
        return {
          found: true,
          packet: {
            id: packet.id,
            source: packet.source,
            actor: packet.actor,
            payload,
            createdAt: packet.created_at
          },
          actions
        };
      });
      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "arp_action_set_status",
    { action_id: z.string().min(1), status: z.string().min(1) },
    async ({ action_id, status }) => {
      const { runId, value } = await audit.withToolRun("arp_action_set_status", "operator", { action_id, status }, async () => {
        const now = new Date().toISOString();
        const ok = db.updateArpActionStatus(action_id, status, now);
        db.insertEvent({
          id: nanoid(),
          type: "arp_action_status_changed",
          entityId: action_id,
          payloadJson: JSON.stringify({ action_id, status }),
          createdAt: now
        });
        if (controlPlaneGraph) {
          const action = db.getArpAction(action_id);
          if (action) {
            await controlPlaneGraph.upsertAction({
              id: action.id,
              type: action.action_type,
              risk: action.risk,
              requiresApproval: Boolean(action.requires_approval),
              status,
              payloadKind: action.payload_kind,
              payloadRef: action.payload_ref
            });
          }
        }
        return { ok, action_id, status, updatedAt: now };
      });
      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "arp_action_set_executor",
    {
      action_id: z.string().min(1),
      executor: z.object({
        server: z.string().min(1),
        tool: z.string().min(1),
        arguments: z.record(z.any()).optional(),
        pass_draft: z.boolean().optional(),
        operation: z.enum(["draft", "send", "update", "create", "other"]).optional()
      })
    },
    async ({ action_id, executor }) => {
      const { runId, value } = await audit.withToolRun(
        "arp_action_set_executor",
        "operator",
        { action_id, executor },
        async () => {
          const now = new Date().toISOString();
          const existing = db.getArpAction(action_id);
          if (!existing) return { ok: false, error: "Action not found" };

          const current = (() => {
            try {
              return existing.details_json ? JSON.parse(existing.details_json) : {};
            } catch {
              return {};
            }
          })();

          const next = {
            ...current,
            executor: {
              server: executor.server,
              tool: executor.tool,
              arguments: executor.arguments || {},
              pass_draft: Boolean(executor.pass_draft),
              operation: executor.operation || "other"
            }
          };

          const ok = db.updateArpActionDetails(action_id, JSON.stringify(next), now);

          db.insertEvent({
            id: nanoid(),
            type: "arp_action_executor_set",
            entityId: action_id,
            payloadJson: JSON.stringify({ action_id, executor: next.executor }),
            createdAt: now
          });

          return { ok: true, updated: ok, action_id, executor: next.executor };
        }
      );

      return toText({ ok: true, runId, ...value });
    }
  );

  server.tool(
    "arp_execute_plan",
    {
      packet_id: z.string().min(1),
      include_high_risk: z.boolean().optional().default(false),
      max_actions: z.number().int().min(1).max(50).optional().default(20),
      only_action_ids: z.array(z.string()).optional()
    },
    async ({ packet_id, include_high_risk, max_actions, only_action_ids }) => {
      const { runId, value } = await audit.withToolRun(
        "arp_execute_plan",
        "operator",
        { packet_id, include_high_risk, max_actions, only_action_ids },
        async () => {
          const plan = await buildExecutionPlan({
            packetId: packet_id,
            db,
            childServers,
            includeHighRisk: include_high_risk,
            maxActions: max_actions,
            onlyActionIds: only_action_ids
          });
          return plan;
        }
      );

      return toText({ ok: true, runId, plan: value });
    }
  );

  server.tool(
    "arp_execute_approved",
    {
      packet_id: z.string().min(1),
      include_high_risk: z.boolean().optional().default(false),
      allow_email_send: z.boolean().optional().default(false),
      max_actions: z.number().int().min(1).max(50).optional().default(20),
      only_action_ids: z.array(z.string()).optional()
    },
    async ({ packet_id, include_high_risk, allow_email_send, max_actions, only_action_ids }) => {
      const { runId, value } = await audit.withToolRun(
        "arp_execute_approved",
        "operator",
        { packet_id, include_high_risk, allow_email_send, max_actions, only_action_ids },
        async () => {
          const result = await executeApprovedActions({
            packetId: packet_id,
            db,
            audit: audit.withToolRun.bind(audit),
            graph: controlPlaneGraph,
            childServers,
            maxPersistBytes,
            opts: {
              mode: "execute",
              includeHighRisk: include_high_risk,
              allowEmailSend: allow_email_send,
              maxActions: max_actions,
              onlyActionIds: only_action_ids
            }
          });
          return result;
        }
      );

      return toText({ ok: true, runId, result: value });
    }
  );

  server.tool(
    "arp_execution_history",
    { packet_id: z.string().min(1), limit: z.number().int().min(1).max(200).optional().default(50) },
    async ({ packet_id, limit }) => {
      const rows = db.listActionExecutionsForPacket(packet_id, limit);
      return toText({ ok: true, packet_id, executions: rows });
    }
  );

  // ---------------------------
  // Audit
  // ---------------------------
  server.tool(
    "audit_recent_tool_runs",
    { limit: z.number().int().min(1).max(200).default(50) },
    async ({ limit }) => {
      const rows = db.listRecentToolRuns(limit);
      return toText({ ok: true, toolRuns: rows });
    }
  );

  server.tool(
    "audit_recent_events",
    { limit: z.number().int().min(1).max(200).default(50) },
    async ({ limit }) => {
      const rows = db.listRecentEvents(limit);
      return toText({ ok: true, events: rows });
    }
  );

  // ---------------------------
  // Neo4j (control-plane)
  // ---------------------------
  server.tool(
    "neo4j.cypher_run",
    {
      cypher: z.string().min(1),
      params: z.record(z.any()).optional(),
      mode: z.enum(["read", "write"]).optional().default("read")
    },
    async ({ cypher, params, mode }) => {
      if (!controlPlaneGraph) {
        return toText({ ok: false, error: "neo4j_not_configured" });
      }
      const { runId, value } = await audit.withToolRun(
        "neo4j.cypher_run",
        "operator",
        { cypher, params, mode },
        async () => {
          const res = await controlPlaneGraph.runCypher({ cypher, parameters: params || {}, mode });
          return res;
        }
      );
      return toText({ ok: true, runId, ...value });
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
    {
      action_id: z.string().min(1),
      status: z.enum(["PROPOSED", "APPROVED", "REJECTED", "EXECUTED", "BLOCKED", "FAILED"])
    },
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
      actor: z.enum(["task", "operator", "system"]).optional().default("task")
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

      return toText({
        ok: true,
        ingested: true,
        kind,
        artifacts: artifacts.length,
        actions: actions.length
      });
    }
  );

  // ---------------------------
  // Operator introspection (disabled for ChatGPT app surface)
  // ---------------------------

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
      artifacts: out.brief_text
        ? [
            {
              artifact_id: `artifact:weekly_brief:${sha256Text(out.brief_text).slice(0, 12)}`,
              kind: "report",
              title: "Weekly Revenue Brief",
              body: safeStr(out.brief_text, 20000)
            }
          ]
        : []
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

  // Native integrations (single-container mode)
  registerOutlookTools(server);
  registerAirtableTools(server);
  registerClayTools(server);
  registerGcpTools(server);
  registerGlassboxTools(server);

  return server;
}
