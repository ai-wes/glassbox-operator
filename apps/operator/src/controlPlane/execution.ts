import { nanoid } from "nanoid";

import type { OperatorDb, DraftRow } from "./persistence/db.js";
import { normalizeDraftKind } from "./persistence/drafts.js";
import type { Neo4jGraph } from "./graph/neo4j.js";

export type ChildToolDef = { name: string; description?: string; inputSchema?: any };

export type ChildServerHandle = {
  name: string;
  tools: ChildToolDef[];
  callTool: (toolName: string, args: Record<string, any>) => Promise<any>;
};

export type AuditRunner = <T>(
  toolName: string,
  serverName: string,
  args: any,
  fn: (runId: string) => Promise<T>
) => Promise<{ runId: string; value: T }>;

export type ExecutionMode = "dry_run" | "execute";

export type ExecutorSpec = {
  server: string;
  tool: string;
  arguments?: Record<string, any>;
  pass_draft?: boolean; // if true, pass draft payload into arguments.draft
  operation?: "draft" | "send" | "update" | "create" | "other";
};

export type ExecutionSpec =
  | {
      kind: "child_tool";
      server: string;
      tool: string;
      arguments: Record<string, any>;
      safety: { operation: string; wouldSendEmail: boolean };
    }
  | {
      kind: "manual";
      instruction: string;
      draftStatusUpdates?: Array<{ draftId: string; status: string }>;
    }
  | { kind: "unsupported"; reason: string };

export type PlannedAction = {
  action_id: string;
  packet_id: string;
  type: string;
  risk: string;
  requires_approval: boolean;
  status: string;
  payload_kind: string | null;
  payload_ref: string | null;
  draft?: {
    id: string;
    kind: string;
    title: string | null;
    status: string;
    meta: any | null;
  };
  spec: ExecutionSpec;
};

export type ExecutionPlan = {
  packet_id: string;
  mode: ExecutionMode;
  generated_at: string;
  actions: PlannedAction[];
  summary: {
    eligible: number;
    executable_now: number;
    needs_wiring: number;
    high_risk: number;
  };
};

export type ExecuteOptions = {
  mode: ExecutionMode;
  includeHighRisk: boolean;
  allowEmailSend: boolean;
  maxActions: number;
  onlyActionIds?: string[];
};

export type ActionExecutionOutcome = {
  action_id: string;
  outcome: "executed" | "skipped" | "failed";
  reason?: string;
  tool_run_id?: string;
  child_server?: string;
  child_tool?: string;
  result?: any;
  error?: string;
};

export type ExecuteResult = {
  packet_id: string;
  mode: ExecutionMode;
  started_at: string;
  finished_at: string;
  outcomes: ActionExecutionOutcome[];
  summary: { executed: number; skipped: number; failed: number };
};

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(s: string | null): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function safeJsonStringify(value: any, maxBytes: number): string {
  const s = JSON.stringify(value ?? null);
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  const buf = Buffer.from(s, "utf8");
  return buf.subarray(0, maxBytes).toString("utf8");
}

function toolExists(childServers: Map<string, ChildServerHandle>, server: string, tool: string): boolean {
  const child = childServers.get(server);
  if (!child) return false;
  return child.tools.some((t) => t.name === tool);
}

function resolveExecutorFromDetails(details: any): ExecutorSpec | null {
  if (!details || typeof details !== "object") return null;
  const ex = (details as any).executor;
  if (!ex || typeof ex !== "object") return null;

  const server = String(ex.server || "").trim();
  const tool = String(ex.tool || "").trim();
  if (!server || !tool) return null;

  const args = ex.arguments && typeof ex.arguments === "object" ? (ex.arguments as Record<string, any>) : undefined;
  const passDraft = Boolean(ex.pass_draft);
  const operation = ex.operation ? String(ex.operation) : "other";

  return {
    server,
    tool,
    arguments: args,
    pass_draft: passDraft,
    operation: operation as any
  };
}

function isEmailSendAction(actionType: string): boolean {
  const t = (actionType || "").toLowerCase();
  return t === "send_email" || t === "email_send";
}

function isPublishPostAction(actionType: string): boolean {
  const t = (actionType || "").toLowerCase();
  return t === "publish_post" || t === "blog_post_publish" || t === "linkedin_post_ready_to_publish";
}

function isDraftCreateAction(actionType: string): boolean {
  const t = (actionType || "").toLowerCase();
  return (
    t === "email_draft_create" ||
    t === "email_followup_draft" ||
    t === "linkedin_post_draft_create" ||
    t === "linkedin_comment_draft_create" ||
    t === "blog_post_draft_create"
  );
}

