export type DraftKind =
  | "linkedin_post"
  | "email"
  | "blog_post"
  | "proposal"
  | "meeting_notes"
  | "other";

export type DraftCreateInput = {
  kind: DraftKind;
  title?: string;
  body: string;
  meta?: Record<string, any>;
};
