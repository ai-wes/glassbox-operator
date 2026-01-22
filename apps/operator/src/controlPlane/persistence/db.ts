import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export type ToolRunRow = {
  id: string;
  actor_id: string | null;
  tool_name: string;
  server_name: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  success: number | null;
  arguments_json: string | null;
  result_json: string | null;
  error_json: string | null;
};

export type KbDocRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  source: string | null;
  owner: string | null;
  visibility: string | null;
  tags_json: string | null;
  created_at: string;
  updated_at: string;
};

export type DraftRow = {
  id: string;
  kind: string;
  title: string | null;
  body: string;
  status: string;
  meta_json: string | null;
  created_at: string;
  updated_at: string;
};

export type ArpPacketRow = {
  id: string;
  source: string | null;
  actor: string | null;
  payload_json: string | null;
  created_at: string;
};

export type ArpActionRow = {
  id: string;
  packet_id: string;
  action_type: string;
  risk: string;
  requires_approval: number;
  status: string;
  payload_kind: string | null;
  payload_ref: string | null;
  notes: string | null;
  details_json: string | null;
  created_at: string;
  updated_at: string;
};

export type ActionExecutionRow = {
  id: string;
  action_id: string;
  packet_id: string;
  mode: string;
  started_at: string;
  finished_at: string | null;
  success: number | null;
  result_json: string | null;
  error_json: string | null;
};