function buildManualSpecForKnownTypes(actionType: string, draft?: DraftRow | null): ExecutionSpec | null {
  const lowerType = (actionType || "").toLowerCase();
  const draftKind = draft ? normalizeDraftKind(draft.kind as any) : null;

  if (isPublishPostAction(lowerType)) {
    if (draft && draftKind === "linkedin_post_draft") {
      return {
        kind: "manual",
        instruction:
          "LinkedIn has no API automation in this stack. Draft marked approved. Copy/paste into LinkedIn and publish.",
        draftStatusUpdates: [{ draftId: draft.id, status: "approved" }]
      };
    }
    if (draft && draftKind === "blog_post_draft") {
      return {
        kind: "manual",
        instruction:
          "Blog publishing not wired yet. Draft marked approved. Wire an executor to Glassbox MCP when ready.",
        draftStatusUpdates: [{ draftId: draft.id, status: "approved" }]
      };
    }
    return {
      kind: "unsupported",
      reason: "publish_post requires a draft payload_ref and a known draft kind (linkedin_post_draft/blog_post_draft)."
    };
  }

  if (isEmailSendAction(lowerType)) {
    if (draft && draftKind === "email_draft") {
      return {
        kind: "manual",
        instruction:
          "Email send is disabled by default in execution v0. Draft marked approved. You can wire a Gmail executor to create a Gmail draft (safe) or explicitly allow sending.",
        draftStatusUpdates: [{ draftId: draft.id, status: "approved" }]
      };
    }
    return { kind: "unsupported", reason: "email_send requires an email draft payload_ref." };
  }

  if (isDraftCreateAction(lowerType)) {
    if (draft) {
      return {
        kind: "manual",
        instruction: "Draft already created. Marked ready_for_review.",
        draftStatusUpdates: [{ draftId: draft.id, status: "ready_for_review" }]
      };
    }
    return { kind: "unsupported", reason: "draft_create action requires a draft payload_ref." };
  }

  // everything else needs an executor to a child tool
  return null;
}

export async function buildExecutionPlan(params: {
  packetId: string;
  db: OperatorDb;
  childServers: Map<string, ChildServerHandle>;
  includeHighRisk: boolean;
  maxActions: number;
  onlyActionIds?: string[];
}): Promise<ExecutionPlan> {
  const packetId = params.packetId;

  // ensure packet exists
  const packetRow = params.db.getArpPacket(packetId);
  if (!packetRow) {
    throw new Error(`ARP packet not found: ${packetId}`);
  }

  const allActions = params.db.listArpActions(packetId);
  const approved = allActions.filter((a) => a.status === "approved");

  const filtered = params.onlyActionIds?.length
    ? approved.filter((a) => params.onlyActionIds!.includes(a.id))
    : approved;

  const actions = filtered.slice(0, params.maxActions);

  const planned: PlannedAction[] = [];

  for (const a of actions) {
    const details = safeJsonParse(a.details_json);

    let draft: DraftRow | null = null;
    let draftMeta: any | null = null;
    if (a.payload_kind === "draft" && a.payload_ref) {
      draft = params.db.getDraft(a.payload_ref);
      if (draft) {
        draftMeta = safeJsonParse(draft.meta_json);
      }
    }

    // 1) executor spec wins
    const ex = resolveExecutorFromDetails(details);
    if (ex) {
      const exists = toolExists(params.childServers, ex.server, ex.tool);
      if (!exists) {
        planned.push({
          action_id: a.id,
          packet_id: a.packet_id,
          type: a.action_type,
          risk: a.risk,
          requires_approval: Boolean(a.requires_approval),
          status: a.status,
          payload_kind: a.payload_kind,
          payload_ref: a.payload_ref,
          draft: draft
            ? { id: draft.id, kind: draft.kind, title: draft.title, status: draft.status, meta: draftMeta }
            : undefined,
          spec: {
            kind: "unsupported",
            reason: `Executor specified server=\"${ex.server}\" tool=\"${ex.tool}\", but tool not found on that child server. Use child_tools_list to confirm tool name.`
          }
        });
        continue;
      }

      const args: Record<string, any> = { ...(ex.arguments || {}) };
      if (ex.pass_draft && draft) {
        args.draft = {
          id: draft.id,
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          meta: draftMeta
        };
      }

      planned.push({
        action_id: a.id,
        packet_id: a.packet_id,
        type: a.action_type,
        risk: a.risk,
        requires_approval: Boolean(a.requires_approval),
        status: a.status,
        payload_kind: a.payload_kind,
        payload_ref: a.payload_ref,
        draft: draft ? { id: draft.id, kind: draft.kind, title: draft.title, status: draft.status, meta: draftMeta } : undefined,
          spec: {
            kind: "child_tool",
            server: ex.server,
            tool: ex.tool,
            arguments: args,
            safety: {
              operation: ex.operation || "other",
            wouldSendEmail: (ex.operation || "").toLowerCase() === "send" && isEmailSendAction(a.action_type)
            }
          }
        });
      continue;
    }

    // 2) manual known types
    const manual = buildManualSpecForKnownTypes(a.action_type, draft);
    if (manual) {
      planned.push({
        action_id: a.id,
        packet_id: a.packet_id,
        type: a.action_type,
        risk: a.risk,
        requires_approval: Boolean(a.requires_approval),
        status: a.status,
        payload_kind: a.payload_kind,
        payload_ref: a.payload_ref,
        draft: draft ? { id: draft.id, kind: draft.kind, title: draft.title, status: draft.status, meta: draftMeta } : undefined,
        spec: manual
      });
      continue;
    }

    // 3) unsupported
    planned.push({
      action_id: a.id,
      packet_id: a.packet_id,
      type: a.action_type,
      risk: a.risk,
      requires_approval: Boolean(a.requires_approval),
      status: a.status,
      payload_kind: a.payload_kind,
      payload_ref: a.payload_ref,
      draft: draft ? { id: draft.id, kind: draft.kind, title: draft.title, status: draft.status, meta: draftMeta } : undefined,
      spec: {
        kind: "unsupported",
        reason:
          "No executor specified. Use arp_action_set_executor to wire this action to a child MCP tool (e.g., airtable update, clay enrich, vercel deploy)."
      }
    });
  }

  const eligible = planned.length;
  const needsWiring = planned.filter((p) => p.spec.kind === "unsupported").length;
  const highRisk = planned.filter((p) => (p.risk || "").toLowerCase() === "high").length;

  const executableNow = planned.filter((p) => {
    if (p.spec.kind === "unsupported") return false;
    if ((p.risk || "").toLowerCase() === "high" && !params.includeHighRisk) return false;
    return true;
  }).length;

  return {
    packet_id: packetId,
    mode: "dry_run",
    generated_at: nowIso(),
    actions: planned,
    summary: {
      eligible,
      executable_now: executableNow,
      needs_wiring: needsWiring,
      high_risk: highRisk
    }
  };
}

