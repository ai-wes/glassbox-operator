export type KbDocType =
  | "policy"
  | "procedure"
  | "messaging"
  | "legal"
  | "sales_playbook"
  | "faq"
  | "product_spec"
  | "pricing"
  | "case_study"
  | "sales"
  | "marketing"
  | "product"
  | "engineering"
  | "other";

export type KbDocVisibility = "public" | "internal" | "restricted";

export type KbDocInput = {
  id?: string;
  type: KbDocType;
  title: string;
  body: string;
  source?: string;
  owner?: string;
  visibility?: KbDocVisibility;
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