export class OperatorDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    const useGcsFuse = dbPath.startsWith("/data/");
    runMigrations(this.db, {
      journalMode: useGcsFuse ? "DELETE" : "WAL",
      synchronous: useGcsFuse ? "FULL" : "NORMAL"
    });
  }

  close() {
    this.db.close();
  }

  healthCheck(): { ok: boolean; error?: string } {
    try {
      this.db.prepare("SELECT 1").get();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  // -----------------------
  // Tool runs (audit)
  // -----------------------
  startToolRun(row: {
    id: string;
    actorId?: string | null;
    toolName: string;
    serverName: string;
    startedAt: string;
    argsJson: string | null;
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO tool_runs (id, actor_id, tool_name, server_name, started_at, arguments_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(row.id, row.actorId || null, row.toolName, row.serverName, row.startedAt, row.argsJson);
  }

  finishToolRun(row: {
    id: string;
    finishedAt: string;
    durationMs: number;
    success: boolean;
    resultJson: string | null;
    errorJson: string | null;
  }) {
    const stmt = this.db.prepare(`
      UPDATE tool_runs
      SET finished_at = ?, duration_ms = ?, success = ?, result_json = ?, error_json = ?
      WHERE id = ?
    `);
    stmt.run(row.finishedAt, row.durationMs, row.success ? 1 : 0, row.resultJson, row.errorJson, row.id);
  }

  listRecentToolRuns(limit: number): ToolRunRow[] {
    const stmt = this.db.prepare(`
      SELECT *
      FROM tool_runs
      ORDER BY started_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as ToolRunRow[];
  }

  // -----------------------
  // Events (append-only)
  // -----------------------
  insertEvent(row: { id: string; type: string; entityId?: string | null; payloadJson?: string | null; createdAt: string }) {
    const stmt = this.db.prepare(`
      INSERT INTO events (id, type, entity_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(row.id, row.type, row.entityId || null, row.payloadJson || null, row.createdAt);
  }

  listRecentEvents(limit: number): Array<{ id: string; type: string; entity_id: string | null; payload_json: string | null; created_at: string }> {
    const stmt = this.db.prepare(`
      SELECT *
      FROM events
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit) as any[];
  }

  // -----------------------
  // Knowledge base (KB)
  // -----------------------
  upsertKbDoc(doc: KbDocRow) {
    const stmt = this.db.prepare(`
      INSERT INTO kb_docs (id, type, title, body, source, owner, visibility, tags_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        type=excluded.type,
        title=excluded.title,
        body=excluded.body,
        source=excluded.source,
        owner=excluded.owner,
        visibility=excluded.visibility,
        tags_json=excluded.tags_json,
        updated_at=excluded.updated_at
    `);
    stmt.run(
      doc.id,
      doc.type,
      doc.title,
      doc.body,
      doc.source,
      doc.owner,
      doc.visibility,
      doc.tags_json,
      doc.created_at,
      doc.updated_at
    );
  }

  getKbDoc(id: string): KbDocRow | null {
    const stmt = this.db.prepare(`SELECT * FROM kb_docs WHERE id = ?`);
    return (stmt.get(id) as KbDocRow) || null;
  }

  deleteKbDoc(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM kb_docs WHERE id = ?`);
    const res = stmt.run(id);
    return (res.changes || 0) > 0;
  }

  listKbDocs(
    limit: number,
    offset: number
  ): Array<Pick<KbDocRow, "id" | "type" | "title" | "source" | "owner" | "visibility" | "tags_json" | "created_at" | "updated_at">> {
    const stmt = this.db.prepare(`
      SELECT id, type, title, source, owner, visibility, tags_json, created_at, updated_at
      FROM kb_docs
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset) as any[];
  }

  searchKb(query: string, limit: number) {
    // FTS query; caller can pass natural text (porter tokenizer helps).
    // If FTS throws (rare), we fallback to LIKE.
    try {
      const stmt = this.db.prepare(`
        SELECT
          d.id,
          d.type,
          d.title,
          d.source,
          d.tags_json,
          d.owner,
          d.visibility,
          d.updated_at,
          snippet(kb_docs_fts, 1, '[', ']', '…', 10) AS snippet
        FROM kb_docs_fts
        JOIN kb_docs d ON d.rowid = kb_docs_fts.rowid
        WHERE kb_docs_fts MATCH ?
        ORDER BY bm25(kb_docs_fts)
        LIMIT ?
      `);
      return stmt.all(query, limit) as Array<{
        id: string;
        type: string;
        title: string;
        source: string | null;
        owner: string | null;
        visibility: string | null;
        tags_json: string | null;
        updated_at: string;
        snippet: string;
      }>;
    } catch {
      const stmt = this.db.prepare(`
        SELECT
          id, type, title, source, owner, visibility, tags_json, updated_at,
          substr(body, 1, 280) AS snippet
        FROM kb_docs
        WHERE title LIKE ? OR body LIKE ?
        ORDER BY updated_at DESC
        LIMIT ?
      `);
      const q = `%${query}%`;
      return stmt.all(q, q, limit) as any[];
    }
  }

  // -----------------------
  // Drafts
  // -----------------------
  createDraft(d: DraftRow) {
    const stmt = this.db.prepare(`
      INSERT INTO drafts (id, kind, title, body, status, meta_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(d.id, d.kind, d.title, d.body, d.status, d.meta_json, d.created_at, d.updated_at);
  }

  updateDraftStatus(id: string, status: string, updatedAt: string) {
    const stmt = this.db.prepare(`
      UPDATE drafts
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, updatedAt, id);
  }

  listDrafts(limit: number, offset: number, kind?: string | string[], status?: string): DraftRow[] {
    const clauses: string[] = [];
    const params: any[] = [];
    if (kind) {
      if (Array.isArray(kind)) {
        clauses.push(`kind IN (${kind.map(() => "?").join(", ")})`);
        params.push(...kind);
      } else {
        clauses.push(`kind = ?`);
        params.push(kind);
      }
    }
    if (status) {
      clauses.push(`status = ?`);
      params.push(status);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const stmt = this.db.prepare(`
      SELECT *
      FROM drafts
      ${where}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(...params, limit, offset) as DraftRow[];
  }

  getDraft(id: string): DraftRow | null {
    const stmt = this.db.prepare(`SELECT * FROM drafts WHERE id = ?`);
    return (stmt.get(id) as DraftRow) || null;
  }

  // -----------------------
  // ARP packets + actions
  // -----------------------
  createArpPacket(row: { id: string; source?: string | null; actor?: string | null; payloadJson?: string | null; createdAt: string }) {
    const stmt = this.db.prepare(`
      INSERT INTO arp_packets (id, source, actor, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(row.id, row.source || null, row.actor || null, row.payloadJson || null, row.createdAt);
  }

  getArpPacket(id: string): ArpPacketRow | null {
    const stmt = this.db.prepare(`SELECT * FROM arp_packets WHERE id = ?`);
    return (stmt.get(id) as ArpPacketRow) || null;
  }

  listArpPackets(limit: number, offset: number): ArpPacketRow[] {
    const stmt = this.db.prepare(`
      SELECT *
      FROM arp_packets
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(limit, offset) as ArpPacketRow[];
  }

  createArpAction(row: {
    id: string;
    packetId: string;
    actionType: string;
    risk: string;
    requiresApproval: boolean;
    status: string;
    payloadKind?: string | null;
    payloadRef?: string | null;
    notes?: string | null;
    detailsJson?: string | null;
    createdAt: string;
    updatedAt: string;
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO arp_actions (
        id, packet_id, action_type, risk, requires_approval, status,
        payload_kind, payload_ref, notes, details_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      row.id,
      row.packetId,
      row.actionType,
      row.risk,
      row.requiresApproval ? 1 : 0,
      row.status,
      row.payloadKind || null,
      row.payloadRef || null,
      row.notes || null,
      row.detailsJson || null,
      row.createdAt,
      row.updatedAt
    );
  }

  listArpActions(packetId: string): ArpActionRow[] {
    const stmt = this.db.prepare(`
      SELECT *
      FROM arp_actions
      WHERE packet_id = ?
      ORDER BY updated_at DESC
    `);
    return stmt.all(packetId) as ArpActionRow[];
  }

  getArpAction(actionId: string): ArpActionRow | null {
    const stmt = this.db.prepare(`SELECT * FROM arp_actions WHERE id = ?`);
    return (stmt.get(actionId) as ArpActionRow) || null;
  }

  updateArpActionStatus(actionId: string, status: string, updatedAt: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE arp_actions
      SET status = ?, updated_at = ?
      WHERE id = ?
    `);
    const res = stmt.run(status, updatedAt, actionId);
    return (res.changes || 0) > 0;
  }

  updateArpActionDetails(actionId: string, detailsJson: string, updatedAt: string): boolean {
    const stmt = this.db.prepare(`
      UPDATE arp_actions
      SET details_json = ?, updated_at = ?
      WHERE id = ?
    `);
    const res = stmt.run(detailsJson, updatedAt, actionId);
    return (res.changes || 0) > 0;
  }

  // -----------------------
  // Execution attempts
  // -----------------------
  startActionExecution(row: {
    id: string;
    actionId: string;
    packetId: string;
    mode: string;
    startedAt: string;
    resultJson?: string | null;
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO action_executions (id, action_id, packet_id, mode, started_at, result_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(row.id, row.actionId, row.packetId, row.mode, row.startedAt, row.resultJson ?? null);
  }

  finishActionExecution(row: {
    id: string;
    finishedAt: string;
    success: boolean;
    resultJson?: string | null;
    errorJson?: string | null;
  }) {
    const stmt = this.db.prepare(`
      UPDATE action_executions
      SET finished_at = ?, success = ?, result_json = ?, error_json = ?
      WHERE id = ?
    `);
    stmt.run(row.finishedAt, row.success ? 1 : 0, row.resultJson ?? null, row.errorJson ?? null, row.id);
  }

  listActionExecutionsForPacket(packetId: string, limit: number): ActionExecutionRow[] {
    const stmt = this.db.prepare(`
      SELECT *
      FROM action_executions
      WHERE packet_id = ?
      ORDER BY started_at DESC
      LIMIT ?
    `);
    return stmt.all(packetId, limit) as ActionExecutionRow[];
  }

  // -----------------------
  // Links: tool_run/draft -> doc
  // -----------------------
  linkDoc(row: {
    id: string;
    fromKind: "tool_run" | "draft" | "action";
    fromId: string;
    toDocId: string;
    relation: string;
    createdAt: string;
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO doc_links (id, from_kind, from_id, to_doc_id, relation, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(row.id, row.fromKind, row.fromId, row.toDocId, row.relation, row.createdAt);
  }

  listDocLinksFor(fromKind: "tool_run" | "draft" | "action", fromId: string) {
    const stmt = this.db.prepare(`
      SELECT *
      FROM doc_links
      WHERE from_kind = ? AND from_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(fromKind, fromId) as Array<{
      id: string;
      from_kind: string;
      from_id: string;
      to_doc_id: string;
      relation: string;
      created_at: string;
    }>;
  }
}
