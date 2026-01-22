import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { nanoid } from "nanoid";

import { loadConfig, loadChildServersConfig } from "./config.js";
import { logger } from "./log.js";
import { OperatorDb } from "./persistence/db.js";
import { Audit } from "./audit.js";
import { Neo4jGraph } from "./graph/neo4j.js";
import { parseTags, tagsToJson } from "./persistence/kb.js";
import { buildExecutionPlan, executeApprovedActions } from "./execution.js";
import { expandDraftKindFilter, normalizeDraftKind } from "./persistence/drafts.js";
import type { DraftCreateInput, DraftKindInput } from "./persistence/drafts.js";

type ChildServerHandle = {
  name: string;
  client: Client;
  tools: Array<{ name: string; description?: string; inputSchema?: any }>;
};

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

async function main() {
  const cfg = loadConfig();
  const operatorVersion = process.env.OPERATOR_VERSION || "0.1.0";
  const db = new OperatorDb(cfg.dbPath);

  // Neo4j optional
  let graph: Neo4jGraph | undefined;
  if (cfg.neo4jUri && cfg.neo4jUser && cfg.neo4jPassword) {
    graph = new Neo4jGraph(cfg.neo4jUri, cfg.neo4jUser, cfg.neo4jPassword);
    await graph.ensureSchema();
    await graph.upsertActor(cfg.actorId, cfg.actorId);
    logger.info("Neo4j connected and schema ensured.");
  } else {
    logger.warn("Neo4j not configured (NEO4J_URI/USER/PASSWORD). Graph logging disabled.");
  }

  const audit = new Audit(db, cfg.actorId, cfg.maxPersistBytes, graph);

  // Child MCP servers (optional)
  const childServers: Map<string, ChildServerHandle> = new Map();
  const childServerStatus: Array<{ name: string; connected: boolean; toolCount?: number; error?: string }> = [];
  const baseEnv = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => typeof v === "string")
  ) as Record<string, string>;
  const childCfg = loadChildServersConfig(cfg.childServersConfigPath);
  if (childCfg) {
    for (const [name, s] of Object.entries(childCfg.mcpServers)) {
      const client = new Client({ name: `operator-child-${name}`, version: "1.0.0" });
      const transport = new StdioClientTransport({
        command: s.command,
        args: s.args || [],
        env: { ...baseEnv, ...(s.env || {}) }
      });
      try {
        await client.connect(transport);
        const toolsResult = await client.listTools();
        const tools = toolsResult.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }));
        childServers.set(name, { name, client, tools });
        childServerStatus.push({ name, connected: true, toolCount: tools.length });
        logger.info({ name, toolCount: tools.length }, "Connected child MCP server");
      } catch (e: any) {
        childServerStatus.push({ name, connected: false, error: e?.message || String(e) });
        logger.error({ name, err: e?.message || String(e) }, "Failed to connect child MCP server");
      }
    }
  } else {
    logger.info("No child MCP servers config found. (Set MCP_SERVERS_CONFIG=/path/to/mcp-servers.json)");
  }

  const server = new McpServer({
    name: "glassbox-operator-control-plane",
    version: "0.1.0"
  });

  const ArpActionType = z.enum([
    // Canonical action types (spec)
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
    // Legacy compatibility
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

  // -----------------------------
  // HEALTH / STATUS
  // -----------------------------
  server.tool(
    "operator_status",
    "Returns Operator control-plane status, including Neo4j + child MCP connectivity.",
    {},
    async () => {
      const dbHealth = db.healthCheck();
      return textResult(
        JSON.stringify(
          {
            ok: true,
            version: operatorVersion,
            actorId: cfg.actorId,
            dbPath: cfg.dbPath,
            dbHealthy: dbHealth.ok,
            dbError: dbHealth.ok ? null : dbHealth.error || "unknown",
            neo4jEnabled: Boolean(graph),
            childServers: childServerStatus,
            featureFlags: {
              kb: true,
              drafts: true,
              arp: true,
              execution_v0: true,
              audit: true,
              graph: Boolean(graph),
              child_routing: childServers.size > 0
            }
          },
          null,
          2
        )
      );
    }
  );

  // -----------------------------
  // CHILD MCP ROUTER (CONTROL PLANE)
  // -----------------------------
  server.tool(
    "child_tools_list",
    "List tools available across child MCP servers (Clay/Airtable/Gmail/Vercel/GCP/GitHub/Glassbox, etc).",
    {},
    async () => {
      const payload = [...childServers.values()].map((c) => ({
        server: c.name,
        tools: c.tools
      }));
      return textResult(JSON.stringify(payload, null, 2));
    }
  );

  server.tool(
    "child_tool_call",
    "Call a tool on a specific child MCP server (control-plane routing).",
    {
      server: z.string().min(1),
      tool: z.string().min(1),
      arguments: z.record(z.any()).optional()
    },
    async ({ server: childName, tool, arguments: toolArgs }) => {
      const child = childServers.get(childName);
      if (!child) {
        return textResult(`ERROR: unknown child server "${childName}"`);
      }

      const toolDef = child.tools.find((t) => t.name === tool);
      if (!toolDef) {
        return textResult(`ERROR: child server "${childName}" does not have tool "${tool}"`);
      }

      const { value } = await audit.withToolRun(
        tool,
        childName,
        { tool, arguments: toolArgs || {} },
        async () => {
          const result = await child.client.callTool({
            name: tool,
            arguments: toolArgs || {}
          });
          return result;
        }
      );

      // Return exactly what the child returned.
      return value as any;
    }
  );

  // -----------------------------
  // KNOWLEDGE BASE (POLICIES / PROCEDURES / MESSAGING / LEGAL / ETC)
  // -----------------------------
  server.tool(
    "kb_upsert",
    "Create or update a company knowledge-base document (policies/procedures/messaging/legal/etc).",
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
        const id = input.id || nanoid();
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
          payloadJson: JSON.stringify({ id, type: input.type, title: input.title, source: input.source || null, tags: input.tags || [] }),
          createdAt: now
        });

        if (graph) {
          await graph.upsertDocument({
            docId: id,
            type: input.type,
            title: input.title,
            source: input.source || null,
            owner: input.owner || null,
            visibility: input.visibility || null,
            tags: input.tags || null,
            updatedAt: now
          });
          await graph.linkToolRunToDocument(runId, id, existing ? "updated" : "created");
        }

        audit.touchDocFromRun(runId, id, existing ? "updated" : "created");

        return { id, updatedAt: now };
      });

      return textResult(JSON.stringify({ ok: true, runId, ...value }, null, 2));
    }
  );

  server.tool(
    "kb_search",
    "Search the company KB (full-text). Returns top matches with snippets.",
    {
      query: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10)
    },
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

        // Touch all docs in graph + sql links for traceability
        for (const r of results) {
          audit.touchDocFromRun(runId, r.id, "touched");
        }

        return { query, results };
      });

      return textResult(JSON.stringify({ ok: true, runId, ...value }, null, 2));
    }
  );

  server.tool(
    "kb_get",
    "Fetch a KB document by id.",
    { id: z.string().min(1) },
    async ({ id }) => {
      const { runId, value } = await audit.withToolRun("kb_get", "operator", { id }, async (runId) => {
        const doc = db.getKbDoc(id);
        if (!doc) return { found: false };

        audit.touchDocFromRun(runId, id, "touched");

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

      return textResult(JSON.stringify({ ok: true, runId, ...value }, null, 2));
    }
  );

  server.tool(
    "kb_list",
    "List KB docs (most recently updated first).",
    {
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0)
    },
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

      return textResult(JSON.stringify({ ok: true, runId, ...value }, null, 2));
    }
  );

  server.tool(
    "kb_delete",
    "Delete a KB doc by id (also deletes doc links).",
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

      return textResult(JSON.stringify({ runId, ...value }, null, 2));
    }
  );

  server.tool(
    "kb_doc_link_to_action",
    "Link a KB document to an ARP action for traceability (e.g., policy cited in action).",
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

          if (graph) {
            await graph.linkDocumentToAction(doc_id, action_id);
          }

          return { ok: true, action_id, doc_id, relation: relation || "cited" };
        }
      );

      return textResult(JSON.stringify({ ok: true, runId, ...value }, null, 2));
    }
  );

  // -----------------------------
  // DRAFTS (marketing/sales ops outputs you approve)
  // -----------------------------
  server.tool(
    "draft_create",
    "Create a draft artifact (LinkedIn post / email / blog post / etc).",
    {
      kind: z.enum([
        "email_draft",
        "linkedin_post_draft",
        "blog_post_draft",
        "crm_note_draft",
        "proposal_draft",
        "ops_runbook_draft",
        "other",
        // legacy inputs
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

        if (graph) {
          await graph.upsertDraft({
            id,
            kind: normalizedKind,
            title: input.title || null,
            status,
            createdAt: now,
            updatedAt: now
          });
          await graph.linkToolRunToDraft(runId, id);
        }

        audit.recordDraftCreated(runId, id);
        return { id, status, createdAt: now };
      });

      return textResult(JSON.stringify({ ok: true, runId, ...value }, null, 2));
    }
  );

  server.tool(
    "draft_get",
    "Fetch a draft by id.",
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
      return textResult(JSON.stringify({ ok: true, runId, ...value }, null, 2));
    }
  );

  server.tool(
    "draft_list",
    "List drafts (filterable by kind/status).",
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
      return textResult(JSON.stringify({ ok: true, runId, ...value }, null, 2));
    }
  );

  server.tool(
    "draft_set_status",
    "Update draft status (e.g., approved/rejected/sent/published).",
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
        if (graph) {
          const d = db.getDraft(id);
          if (d) {
            await graph.upsertDraft({
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
      return textResult(JSON.stringify({ ok: true, runId, ...value }, null, 2));
    }
  );

  // -----------------------------
  // ARP (packets/actions) + execution v0
  // -----------------------------
  server.tool(
    "arp_ingest",
    "Ingest an ARP packet with proposed actions.",
    {
      arp_json: z.any(),
      actor: z.string().optional()
    },
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
          actor: actor || cfg.actorId,
          payloadJson: JSON.stringify(arp_json ?? null),
          createdAt: now
        });

        if (graph) {
          await graph.upsertRun({
            runId: packetId,
            source: String(arp_json?.run_id || ""),
            actor: actor || cfg.actorId,
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

          if (graph) {
            await graph.upsertAction({
              id: a.id,
              type: a.type,
              risk: a.risk,
              requiresApproval: a.requires_approval,
              status,
              payloadKind,
              payloadRef: a.payload_ref
            });
            await graph.linkRunToAction(packetId, a.id, "proposed");
            if (payloadKind === "draft" && a.payload_ref) {
              await graph.linkActionToDraft(a.id, a.payload_ref);
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

      return textResult(JSON.stringify({ runId, ...value }, null, 2));
    }
  );

  server.tool(
    "arp_get",
    "Fetch an ARP packet and its actions.",
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
      return textResult(JSON.stringify({ ok: true, runId, ...value }, null, 2));
    }
  );

  server.tool(
    "arp_action_set_status",
    "Update an ARP action status (e.g., approved/rejected/executed).",
    { action_id: z.string().min(1), status: z.string().min(1) },
    async ({ action_id, status }) => {
      const { runId, value } = await audit.withToolRun(
        "arp_action_set_status",
        "operator",
        { action_id, status },
        async () => {
          const now = new Date().toISOString();
          const ok = db.updateArpActionStatus(action_id, status, now);
          db.insertEvent({
            id: nanoid(),
            type: "arp_action_status_changed",
            entityId: action_id,
            payloadJson: JSON.stringify({ action_id, status }),
            createdAt: now
          });
          if (graph) {
            const action = db.getArpAction(action_id);
            if (action) {
              await graph.upsertAction({
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
        }
      );
      return textResult(JSON.stringify({ runId, ...value }, null, 2));
    }
  );

  server.tool(
    "arp_action_set_executor",
    "Attach/override an executor spec on an ARP action so execution v0 can route to a child MCP tool.",
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

      return textResult(JSON.stringify({ runId, ...value }, null, 2));
    }
  );

  server.tool(
    "arp_execute_plan",
    "Dry-run execution plan for approved actions in a packet. Shows which actions will run, which need wiring, and which are blocked by safety gates.",
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

      return textResult(JSON.stringify({ ok: true, runId, plan: value }, null, 2));
    }
  );

  server.tool(
    "arp_execute_approved",
    "Execute approved actions in a packet. Safe by default: high-risk gated, email send gated. Updates action status to executed only on success.",
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
            graph,
            childServers,
            maxPersistBytes: cfg.maxPersistBytes,
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

      return textResult(JSON.stringify({ ok: true, runId, result: value }, null, 2));
    }
  );

  server.tool(
    "arp_execution_history",
    "List recent execution attempts for a packet (debugging / audit).",
    {
      packet_id: z.string().min(1),
      limit: z.number().int().min(1).max(200).optional().default(50)
    },
    async ({ packet_id, limit }) => {
      const rows = db.listActionExecutionsForPacket(packet_id, limit);
      return textResult(JSON.stringify({ ok: true, packet_id, executions: rows }, null, 2));
    }
  );

  // -----------------------------
  // GRAPH QUERIES (Neo4j)
  // -----------------------------
  server.tool(
    "neo4j.cypher_run",
    "Run a Cypher query against the Operator Neo4j graph (read by default).",
    {
      cypher: z.string().min(1),
      params: z.record(z.any()).optional(),
      mode: z.enum(["read", "write"]).optional().default("read")
    },
    async ({ cypher, params, mode }) => {
      if (!graph) {
        return textResult(JSON.stringify({ ok: false, error: "neo4j_not_configured" }, null, 2));
      }
      const { runId, value } = await audit.withToolRun(
        "neo4j.cypher_run",
        "operator",
        { cypher, params, mode },
        async () => {
          const res = await graph.runCypher({ cypher, parameters: params || {}, mode });
          return res;
        }
      );
      return textResult(JSON.stringify({ ok: true, runId, ...value }, null, 2));
    }
  );

  // -----------------------------
  // AUDIT QUERIES
  // -----------------------------
  server.tool(
    "audit_recent_tool_runs",
    "List recent tool runs (for traceability and ops review).",
    { limit: z.number().int().min(1).max(200).default(50) },
    async ({ limit }) => {
      const rows = db.listRecentToolRuns(limit);
      return textResult(JSON.stringify({ ok: true, toolRuns: rows }, null, 2));
    }
  );

  server.tool(
    "audit_recent_events",
    "List recent events (append-only).",
    { limit: z.number().int().min(1).max(200).default(50) },
    async ({ limit }) => {
      const rows = db.listRecentEvents(limit);
      return textResult(JSON.stringify({ ok: true, events: rows }, null, 2));
    }
  );

  // -----------------------------
  // Start MCP server over STDIO
  // -----------------------------
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("Operator MCP server started (stdio).");

  // Graceful shutdown
  const shutdown = async () => {
    try {
      for (const c of childServers.values()) {
        try {
          await c.client.close();
        } catch {}
      }
      if (graph) await graph.close();
      db.close();
    } catch {}
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((e) => {
  logger.error({ err: e?.message || String(e), stack: e?.stack }, "Fatal error");
  process.exit(1);
});
