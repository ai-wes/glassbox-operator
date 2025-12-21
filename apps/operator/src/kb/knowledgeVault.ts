import lunr from "lunr";
import fs from "node:fs";
import path from "node:path";

export type VaultDoc = {
  slug: string;
  title: string;
  content: any; // markdown string or JSON
  updated_at?: string; // optional
  tags?: string[];
};

function stripToText(content: any): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function mkExcerpt(text: string, q: string, maxLen = 260): string {
  const t = text || "";
  const i = t.toLowerCase().indexOf((q || "").toLowerCase());
  if (i < 0) return t.slice(0, maxLen);
  const start = Math.max(0, i - 90);
  return t.slice(start, start + maxLen);
}

export class KnowledgeVault {
  private docs = new Map<string, VaultDoc>();
  private idx: lunr.Index | null = null;
  private readonly dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private persistPath() {
    return path.join(this.dataDir, "kb_docs.json");
  }

  loadFromDisk() {
    const p = this.persistPath();
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, "utf-8");
    const arr = JSON.parse(raw) as VaultDoc[];
    this.docs = new Map(arr.map((d) => [d.slug, d]));
    this.rebuildIndex();
  }

  saveToDisk() {
    const arr = Array.from(this.docs.values());
    fs.writeFileSync(this.persistPath(), JSON.stringify(arr, null, 2));
  }

  upsert(doc: VaultDoc) {
    const slug = String(doc.slug || "").trim();
    if (!slug) throw new Error("doc.slug required");
    const title = String(doc.title || slug).trim();

    this.docs.set(slug, {
      slug,
      title,
      content: doc.content,
      updated_at: doc.updated_at,
      tags: doc.tags ?? []
    });

    this.rebuildIndex();
    this.saveToDisk();
  }

  setAll(docs: VaultDoc[]) {
    this.docs = new Map(docs.map((d) => [d.slug, d]));
    this.rebuildIndex();
    this.saveToDisk();
  }

  list(): VaultDoc[] {
    return Array.from(this.docs.values()).sort((a, b) => a.slug.localeCompare(b.slug));
  }

  get(slug: string): VaultDoc | null {
    return this.docs.get(slug) ?? null;
  }

  rebuildIndex() {
    const docs = Array.from(this.docs.values());
    this.idx = lunr(function () {
      this.ref("slug");
      this.field("title");
      this.field("body");
      this.field("tags");

      for (const d of docs) {
        this.add({
          slug: d.slug,
          title: d.title,
          body: stripToText(d.content),
          tags: (d.tags ?? []).join(" ")
        });
      }
    });
  }

  search(query: string, limit = 10) {
    if (!this.idx) this.rebuildIndex();
    if (!this.idx) return [];

    const hits = this.idx.search(query).slice(0, limit);
    return hits
      .map((h) => {
        const d = this.docs.get(h.ref);
        if (!d) return null;
        const body = stripToText(d.content);
        return {
          slug: d.slug,
          title: d.title,
          score: h.score,
          excerpt: mkExcerpt(body, query)
        };
      })
      .filter(Boolean);
  }

  /**
   * Policy-driven copy validation.
   * In your policy docs use:
   *  REQUIRED: <substring>
   *  FORBIDDEN: <substring>
   */
  validateCopy(text: string, policySlugs: string[]) {
    const lower = (text || "").toLowerCase();

    const forbidden: string[] = [];
    const required: string[] = [];

    for (const slug of policySlugs) {
      const d = this.get(slug);
      if (!d) continue;
      const body = stripToText(d.content);

      for (const line of body.split("\n")) {
        const l = line.trim();
        const up = l.toUpperCase();
        if (up.startsWith("FORBIDDEN:")) forbidden.push(l.slice("FORBIDDEN:".length).trim());
        if (up.startsWith("REQUIRED:")) required.push(l.slice("REQUIRED:".length).trim());
      }
    }

    const violations = forbidden.filter((p) => p && lower.includes(p.toLowerCase()));
    const missing = required.filter((p) => p && !lower.includes(p.toLowerCase()));

    return {
      ok: violations.length === 0 && missing.length === 0,
      violations,
      missing,
      policySlugs
    };
  }
}
