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

  server.tool("kb_get", { slug: z.string().min(1) }, async ({ slug }) => {
    const doc = kb.get(slug);
    await graph.logEvent({
      kind: "kb.get",
      status: doc ? "EXECUTED" : "FAILED",
      actor: "operator",
      payload: { slug }
    });
    return toText({ ok: Boolean(doc), doc });
  });

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

  return server;
}
