export type GraphEventStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "EXECUTED" | "BLOCKED" | "FAILED";

export type GraphEvent = {
  event_id: string;
  ts_iso: string;
  kind: string; // e.g. "revops.inbox_triage", "marketing.daily_pack", "operator.proxy_call"
  status: GraphEventStatus;
  actor: "task" | "operator" | "system";
  source?: string; // e.g. task run_id, UI action, etc.
  payload_hash: string;
  payload?: any;
};

export type Artifact = {
  artifact_id: string;
  kind: "email_draft" | "linkedin_post" | "linkedin_dm" | "blog_draft" | "crm_update" | "task" | "other";
  title?: string;
  body?: string;
  meta?: any;
};

export type EntityRefs = {
  lead_email?: string;
  account_domain?: string;
  contact_id?: string;
  opportunity_id?: string;
  thread_id?: string;
  document_slug?: string;
};
