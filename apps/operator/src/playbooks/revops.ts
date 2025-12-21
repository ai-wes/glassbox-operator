import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";

export const LeadSchema = z.object({
  full_name: z.string().min(1),
  email: z.string().email().optional().default(""),
  company: z.string().optional().default(""),
  linkedin_url: z.string().optional().default(""),
  stage: z.string().optional().default("New")
});

export const RevOpsPlaybookInputSchema = z.object({
  lead: LeadSchema,
  crm: z
    .object({
      base_id: z.string().optional().default(""),
      contacts_table: z.string().optional().default("Contacts")
    })
    .default({}),
  context: z
    .object({
      offer: z.string().optional().default(""),
      notes: z.string().optional().default("")
    })
    .default({}),
  confirm_write: z.boolean().optional().default(false),
  dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
  return map?.revops?.[key] ?? null;
}

function mkEmailDraft(lead: any, ctx: any) {
  const subject = `Quick question re: ${lead.company || "your pipeline"}`;
  const body = `Hi ${lead.full_name.split(" ")[0] || lead.full_name},

${ctx.offer ? `I’m reaching out because ${ctx.offer}.\n\n` : ""}I saw you're at ${lead.company || "[company]"} and thought this might be relevant.

If helpful, I can share:

- how we typically run fast diligence
- what a lightweight pilot looks like
- pricing + timeline options

Want me to send a 3-bullet overview?

Best,
[Your Name]`;
  return { subject, body };
}

function mkLinkedInDraft(lead: any, ctx: any) {
  const first = lead.full_name.split(" ")[0] || lead.full_name;
  const note = `Hi ${first} — quick connect. ${ctx.offer ? ctx.offer.slice(0, 160) : "I work on GTM + ops automation."}`;
  const msg = `Hey ${first} — thanks for connecting.

${ctx.offer ? `Context: ${ctx.offer}\n\n` : ""}If you’re open, I’d love to ask 2 quick questions about how you currently handle:

1. lead enrichment + routing
2. follow-ups + pipeline hygiene

If it’s easier, I can send a 3-bullet summary first.`;
  const followup = `Quick bump, ${first}. Happy to keep it lightweight — if you tell me your #1 bottleneck in your pipeline this month, I’ll send a concrete 3-step fix.`;
  return { connection_note: note, message: msg, followup };
}

export async function revopsLeadCapture(
  mgr: UpstreamManager,
  actionMap: ActionMap | null,
  allowWriteGlobal: boolean,
  input: z.infer<typeof RevOpsPlaybookInputSchema>
) {
  const lead = LeadSchema.parse(input.lead);

  const ctx = {
    lead,
    crm: input.crm,
    context: input.context
  };

  const outputs: any = {
    lead,
    drafts: {
      email: mkEmailDraft(lead, input.context),
      linkedin: mkLinkedInDraft(lead, input.context)
    },
    actions: {}
  };

  const clay = getAction(actionMap, "clay_enrich_lead");
  if (clay) {
    outputs.actions.clay_enrich_lead = await runMappedAction({
      mgr,
      action: clay,
      ctx,
      allowWriteGlobal,
      confirmWrite: input.confirm_write,
      dryRun: input.dry_run
    });
  } else {
    outputs.actions.clay_enrich_lead = {
      skipped: true,
      reason: "No action map entry revops.clay_enrich_lead"
    };
  }

  const airtable = getAction(actionMap, "airtable_upsert_contact");
  if (airtable) {
    outputs.actions.airtable_upsert_contact = await runMappedAction({
      mgr,
      action: airtable,
      ctx,
      allowWriteGlobal,
      confirmWrite: input.confirm_write,
      dryRun: input.dry_run
    });
  } else {
    outputs.actions.airtable_upsert_contact = {
      skipped: true,
      reason: "No action map entry revops.airtable_upsert_contact"
    };
  }

  const gmail = getAction(actionMap, "gmail_create_draft");
  if (gmail) {
    const emailCtx = { ...ctx, email: outputs.drafts.email };
    outputs.actions.gmail_create_draft = await runMappedAction({
      mgr,
      action: gmail,
      ctx: emailCtx,
      allowWriteGlobal,
      confirmWrite: input.confirm_write,
      dryRun: input.dry_run
    });
  } else {
    outputs.actions.gmail_create_draft = {
      skipped: true,
      reason: "No action map entry revops.gmail_create_draft"
    };
  }

  return outputs;
}
