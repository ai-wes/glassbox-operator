import neo4j, { Driver } from "neo4j-driver";
import { sha256Json, safeId } from "./hash.js";

export type GraphStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "EXECUTED" | "BLOCKED" | "FAILED";

export type GraphArtifact = {
  artifact_id: string;
  kind: string; // "email_draft" | "linkedin_post" | "blog_draft" | ...
  title?: string;
  body?: string;
  meta?: any;
};

export type GraphAction = {
  action_id: string; // e.g. "M-001"
  type: string;
  risk?: string;
  requires_approval?: boolean;
  payload_ref?: string;
  status?: GraphStatus; // current status (optional)
};

export type GraphEvent = {
  event_id: string;
  ts_iso: string;
  kind: string;
  status: GraphStatus;
  actor: "task" | "operator" | "system";
  source?: string;
  payload_hash: string;
  payload?: any;
};

type Neo4jConfig = {
  enabled: boolean;
  uri: string;
  user: string;
  password: string;
  database: string;
};

function envBool(v: string | undefined): boolean {
  const s = (v || "").toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes";
}

export function loadNeo4jConfig(): Neo4jConfig {
  return {
    enabled: envBool(process.env.NEO4J_ENABLED),
    uri: process.env.NEO4J_URI || "bolt://localhost:7687",
    user: process.env.NEO4J_USER || "neo4j",
    password: process.env.NEO4J_PASSWORD || "neo4j",
    database: process.env.NEO4J_DATABASE || "neo4j"
  };
}

export class Neo4jGraph {
  private driver: Driver | null = null;
  private cfg: Neo4jConfig;

  constructor(cfg: Neo4jConfig) {
    this.cfg = cfg;
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled) return;
    if (this.driver) return;

    this.driver = neo4j.driver(this.cfg.uri, neo4j.auth.basic(this.cfg.user, this.cfg.password));
    await this.driver.verifyConnectivity();

    await this.exec(
      "CREATE CONSTRAINT event_id_unique IF NOT EXISTS FOR (e:Event) REQUIRE e.event_id IS UNIQUE"
    );
    await this.exec(
      "CREATE CONSTRAINT action_id_unique IF NOT EXISTS FOR (a:Action) REQUIRE a.action_id IS UNIQUE"
    );
    await this.exec(
      "CREATE CONSTRAINT artifact_id_unique IF NOT EXISTS FOR (x:Artifact) REQUIRE x.artifact_id IS UNIQUE"
    );
    await this.exec("CREATE CONSTRAINT doc_slug_unique IF NOT EXISTS FOR (d:Document) REQUIRE d.slug IS UNIQUE");
    await this.exec("CREATE CONSTRAINT lead_email_unique IF NOT EXISTS FOR (l:Lead) REQUIRE l.email IS UNIQUE");
  }

  async stop(): Promise<void> {
    if (!this.driver) return;
    await this.driver.close();
    this.driver = null;
  }

  private async exec(cypher: string, params: Record<string, any> = {}) {
    if (!this.cfg.enabled) return null;
    if (!this.driver) throw new Error("Neo4jGraph not started");
    const session = this.driver.session({ database: this.cfg.database });
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async queryReadOnly(cypher: string, params: Record<string, any> = {}) {
    if (!this.cfg.enabled) return { enabled: false, rows: [] };
    const res = await this.exec(cypher, params);
    const rows = (res?.records ?? []).map((r: any) => r.toObject());
    return { enabled: true, rows };
  }

  async logEvent(params: {
    kind: string;
    status: GraphStatus;
    actor: GraphEvent["actor"];
    source?: string;
    payload?: any;
    lead_email?: string;
    doc_slug?: string;
    artifacts?: GraphArtifact[];
    actions?: GraphAction[];
  }): Promise<{ event_id: string } | null> {
    if (!this.cfg.enabled) return null;

    const ts_iso = new Date().toISOString();
    const payload = params.payload ?? {};
    const payload_hash = sha256Json(payload);
    const event_id = safeId(`E:${params.kind}:${ts_iso}:${payload_hash.slice(0, 12)}`);

    const artifacts = (params.artifacts ?? []).map((a) => ({
      ...a,
      body: a.body ? String(a.body).slice(0, 20000) : undefined,
      title: a.title ? String(a.title).slice(0, 300) : undefined
    }));

    const actions = (params.actions ?? []).map((a) => ({
      ...a,
      action_id: safeId(a.action_id),
      type: String(a.type || "unknown").slice(0, 80),
      risk: a.risk ? String(a.risk).slice(0, 20) : null,
      requires_approval: a.requires_approval ?? true,
      payload_ref: a.payload_ref ? String(a.payload_ref).slice(0, 240) : null,
      status: a.status ?? "PROPOSED"
    }));

    await this.exec(
      `
      MERGE (e:Event {event_id: $event_id})
      SET e.kind = $kind,
          e.status = $status,
          e.actor = $actor,
          e.source = $source,
          e.ts_iso = $ts_iso,
          e.payload_hash = $payload_hash,
          e.payload = $payload

      FOREACH (_ IN CASE WHEN $lead_email IS NULL OR $lead_email = "" THEN [] ELSE [1] END |
        MERGE (l:Lead {email: $lead_email})
        MERGE (e)-[:ABOUT]->(l)
      )

      FOREACH (_ IN CASE WHEN $doc_slug IS NULL OR $doc_slug = "" THEN [] ELSE [1] END |
        MERGE (d:Document {slug: $doc_slug})
        MERGE (e)-[:ABOUT]->(d)
      )

      FOREACH (a IN $actions |
        MERGE (ac:Action {action_id: a.action_id})
        SET ac.type = a.type,
            ac.risk = a.risk,
            ac.requires_approval = a.requires_approval,
            ac.payload_ref = a.payload_ref,
            ac.status = a.status,
            ac.updated_at = $ts_iso
        MERGE (e)-[:PROPOSES]->(ac)
      )

      FOREACH (x IN $artifacts |
        MERGE (ar:Artifact {artifact_id: x.artifact_id})
        SET ar.kind = x.kind,
            ar.title = x.title,
            ar.body = x.body,
            ar.meta = x.meta,
            ar.updated_at = $ts_iso
        MERGE (e)-[:CREATED]->(ar)
      )
      `,
      {
        event_id,
        kind: params.kind,
        status: params.status,
        actor: params.actor,
        source: params.source ?? null,
        ts_iso,
        payload_hash,
        payload,
        lead_email: (params.lead_email || "").toLowerCase() || null,
        doc_slug: params.doc_slug || null,
        actions,
        artifacts
      }
    );

    return { event_id };
  }

  async setActionStatus(action_id: string, status: GraphStatus) {
    if (!this.cfg.enabled) return { enabled: false };
    await this.exec(
      `
      MERGE (a:Action {action_id: $action_id})
      SET a.status = $status,
          a.updated_at = $ts_iso
      `,
      { action_id: safeId(action_id), status, ts_iso: new Date().toISOString() }
    );
    return { enabled: true, action_id, status };
  }
}
