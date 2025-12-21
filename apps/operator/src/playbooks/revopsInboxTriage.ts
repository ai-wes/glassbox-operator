import { z } from "zod";
import type { ActionMap, ActionSpec } from "../upstreams/types.js";
import type { UpstreamManager } from "../upstreams/upstreamManager.js";
import { runMappedAction } from "./actionRunner.js";
import {
  extractEmails,
  findThreadIds,
  parseNameAndEmail,
  resultToJsonOrText,
  uniq,
  safeIsoDate
} from "./utils.js";

export const RevOpsInboxTriageInputSchema = z.object({
  gmail: z
    .object({
      query: z.string().optional().default("newer_than:7d in:inbox"),
      max_threads: z.number().int().min(1).max(50).optional().default(10),
      include_body: z.boolean().optional().default(false)
    })
    .default({}),
  owner_email: z.string().email().optional(),
  lead_defaults: z
    .object({
      stage: z.string().optional().default("Inbound"),
      company: z.string().optional().default("")
    })
    .default({}),
  crm: z
    .object({
      base_id: z.string().optional().default(""),
      contacts_table: z.string().optional().default("Contacts"),
      tasks_table: z.string().optional().default("Tasks"),
      touchpoints_table: z.string().optional().default("Touchpoints")
    })
    .default({}),
  confirm_write: z.boolean().optional().default(false),
  dry_run: z.boolean().optional().default(false)
});

function getAction(map: ActionMap | null, key: string): ActionSpec | null {
  return map?.revops?.[key] ?? null;
}

function bestEffortNormalizeThread(raw: any) {
  // We do not assume a specific Gmail MCP schema.
  // We produce a stable normalized object that still carries raw.
  const blob = JSON.stringify(raw ?? {}).slice(0, 120_000);
  const emails = extractEmails(blob);
  const subject =
    raw?.subject ??
    raw?.snippetSubject ??
    raw?.headers?.Subject ??
    raw?.headers?.subject ??
    raw?.thread?.subject ??
    null;

  const fromHeader =
    raw?.from ??
    raw?.headers?.From ??
    raw?.headers?.from ??
    raw?.lastMessage?.from ??
    null;

  const { name: fromName, email: fromEmail } = parseNameAndEmail(String(fromHeader ?? ""));
  const dateCandidate =
    raw?.date ??
    raw?.internalDate ??
    raw?.lastMessage?.date ??
    raw?.headers?.Date ??
    raw?.headers?.date ??
    null;

  const iso = safeIsoDate(dateCandidate);

  const snippet =
    raw?.snippet ??
    raw?.summary ??
    raw?.lastMessage?.snippet ??
    raw?.lastMessage?.bodyPreview ??
    null;

  return {
    subject,
    from: { name: fromName, email: fromEmail },
    iso_date: iso,
    snippet,
    emails,
    raw
  };
}

function inferNeedsReply(norm: any, ownerEmail?: string) {
  const owner = (ownerEmail || "").toLowerCase().trim();
  if (!owner) return null;

  // If the "from" email is not owner, likely needs reply (heuristic)
  if (norm?.from?.email && norm.from.email !== owner) return true;
  return false;
}

