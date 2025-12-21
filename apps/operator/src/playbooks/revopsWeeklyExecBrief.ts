import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";
import { resultToJsonOrText } from "./utils.js";

export const RevOpsWeeklyExecBriefInputSchema = z.object({
  period_days: z.number().int().min(1).max(31).optional().default(7),
  recipients: z.array(z.string().email()).optional().default([]),
  sender_name: z.string().optional().default("Operator"),
  subject: z.string().optional().default("Weekly Revenue Brief"),
  crm: z
    .object({
      base_id: z.string().optional().default("")
    })
    .default({}),
  confirm_write: z.boolean().optional().default(false),
  dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
  return map?.revops?.[key] ?? null;
}

function formatBrief(metrics: any, periodDays: number) {
  const m = metrics || {};
  // You can adapt these keys to whatever your Airtable metrics action returns.
  const leads = m.leads_created ?? m.new_leads ?? m.leads ?? null;
  const contacted = m.contacted ?? null;
  const replies = m.replies ?? null;
  const meetings = m.meetings ?? null;
  const pipeline = m.pipeline_value ?? m.pipeline ?? null;
  const won = m.closed_won ?? null;
  const lost = m.closed_lost ?? null;

  const lines: string[] = [];
  lines.push(`Weekly Revenue Brief (${periodDays}d)`);
  lines.push("");
  lines.push("Topline");
  if (leads != null) lines.push(`- New leads: ${leads}`);
  if (contacted != null) lines.push(`- Contacted: ${contacted}`);
  if (replies != null) lines.push(`- Replies: ${replies}`);
  if (meetings != null) lines.push(`- Meetings booked: ${meetings}`);
  if (pipeline != null) lines.push(`- Pipeline: ${pipeline}`);
  if (won != null) lines.push(`- Closed won: ${won}`);
  if (lost != null) lines.push(`- Closed lost: ${lost}`);

  if (Array.isArray(m.highlights) && m.highlights.length) {
    lines.push("");
    lines.push("Highlights");
    for (const h of m.highlights.slice(0, 10)) lines.push(`- ${String(h)}`);
  }

  if (Array.isArray(m.risks) && m.risks.length) {
    lines.push("");
    lines.push("Risks / Blockers");
    for (const r of m.risks.slice(0, 10)) lines.push(`- ${String(r)}`);
  }

  if (Array.isArray(m.next_week) && m.next_week.length) {
    lines.push("");
    lines.push("Next Week Focus");
    for (const n of m.next_week.slice(0, 10)) lines.push(`- ${String(n)}`);
  }

  return lines.join("\n");
}

export async function revopsWeeklyExecBrief(
  mgr: UpstreamManager,
  actionMap: ActionMap | null,
  allowWriteGlobal: boolean,
  input: z.infer<typeof RevOpsWeeklyExecBriefInputSchema>
) {
  const metricsAction = getAction(actionMap, "airtable_weekly_metrics");
  const sendAction = getAction(actionMap, "gmail_send_exec_brief");

  const out: any = {
    period_days: input.period_days,
    recipients: input.recipients,
    metrics: null,
    brief_text: "",
    actions: {}
  };

  if (!metricsAction) {
    out.error = "Missing action map: revops.airtable_weekly_metrics";
    return out;
  }

  // 1) Fetch metrics (you define the view/query in Airtable via this action map)
  const metricsRes = await runMappedAction({
    mgr,
    action: metricsAction,
    ctx: { crm: input.crm, period_days: input.period_days },
    allowWriteGlobal,
    confirmWrite: input.confirm_write,
    dryRun: input.dry_run
  });

  out.actions.airtable_weekly_metrics = metricsRes;
  const parsed = resultToJsonOrText((metricsRes as any).result);
  out.metrics = parsed.json ?? parsed.raw ?? parsed.text;

  // 2) Compose the brief
  out.brief_text = formatBrief(out.metrics, input.period_days);

  // 3) Optionally send
  if (input.recipients.length && sendAction) {
    const ctx = {
      email: {
        to: input.recipients.join(","),
        subject: input.subject,
        body: out.brief_text,
        sender_name: input.sender_name
      }
    };

    out.actions.gmail_send_exec_brief = await runMappedAction({
      mgr,
      action: sendAction,
      ctx,
      allowWriteGlobal,
      confirmWrite: input.confirm_write,
      dryRun: input.dry_run
    });
  } else if (input.recipients.length && !sendAction) {
    out.actions.gmail_send_exec_brief = {
      skipped: true,
      reason: "No action map entry revops.gmail_send_exec_brief"
    };
  }

  return out;
}
