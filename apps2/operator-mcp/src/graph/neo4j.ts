import neo4j, { Driver } from "neo4j-driver";
import { logger } from "../log.js";

export type ToolRunGraph = {
  runId: string;
  actorId: string;
  toolName: string;
  serverName: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  success?: boolean;
  error?: string | null;
};

export type DocumentGraph = {
  docId: string;
  type: string;
  title: string;
  source?: string | null;
  tags?: string[] | null;
  updatedAt: string;
};

export class Neo4jGraph {
  private driver: Driver;

  constructor(uri: string, user: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  async close() {
    await this.driver.close();
  }

  async ensureSchema() {
    const session = this.driver.session();
    try {
      await session.run(`CREATE CONSTRAINT actor_id IF NOT EXISTS FOR (a:Actor) REQUIRE a.id IS UNIQUE`);
      await session.run(`CREATE CONSTRAINT tool_key IF NOT EXISTS FOR (t:Tool) REQUIRE t.key IS UNIQUE`);
      await session.run(`CREATE CONSTRAINT toolrun_id IF NOT EXISTS FOR (r:ToolRun) REQUIRE r.id IS UNIQUE`);
      await session.run(`CREATE CONSTRAINT draft_id IF NOT EXISTS FOR (d:Draft) REQUIRE d.id IS UNIQUE`);
      await session.run(`CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE`);
      await session.run(`CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE`);
      await session.run(`CREATE CONSTRAINT action_id IF NOT EXISTS FOR (a:Action) REQUIRE a.id IS UNIQUE`);

      await session.run(`CREATE INDEX doc_updatedAt IF NOT EXISTS FOR (d:Document) ON (d.updatedAt)`);
      await session.run(`CREATE INDEX run_startedAt IF NOT EXISTS FOR (r:ToolRun) ON (r.startedAt)`);
    } finally {
      await session.close();
    }
  }

  async upsertActor(actorId: string, label?: string) {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MERGE (a:Actor {id: $actorId})
        ON CREATE SET a.createdAt = datetime()
        SET a.label = coalesce($label, a.label)
        `,
        { actorId, label: label || null }
      );
    } finally {
      await session.close();
    }
  }

  async recordToolRun(run: ToolRunGraph) {
    const toolKey = `${run.serverName}::${run.toolName}`;
    const session = this.driver.session();
    try {
      await session.run(
        `
        MERGE (a:Actor {id: $actorId})
        ON CREATE SET a.createdAt = datetime()

        MERGE (t:Tool {key: $toolKey})
        ON CREATE SET t.createdAt = datetime(), t.name = $toolName, t.server = $serverName
        SET t.name = $toolName, t.server = $serverName

        MERGE (r:ToolRun {id: $runId})
        ON CREATE SET r.createdAt = datetime(), r.startedAt = $startedAt
        SET
          r.toolName = $toolName,
          r.serverName = $serverName,
          r.startedAt = $startedAt,
          r.finishedAt = coalesce($finishedAt, r.finishedAt),
          r.durationMs = coalesce($durationMs, r.durationMs),
          r.success = coalesce($success, r.success),
          r.error = coalesce($error, r.error)

        MERGE (a)-[:RAN]->(r)
        MERGE (r)-[:USED]->(t)
        `,
        {
          actorId: run.actorId,
          runId: run.runId,
          toolName: run.toolName,
          serverName: run.serverName,
          toolKey,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt || null,
          durationMs: typeof run.durationMs === "number" ? run.durationMs : null,
          success: typeof run.success === "boolean" ? run.success : null,
          error: run.error ?? null
        }
      );
    } catch (e: any) {
      logger.warn({ err: e?.message || String(e) }, "Neo4j recordToolRun failed");
    } finally {
      await session.close();
    }
  }

  async upsertDocument(doc: DocumentGraph) {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MERGE (d:Document {id: $docId})
        ON CREATE SET d.createdAt = datetime()
        SET
          d.type = $type,
          d.title = $title,
          d.source = $source,
          d.tags = $tags,
          d.updatedAt = $updatedAt
        `,
        {
          docId: doc.docId,
          type: doc.type,
          title: doc.title,
          source: doc.source || null,
          tags: doc.tags || null,
          updatedAt: doc.updatedAt
        }
      );
    } catch (e: any) {
      logger.warn({ err: e?.message || String(e) }, "Neo4j upsertDocument failed");
    } finally {
      await session.close();
    }
  }

  async linkToolRunToDocument(runId: string, docId: string, relation: string) {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (r:ToolRun {id: $runId})
        MATCH (d:Document {id: $docId})
        MERGE (r)-[rel:TOUCHED {relation: $relation}]->(d)
        ON CREATE SET rel.createdAt = datetime()
        `,
        { runId, docId, relation }
      );
    } catch (e: any) {
      logger.warn({ err: e?.message || String(e) }, "Neo4j linkToolRunToDocument failed");
    } finally {
      await session.close();
    }
  }

  async upsertDraft(draft: { id: string; kind: string; title?: string | null; status: string; createdAt: string; updatedAt: string }) {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MERGE (d:Draft {id: $id})
        ON CREATE SET d.createdAt = $createdAt
        SET d.kind = $kind, d.title = $title, d.status = $status, d.updatedAt = $updatedAt
        `,
        {
          id: draft.id,
          kind: draft.kind,
          title: draft.title || null,
          status: draft.status,
          createdAt: draft.createdAt,
          updatedAt: draft.updatedAt
        }
      );
    } finally {
      await session.close();
    }
  }

  async linkToolRunToDraft(runId: string, draftId: string) {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (r:ToolRun {id: $runId})
        MATCH (d:Draft {id: $draftId})
        MERGE (r)-[:CREATED]->(d)
        `,
        { runId, draftId }
      );
    } finally {
      await session.close();
    }
  }

  async upsertAction(action: {
    id: string;
    type: string;
    risk: string;
    requiresApproval: boolean;
    status: string;
    payloadKind: string | null;
    payloadRef: string | null;
  }) {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MERGE (a:Action {id: $id})
        ON CREATE SET a.createdAt = datetime()
        SET
          a.type = $type,
          a.risk = $risk,
          a.requiresApproval = $requiresApproval,
          a.status = $status,
          a.payloadKind = $payloadKind,
          a.payloadRef = $payloadRef
        `,
        {
          id: action.id,
          type: action.type,
          risk: action.risk,
          requiresApproval: action.requiresApproval,
          status: action.status,
          payloadKind: action.payloadKind,
          payloadRef: action.payloadRef
        }
      );
    } finally {
      await session.close();
    }
  }

  async linkActionToToolRun(actionId: string, runId: string) {
    const session = this.driver.session();
    try {
      await session.run(
        `
        MATCH (a:Action {id: $actionId})
        MATCH (r:ToolRun {id: $runId})
        MERGE (a)-[:EXECUTED_BY]->(r)
        `,
        { actionId, runId }
      );
    } finally {
      await session.close();
    }
  }
}
