export function extractTextFromMcpResult(result: any): string {
  if (!result) return "";
  const content = result.content;
  if (!Array.isArray(content)) return "";

  const texts = content
    .filter((c: any) => c && c.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text);

  return texts.join("\n").trim();
}

export function tryParseJson(text: string): any | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;

  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

export function resultToJsonOrText(result: any): { json: any | null; text: string; raw: any } {
  const text = extractTextFromMcpResult(result);
  const json = tryParseJson(text);
  return { json, text, raw: result };
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export function extractEmails(blob: string): string[] {
  const s = blob || "";
  const rx = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = s.match(rx) || [];
  return uniq(matches.map((m) => m.toLowerCase())).filter((e) => !e.includes("noreply"));
}

export function parseNameAndEmail(header: string): { name?: string; email?: string } {
  const h = (header || "").trim();
  if (!h) return {};

  // Common format: Name <email@domain.com>
  const m = h.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  if (m) {
    return { name: m[1]?.trim() || undefined, email: m[2]?.trim().toLowerCase() || undefined };
  }

  // Just an email
  const emails = extractEmails(h);
  if (emails.length === 1) return { email: emails[0] };

  return {};
}

export function findThreadIds(candidate: any): string[] {
  // Tries multiple likely shapes.
  if (!candidate) return [];

  if (Array.isArray(candidate.thread_ids)) return candidate.thread_ids.map(String);
  if (Array.isArray(candidate.threadIds)) return candidate.threadIds.map(String);
  if (Array.isArray(candidate.ids)) return candidate.ids.map(String);

  if (Array.isArray(candidate.threads)) {
    const ids = candidate.threads
      .map((t: any) => t?.id ?? t?.thread_id ?? t?.threadId)
      .filter(Boolean)
      .map(String);
    if (ids.length) return ids;
  }

  if (Array.isArray(candidate.messages)) {
    const ids = candidate.messages
      .map((m: any) => m?.threadId ?? m?.thread_id)
      .filter(Boolean)
      .map(String);
    if (ids.length) return uniq(ids);
  }

  return [];
}

export function safeIsoDate(d: any): string | null {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString();
  } catch {
    return null;
  }
}

export function daysAgo(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const now = Date.now();
  return Math.floor((now - t) / (1000 * 60 * 60 * 24));
}
