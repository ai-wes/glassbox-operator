import { renderTemplate } from "../templating.js";
import type { ActionSpec } from "../upstreams/types.js";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";

export function isProbablyMutatingTool(toolName: string): boolean {
  const t = toolName.toLowerCase();

  // Strong signals of mutation
  const keywords = [
    "create",
    "update",
    "upsert",
    "delete",
    "remove",
    "set",
    "write",
    "send",
    "post",
    "patch",
    "put",
    "deploy",
    "rollback",
    "restart",
    "cancel",
    "publish",
    "trigger",
    "approve",
    "invite",
    "grant",
    "revoke"
  ];

  return keywords.some((k) => t.includes(k));
}

/**
 * Runs an ActionSpec against its upstream with:
 * - templated args
 * - write gating for mutating tools (global + confirm + upstream.allowWrite)
 */
export async function runMappedAction(opts: {
  mgr: UpstreamManager;
  action: ActionSpec;
  ctx: any;
  allowWriteGlobal: boolean;
  confirmWrite: boolean;
  dryRun: boolean;
}) {
  const { mgr, action, ctx, allowWriteGlobal, confirmWrite, dryRun } = opts;
  const upstream = mgr.get(action.upstream_id);
  const args = renderTemplate(action.args_template, ctx);

  const inferredMutating = isProbablyMutatingTool(action.tool);
  const isMutating = action.mutating === true || inferredMutating;

  if (dryRun) {
    return {
      dry_run: true,
      upstream_id: action.upstream_id,
      tool: action.tool,
      mutating: isMutating,
      args
    };
  }

  // Read-only calls always allowed.
  if (!isMutating) {
    const result = await upstream.callTool(action.tool, args);
    return { ok: true, upstream_id: action.upstream_id, tool: action.tool, mutating: false, result };
  }

  // Mutating calls require:
  // - global allow write
  // - confirmWrite true
  // - upstream allowWrite true
  if (!allowWriteGlobal) {
    return {
      blocked: true,
      reason: "OPERATOR_ALLOW_WRITE=0",
      upstream_id: action.upstream_id,
      tool: action.tool,
      args
    };
  }
  if (!confirmWrite) {
    return {
      blocked: true,
      reason: "confirm_write=false",
      upstream_id: action.upstream_id,
      tool: action.tool,
      args
    };
  }
  if (!upstream.allowWrite) {
    return {
      blocked: true,
      reason: "upstream.allowWrite=false",
      upstream_id: action.upstream_id,
      tool: action.tool,
      args
    };
  }

  const result = await upstream.callTool(action.tool, args);
  return { ok: true, upstream_id: action.upstream_id, tool: action.tool, mutating: true, result };
}
