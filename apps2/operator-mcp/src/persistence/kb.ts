export type KbDocInput = {
  id?: string;
  type: "policy" | "procedure" | "messaging" | "legal" | "sales" | "marketing" | "product" | "engineering" | "other";
  title: string;
  body: string;
  source?: string;
  tags?: string[];
};

export type KbSearchResult = {
  id: string;
  type: string;
  title: string;
  source: string | null;
  tags: string[];
  updatedAt: string;
  snippet: string;
};

export function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function tagsToJson(tags?: string[]): string | null {
  if (!tags || !tags.length) return null;
  return JSON.stringify([...new Set(tags.map((t) => t.trim()).filter(Boolean))]);
}
