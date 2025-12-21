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
import type { DraftCreateInput } from "./persistence/drafts.js";

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
        logger.info({ name, toolCount: tools.length }, "Connected child MCP server");
      } catch (e: any) {
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

  const ArpActionSchema = z
    .object({
      id: z.string().min(1),
      type: z.enum(["send_email", "update_crm", "publish_post", "deploy", "enrich_lead", "create_task", "other"]),
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
      const children = [...childServers.values()].map((c) => ({
        name: c.name,
        toolCount: c.tools.length
      }));
      return textResult(
        JSON.stringify(
          {
            ok: true,
            actorId: cfg.actorId,
            dbPath: cfg.dbPath,
            neo4jEnabled: Boolean(graph),
            childServers: children
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
      type: z.enum(["policy", "procedure", "messaging", "legal", "sales", "marketing", "product", "engineering", "other"]),
      title: z.string().min(1),
      body: z.string().min(1),
      source: z.string().optional(),
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

  // -----------------------------
  // DRAFTS (marketing/sales ops outputs you approve)
  // -----------------------------
  server.tool(
    "draft_create",
    "Create a draft artifact (LinkedIn post / email / blog post / etc).",
    {
      kind: z.enum(["linkedin_post", "email", "blog_post", "proposal", "meeting_notes", "other"]),
      title: z.string().optional(),
      body: z.string().min(1),
      meta: z.record(z.any()).optional()
    },
    async (input: DraftCreateInput & { meta?: Record<string, any> }) => {
      const { runId, value } = await audit.withToolRun("draft_create", "operator", input, async (runId) => {
        const id = nanoid();
        const now = new Date().toISOString();
        db.createDraft({
          id,
          kind: input.kind,
          title: input.title || null,
          body: input.body,
          status: "draft",
          meta_json: input.meta ? JSON.stringify(input.meta) : null,
          created_at: now,
          updated_at: now
        });

        db.insertEvent({
          id: nanoid(),
          type: "draft_created",
          entityId: id,
          payloadJson: JSON.stringify({ id, kind: input.kind, title: input.title || null }),
          createdAt: now
        });

        if (graph) {
          await graph.upsertDraft({ id, kind: input.kind, title: input.title || null, status: "draft", createdAt: now, updatedAt: now });
          await graph.linkToolRunToDraft(runId, id);
        }

        audit.recordDraftCreated(runId, id);
        return { id, status: "draft", createdAt: now };
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
      kind: z.enum(["linkedin_post", "email", "blog_post", "proposal", "meeting_notes", "other"]).optional(),
      status: z.string().optional()
    },
    async ({ limit, offset, kind, status }) => {
      const { runId, value } = await audit.withToolRun("draft_list", "operator", { limit, offset, kind, status }, async () => {
        const rows = db.listDrafts(limit, offset, kind, status);
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

        for (const a of parsedActions) {
          const details = a.executor ? { executor: a.executor } : (a as any).details;
          const payloadKind = (a as any).payload_kind ? String((a as any).payload_kind) : null;
          const status = (a as any).status ? String((a as any).status) : a.requires_approval ? "pending" : "approved";

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
