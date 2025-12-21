import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";

export const OpsDailyInputSchema = z.object({
  eng: z
    .object({
      project: z.string().optional().default(""),
      gcp_project_id: z.string().optional().default(""),
      region: z.string().optional().default("us-central1")
    })
    .default({}),
  glassbox: z
    .object({
      include_projects_summary: z.boolean().optional().default(true)
    })
    .default({}),
  confirm_write: z.boolean().optional().default(false),
  dry_run: z.boolean().optional().default(false)
});

function getEngAction(map: ActionMap | null, key: string): ActionSpec | null {
  return map?.engops?.[key] ?? null;
}

export async function opsGlassboxDaily(
  mgr: UpstreamManager,
  actionMap: ActionMap | null,
  allowWriteGlobal: boolean,
  input: z.infer<typeof OpsDailyInputSchema>
) {
  const out: any = { actions: {}, snapshot: {} };

  // Vercel
  const vercel = getEngAction(actionMap, "vercel_list_deployments");
  if (vercel) {
    out.actions.vercel_list_deployments = await runMappedAction({
      mgr,
      action: vercel,
      ctx: { eng: input.eng },
      allowWriteGlobal,
      confirmWrite: input.confirm_write,
      dryRun: input.dry_run
    });
  } else {
    out.actions.vercel_list_deployments = {
      skipped: true,
      reason: "No action map entry engops.vercel_list_deployments"
    };
  }

  // Cloud Run
  const cloudrun = getEngAction(actionMap, "gcloud_cloudrun_list_services");
  if (cloudrun) {
    out.actions.gcloud_cloudrun_list_services = await runMappedAction({
      mgr,
      action: cloudrun,
      ctx: { eng: input.eng },
      allowWriteGlobal,
      confirmWrite: input.confirm_write,
      dryRun: input.dry_run
    });
  } else {
    out.actions.gcloud_cloudrun_list_services = {
      skipped: true,
      reason: "No action map entry engops.gcloud_cloudrun_list_services"
    };
  }

  // GitHub (optional)
  const gh = getEngAction(actionMap, "github_recent_activity");
  if (gh) {
    out.actions.github_recent_activity = await runMappedAction({
      mgr,
      action: gh,
      ctx: { eng: input.eng },
      allowWriteGlobal,
      confirmWrite: input.confirm_write,
      dryRun: input.dry_run
    });
  }

  // Glassbox projects summary (via your glassbox MCP upstream)
  const gb = getEngAction(actionMap, "glassbox_projects_summary");
  if (input.glassbox.include_projects_summary && gb) {
    out.actions.glassbox_projects_summary = await runMappedAction({
      mgr,
      action: gb,
      ctx: {},
      allowWriteGlobal,
      confirmWrite: input.confirm_write,
      dryRun: input.dry_run
    });
  } else if (input.glassbox.include_projects_summary && !gb) {
    out.actions.glassbox_projects_summary = {
      skipped: true,
      reason: "No action map entry engops.glassbox_projects_summary"
    };
  }

  return out;
}