export async function revopsInboxTriageToCrm(
  mgr: UpstreamManager,
  actionMap: ActionMap | null,
  allowWriteGlobal: boolean,
  input: z.infer<typeof RevOpsInboxTriageInputSchema>
) {
  const gmailSearch = getAction(actionMap, "gmail_search_threads");
  const gmailGetThread = getAction(actionMap, "gmail_get_thread");
  const airtableUpsert = getAction(actionMap, "airtable_upsert_contact");
  const airtableTask = getAction(actionMap, "airtable_create_task");
  const airtableTouch = getAction(actionMap, "airtable_log_touchpoint");

  const out: any = {
    query: input.gmail.query,
    max_threads: input.gmail.max_threads,
    threads: [],
    lead_candidates: [],
    actions: {}
  };

  if (!gmailSearch) {
    out.error = "Missing action map: revops.gmail_search_threads";
    return out;
  }
  if (!gmailGetThread) {
    out.error = "Missing action map: revops.gmail_get_thread";
    return out;
  }

  // 1) Search threads
  const ctxSearch = { gmail: input.gmail, crm: input.crm };
  const searchRes = await runMappedAction({
    mgr,
    action: gmailSearch,
    ctx: ctxSearch,
    allowWriteGlobal,
    confirmWrite: input.confirm_write,
    dryRun: input.dry_run
  });

  out.actions.gmail_search_threads = searchRes;

  const parsed = resultToJsonOrText((searchRes as any).result);
  const threadIds = uniq(findThreadIds(parsed.json ?? parsed.text ?? parsed.raw));

  out.thread_ids = threadIds.slice(0, input.gmail.max_threads);

  // 2) Fetch threads + extract candidates
  const candidates: { email: string; name?: string; company?: string; stage: string }[] = [];
  for (const threadId of out.thread_ids) {
    const ctxThread = { thread_id: threadId, gmail: input.gmail, crm: input.crm };
    const thrRes = await runMappedAction({
      mgr,
      action: gmailGetThread,
      ctx: ctxThread,
      allowWriteGlobal,
      confirmWrite: input.confirm_write,
      dryRun: input.dry_run
    });

    const rawThread = (thrRes as any).result;
    const threadParsed = resultToJsonOrText(rawThread);
    const norm = bestEffortNormalizeThread(threadParsed.json ?? threadParsed.text ?? threadParsed.raw);
    const needsReply = inferNeedsReply(norm, input.owner_email ?? undefined);

    // candidate emails (exclude owner)
    const owner = (input.owner_email || "").toLowerCase().trim();
    const externalEmails = (norm.emails || []).filter((e: string) => (owner ? e !== owner : true));

    out.threads.push({
      thread_id: threadId,
      subject: norm.subject,
      from: norm.from,
      iso_date: norm.iso_date,
      needs_reply: needsReply,
      snippet: norm.snippet,
      emails: externalEmails,
      raw_preview: (threadParsed.text || "").slice(0, 4000)
    });

    for (const e of externalEmails) {
      candidates.push({
        email: e,
        name: norm.from?.email === e ? norm.from?.name : undefined,
        company: input.lead_defaults.company || undefined,
        stage: input.lead_defaults.stage
      });
    }
  }

  // de-dupe candidates by email
  const byEmail = new Map<string, any>();
  for (const c of candidates) {
    if (!byEmail.has(c.email)) byEmail.set(c.email, c);
  }
  out.lead_candidates = Array.from(byEmail.values());

  // 3) Optional: write to Airtable (upsert contacts + create tasks/touchpoints)
  out.actions.airtable_upserts = [];
  out.actions.airtable_tasks = [];
  out.actions.airtable_touchpoints = [];

  if (airtableUpsert) {
    for (const c of out.lead_candidates) {
      const ctx = {
        lead: {
          full_name: c.name || c.email,
          email: c.email,
          company: c.company || "",
          linkedin_url: "",
          stage: c.stage
        },
        crm: input.crm
      };
      out.actions.airtable_upserts.push(
        await runMappedAction({
          mgr,
          action: airtableUpsert,
          ctx,
          allowWriteGlobal,
          confirmWrite: input.confirm_write,
          dryRun: input.dry_run
        })
      );
    }
  }

  if (airtableTask) {
    // Create tasks for threads that likely need reply
    for (const t of out.threads) {
      if (t.needs_reply !== true) continue;

      const ctx = {
        crm: input.crm,
        task: {
          title: `Reply: ${t.subject || "Email thread"}`,
          due_iso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          thread_id: t.thread_id,
          from_email: t.from?.email || "",
          subject: t.subject || ""
        }
      };

      out.actions.airtable_tasks.push(
        await runMappedAction({
          mgr,
          action: airtableTask,
          ctx,
          allowWriteGlobal,
          confirmWrite: input.confirm_write,
          dryRun: input.dry_run
        })
      );
    }
  }

  if (airtableTouch) {
    // Log touchpoints for each thread (optional)
    for (const t of out.threads) {
      const ctx = {
        crm: input.crm,
        touchpoint: {
          channel: "Email",
          iso_date: t.iso_date,
          subject: t.subject,
          thread_id: t.thread_id,
          from_email: t.from?.email || "",
          snippet: t.snippet || ""
        }
      };

      out.actions.airtable_touchpoints.push(
        await runMappedAction({
          mgr,
          action: airtableTouch,
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