export async function executeApprovedActions(params: {
  packetId: string;
  db: OperatorDb;
  audit: AuditRunner;
  graph?: Neo4jGraph;
  childServers: Map<string, ChildServerHandle>;
  maxPersistBytes: number;
  opts: ExecuteOptions;
}): Promise<ExecuteResult> {
  const startedAt = nowIso();

  const plan = await buildExecutionPlan({
    packetId: params.packetId,
    db: params.db,
    childServers: params.childServers,
    includeHighRisk: params.opts.includeHighRisk,
    maxActions: params.opts.maxActions,
    onlyActionIds: params.opts.onlyActionIds
  });

  // Return plan only
  if (params.opts.mode === "dry_run") {
    return {
      packet_id: params.packetId,
      mode: "dry_run",
      started_at: startedAt,
      finished_at: nowIso(),
      outcomes: plan.actions.map((a) => ({
        action_id: a.action_id,
        outcome: "skipped",
        reason: a.spec.kind === "unsupported" ? a.spec.reason : "dry_run"
      })),
      summary: { executed: 0, skipped: plan.actions.length, failed: 0 }
    };
  }

  const outcomes: ActionExecutionOutcome[] = [];

  for (const a of plan.actions) {
    // High-risk gate
    if ((a.risk || "").toLowerCase() === "high" && !params.opts.includeHighRisk) {
      outcomes.push({ action_id: a.action_id, outcome: "skipped", reason: "high_risk_requires_include_high_risk" });
      continue;
    }

    const spec = a.spec;

    // Unsupported
    if (spec.kind === "unsupported") {
      outcomes.push({ action_id: a.action_id, outcome: "skipped", reason: spec.reason });
      continue;
    }

    // start execution log row
    const execId = nanoid();
    const execStart = nowIso();
    params.db.startActionExecution({
      id: execId,
      actionId: a.action_id,
      packetId: a.packet_id,
      mode: "execute",
      startedAt: execStart,
      resultJson: safeJsonStringify({ planned: a }, params.maxPersistBytes)
    });

    try {
      // Manual execution = local state updates only
      if (spec.kind === "manual") {
        if (spec.draftStatusUpdates?.length) {
          for (const upd of spec.draftStatusUpdates) {
            params.db.updateDraftStatus(upd.draftId, upd.status, nowIso());
          }
        }

        // mark action executed
        params.db.updateArpActionStatus(a.action_id, "executed", nowIso());
        params.db.insertEvent({
          id: nanoid(),
          type: "arp_action_executed",
          entityId: a.action_id,
          payloadJson: safeJsonStringify({ action_id: a.action_id, mode: "manual", instruction: spec.instruction }, params.maxPersistBytes),
          createdAt: nowIso()
        });

        if (params.graph) {
          await params.graph.upsertAction({
            id: a.action_id,
            type: a.type,
            risk: a.risk,
            requiresApproval: a.requires_approval,
            status: "executed",
            payloadKind: a.payload_kind,
            payloadRef: a.payload_ref
          });
        }

        params.db.finishActionExecution({
          id: execId,
          finishedAt: nowIso(),
          success: true,
          resultJson: safeJsonStringify({ ok: true, instruction: spec.instruction }, params.maxPersistBytes),
          errorJson: null
        });

        outcomes.push({ action_id: a.action_id, outcome: "executed", result: { instruction: spec.instruction } });
        continue;
      }

      // Child tool execution
      if (spec.kind === "child_tool") {
        // Email send gate (only if executor declares operation=send)
        if (spec.safety.wouldSendEmail && !params.opts.allowEmailSend) {
          params.db.finishActionExecution({
            id: execId,
            finishedAt: nowIso(),
            success: false,
            resultJson: null,
            errorJson: safeJsonStringify({ error: "email_send_blocked_allow_email_send_required" }, params.maxPersistBytes)
          });
          outcomes.push({
            action_id: a.action_id,
            outcome: "skipped",
            reason: "email_send_blocked_allow_email_send_required"
          });
          continue;
        }

        const child = params.childServers.get(spec.server);
        if (!child) {
          throw new Error(`Child server not connected: ${spec.server}`);
        }

        const { runId: childToolRunId, value: toolResult } = await params.audit(
          spec.tool,
          spec.server,
          { arguments: spec.arguments },
          async () => {
            return await child.callTool(spec.tool, spec.arguments);
          }
        );

        // Mark executed
        params.db.updateArpActionStatus(a.action_id, "executed", nowIso());
        params.db.insertEvent({
          id: nanoid(),
          type: "arp_action_executed",
          entityId: a.action_id,
          payloadJson: safeJsonStringify(
            { action_id: a.action_id, server: spec.server, tool: spec.tool, tool_run_id: childToolRunId },
            params.maxPersistBytes
          ),
          createdAt: nowIso()
        });

        if (params.graph) {
          await params.graph.upsertAction({
            id: a.action_id,
            type: a.type,
            risk: a.risk,
            requiresApproval: a.requires_approval,
            status: "executed",
            payloadKind: a.payload_kind,
            payloadRef: a.payload_ref
          });
          await params.graph.linkActionToToolRun(a.action_id, childToolRunId);
        }

        params.db.finishActionExecution({
          id: execId,
          finishedAt: nowIso(),
          success: true,
          resultJson: safeJsonStringify({ tool_result: toolResult, tool_run_id: childToolRunId }, params.maxPersistBytes),
          errorJson: null
        });

        outcomes.push({
          action_id: a.action_id,
          outcome: "executed",
          tool_run_id: childToolRunId,
          child_server: spec.server,
          child_tool: spec.tool,
          result: toolResult
        });
        continue;
      }

      // Should never hit
      outcomes.push({ action_id: a.action_id, outcome: "skipped", reason: "unknown_spec" });
      params.db.finishActionExecution({
        id: execId,
        finishedAt: nowIso(),
        success: false,
        resultJson: null,
        errorJson: safeJsonStringify({ error: "unknown_spec" }, params.maxPersistBytes)
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      params.db.updateArpActionStatus(a.action_id, "failed", nowIso());

      if (params.graph) {
        await params.graph.upsertAction({
          id: a.action_id,
          type: a.type,
          risk: a.risk,
          requiresApproval: a.requires_approval,
          status: "failed",
          payloadKind: a.payload_kind,
          payloadRef: a.payload_ref
        });
      }

      params.db.insertEvent({
        id: nanoid(),
        type: "arp_action_failed",
        entityId: a.action_id,
        payloadJson: safeJsonStringify({ action_id: a.action_id, error: msg }, params.maxPersistBytes),
        createdAt: nowIso()
      });

      params.db.finishActionExecution({
        id: execId,
        finishedAt: nowIso(),
        success: false,
        resultJson: null,
        errorJson: safeJsonStringify({ error: msg, stack: err?.stack }, params.maxPersistBytes)
      });

      outcomes.push({ action_id: a.action_id, outcome: "failed", error: msg });
    }
  }

  const finishedAt = nowIso();
  const executed = outcomes.filter((o) => o.outcome === "executed").length;
  const skipped = outcomes.filter((o) => o.outcome === "skipped").length;
  const failed = outcomes.filter((o) => o.outcome === "failed").length;

  return {
    packet_id: params.packetId,
    mode: "execute",
    started_at: startedAt,
    finished_at: finishedAt,
    outcomes,
    summary: { executed, skipped, failed }
  };
}
