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
