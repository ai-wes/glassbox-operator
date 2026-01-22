export type DraftKindCanonical =
  | "email_draft"
  | "linkedin_post_draft"
  | "blog_post_draft"
  | "crm_note_draft"
  | "proposal_draft"
  | "ops_runbook_draft"
  | "other";

export type DraftKindInput =
  | DraftKindCanonical
  | "email"
  | "linkedin_post"
  | "blog_post"
  | "proposal"
  | "meeting_notes";

export type DraftStatus =
  | "draft"
  | "ready_for_review"
  | "approved"
  | "queued"
  | "executed"
  | "archived"
  | "rejected"
  | "ready_to_send"
  | "ready_to_post"
  | "ready_to_publish";

export function normalizeDraftKind(kind: DraftKindInput): DraftKindCanonical | DraftKindInput {
  switch (kind) {
    case "email":
      return "email_draft";
    case "linkedin_post":
      return "linkedin_post_draft";
    case "blog_post":
      return "blog_post_draft";
    case "proposal":
      return "proposal_draft";
    default:
      return kind;
  }
}

export function expandDraftKindFilter(kind?: DraftKindInput): DraftKindInput[] | undefined {
  if (!kind) return undefined;
  const normalized = normalizeDraftKind(kind);
  const variants = new Set<DraftKindInput>([kind, normalized as DraftKindInput]);
  return [...variants];
}

export type DraftCreateInput = {
  kind: DraftKindInput;
  title?: string;
  body: string;
  meta?: Record<string, any>;
  status?: DraftStatus;
};
