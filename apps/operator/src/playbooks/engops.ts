import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";

export const EngOpsStatusInputSchema = z.object({
  eng: z
    .object({
      project: z.string().optional().default(""),
      gcp_project_id: z.string().optional().default(""),
      region: z.string().optional().default("us-central1")
    })
    .default({}),
  confirm_write: z.boolean().optional().default(false),
  dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
  return map?.engops?.[key] ?? null;
}

export async function engopsStatus(
  mgr: UpstreamManager,
  actionMap: ActionMap | null,
  allowWriteGlobal: boolean,
  input: z.infer<typeof EngOpsStatusInputSchema>
) {
  const ctx = { eng: input.eng };
  const out: any = { actions: {} };

  const vercel = getAction(actionMap, "vercel_list_deployments");
  if (vercel) {
    out.actions.vercel_list_deployments = await runMappedAction({
      mgr,
      action: vercel,
      ctx,
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

  const cloudrun = getAction(actionMap, "gcloud_cloudrun_list_services");
  if (cloudrun) {
    out.actions.gcloud_cloudrun_list_services = await runMappedAction({
      mgr,
      action: cloudrun,
      ctx,
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

  return out;
}
