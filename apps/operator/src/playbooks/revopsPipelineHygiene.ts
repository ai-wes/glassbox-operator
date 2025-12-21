import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";
import { daysAgo, resultToJsonOrText, safeIsoDate } from "./utils.js";

export const RevOpsPipelineHygieneInputSchema = z.object({
  crm: z
    .object({
      base_id: z.string().optional().default(""),
      opportunities_table: z.string().optional().default("Opportunities"),
      tasks_table: z.string().optional().default("Tasks"),

      // Field names inside Airtable records (your schema)
      stage_field: z.string().optional().default("Stage"),
      last_touch_field: z.string().optional().default("Last Touch"),
      next_touch_field: z.string().optional().default("Next Touch"),
      account_field: z.string().optional().default("Account"),
      primary_contact_field: z.string().optional().default("Primary Contact"),

      stale_days: z.number().int().min(1).max(60).optional().default(7)
    })
    .default({}),

  confirm_write: z.boolean().optional().default(false),
  dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
  return map?.revops?.[key] ?? null;
}

function normalizeRecords(payload: any): any[] {
  // Supports common Airtable shapes:
  // {records:[{id, fields:{...}}]} or direct array
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

export async function revopsPipelineHygiene(
  mgr: UpstreamManager,
  actionMap: ActionMap | null,
  allowWriteGlobal: boolean,
  input: z.infer<typeof RevOpsPipelineHygieneInputSchema>
) {
  const listOpps = getAction(actionMap, "airtable_list_opportunities");
  const createTask = getAction(actionMap, "airtable_create_task_for_opp");

  const out: any = { stale_days: input.crm.stale_days, opportunities: [], stale: [], actions: {} };

  if (!listOpps) {
    out.error = "Missing action map: revops.airtable_list_opportunities";
    return out;
  }

  const listRes = await runMappedAction({
    mgr,
    action: listOpps,
    ctx: { crm: input.crm },
    allowWriteGlobal,
    confirmWrite: input.confirm_write,
    dryRun: input.dry_run
  });

  out.actions.airtable_list_opportunities = listRes;

  const parsed = resultToJsonOrText((listRes as any).result);
  const json = parsed.json ?? parsed.raw ?? {};
  const records = normalizeRecords(json);

  const stale: any[] = [];

  for (const r of records) {
    const id = r.id ?? r.recordId ?? r._id ?? null;
    const f = r.fields ?? r;

    const stage = f[input.crm.stage_field] ?? f.stage ?? null;
    const lastTouchIso = safeIsoDate(f[input.crm.last_touch_field] ?? f.last_touch_at ?? f.lastTouchAt ?? null);
    const nextTouchIso = safeIsoDate(f[input.crm.next_touch_field] ?? f.next_touch_at ?? f.nextTouchAt ?? null);

    const lastDays = daysAgo(lastTouchIso);
    const nextDays = daysAgo(nextTouchIso);

    const isStale =
      (lastDays != null && lastDays >= input.crm.stale_days) ||
      (!nextTouchIso && (lastDays == null || lastDays >= 1)) ||
      (nextTouchIso && nextDays != null && nextDays >= 0); // overdue next touch

    const opp = {
      id,
      stage,
      last_touch_iso: lastTouchIso,
      next_touch_iso: nextTouchIso,
      account: f[input.crm.account_field] ?? null,
      primary_contact: f[input.crm.primary_contact_field] ?? null,
      fields: f
    };

    out.opportunities.push(opp);
    if (isStale) stale.push(opp);
  }

  out.stale = stale;

  // Optional: create tasks
  out.actions.created_tasks = [];
  if (createTask) {
    for (const s of stale) {
      const ctx = {
        crm: input.crm,
        opp: s,
        task: {
          title: `Follow up (${s.stage || "Pipeline"}): ${s.account || "Account"}`,
          due_iso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          opp_id: s.id
        }
      };

      out.actions.created_tasks.push(
        await runMappedAction({
          mgr,
          action: createTask,
          ctx,
          allowWriteGlobal,
          confirmWrite: input.confirm_write,
          dryRun: input.dry_run
        })
      );
    }
  }

  return out;
}
