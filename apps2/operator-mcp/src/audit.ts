import { nanoid } from "nanoid";
import { OperatorDb } from "./persistence/db.js";
import { Neo4jGraph } from "./graph/neo4j.js";
import { logger } from "./log.js";

function nowIso() {
  return new Date().toISOString();
}

function safeJsonStringify(value: any, maxBytes: number): string {
  const s = JSON.stringify(value ?? null);
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;
  // hard truncate
  const buf = Buffer.from(s, "utf8");
  return buf.subarray(0, maxBytes).toString("utf8");
}

export class Audit {
  constructor(
    private db: OperatorDb,
    private actorId: string,
    private maxPersistBytes: number,
    private graph?: Neo4jGraph
  ) {}

  async withToolRun<T>(
    toolName: string,
    serverName: string,
    args: any,
    fn: (runId: string) => Promise<T>
  ): Promise<{ runId: string; value: T }> {
    const runId = nanoid();
    const startedAt = nowIso();

    const argsJson = safeJsonStringify(args, this.maxPersistBytes);

    this.db.startToolRun({
      id: runId,
      toolName,
      serverName,
      startedAt,
      argsJson
    });

    if (this.graph) {
      await this.graph.recordToolRun({
        runId,
        actorId: this.actorId,
        toolName,
        serverName,
        startedAt
      });
    }

    const t0 = Date.now();
    try {
      const value = await fn(runId);
      const finishedAt = nowIso();
      const durationMs = Date.now() - t0;

      const resultJson = safeJsonStringify(value, this.maxPersistBytes);

      this.db.finishToolRun({
        id: runId,
        finishedAt,
        durationMs,
        success: true,
        resultJson,
        errorJson: null
      });

      this.db.insertEvent({
        id: nanoid(),
        type: "tool_run",
        entityId: runId,
        payloadJson: safeJsonStringify({ toolName, serverName, success: true }, this.maxPersistBytes),
        createdAt: finishedAt
      });

      if (this.graph) {
        await this.graph.recordToolRun({
          runId,
          actorId: this.actorId,
          toolName,
          serverName,
          startedAt,
          finishedAt,
          durationMs,
          success: true,
          error: null
        });
      }

      return { runId, value };
    } catch (err: any) {
      const finishedAt = nowIso();
      const durationMs = Date.now() - t0;

      const errorPayload = {
        message: err?.message || String(err),
        name: err?.name,
        stack: err?.stack
      };
      const errorJson = safeJsonStringify(errorPayload, this.maxPersistBytes);

      this.db.finishToolRun({
        id: runId,
        finishedAt,
        durationMs,
        success: false,
        resultJson: null,
        errorJson
      });

      this.db.insertEvent({
        id: nanoid(),
        type: "tool_run",
        entityId: runId,
        payloadJson: safeJsonStringify({ toolName, serverName, success: false, error: errorPayload.message }, this.maxPersistBytes),
        createdAt: finishedAt
      });

      if (this.graph) {
        await this.graph.recordToolRun({
          runId,
          actorId: this.actorId,
          toolName,
          serverName,
          startedAt,
          finishedAt,
          durationMs,
          success: false,
          error: errorPayload.message
        });
      }

      logger.warn({ toolName, serverName, err: errorPayload.message }, "Tool run failed");
      throw err;
    }
  }

  touchDocFromRun(runId: string, docId: string, relation: string) {
    const createdAt = nowIso();
    this.db.linkDoc({
      id: nanoid(),
      fromKind: "tool_run",
      fromId: runId,
      toDocId: docId,
      relation,
      createdAt
    });
    if (this.graph) {
      void this.graph.linkToolRunToDocument(runId, docId, relation);
    }
  }

  recordDraftCreated(runId: string, draftId: string) {
    if (this.graph) {
      void this.graph.linkToolRunToDraft(runId, draftId);
    }
  }
}
