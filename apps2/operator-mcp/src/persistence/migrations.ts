import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);

  let userVersion = db.pragma("user_version", { simple: true }) as number;

  if (userVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_runs (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        server_name TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        success INTEGER,
        arguments_json TEXT,
        result_json TEXT,
        error_json TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tool_runs_started_at ON tool_runs(started_at);
      CREATE INDEX IF NOT EXISTS idx_tool_runs_tool_name ON tool_runs(tool_name);

      CREATE TABLE IF NOT EXISTS drafts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        meta_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_drafts_kind ON drafts(kind);
      CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);
      CREATE INDEX IF NOT EXISTS idx_drafts_updated_at ON drafts(updated_at);

      CREATE TABLE IF NOT EXISTS kb_docs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source TEXT,
        tags_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_kb_docs_type ON kb_docs(type);
      CREATE INDEX IF NOT EXISTS idx_kb_docs_updated_at ON kb_docs(updated_at);

      -- FTS5 virtual table with external content = kb_docs
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_docs_fts
      USING fts5(
        title,
        body,
        content='kb_docs',
        content_rowid='rowid',
        tokenize='porter'
      );

      -- Keep FTS in sync with kb_docs
      CREATE TRIGGER IF NOT EXISTS kb_docs_ai AFTER INSERT ON kb_docs BEGIN
        INSERT INTO kb_docs_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
      END;

      CREATE TRIGGER IF NOT EXISTS kb_docs_ad AFTER DELETE ON kb_docs BEGIN
        INSERT INTO kb_docs_fts(kb_docs_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
      END;

      CREATE TRIGGER IF NOT EXISTS kb_docs_au AFTER UPDATE ON kb_docs BEGIN
        INSERT INTO kb_docs_fts(kb_docs_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
        INSERT INTO kb_docs_fts(rowid, title, body)
        VALUES (new.rowid, new.title, new.body);
      END;

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        entity_id TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

      CREATE TABLE IF NOT EXISTS doc_links (
        id TEXT PRIMARY KEY,
        from_kind TEXT NOT NULL,  -- 'tool_run'|'draft'
        from_id TEXT NOT NULL,
        to_doc_id TEXT NOT NULL,
        relation TEXT NOT NULL,   -- 'touched'|'referenced'|'used'
        created_at TEXT NOT NULL,
        FOREIGN KEY(to_doc_id) REFERENCES kb_docs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_doc_links_from ON doc_links(from_kind, from_id);
      CREATE INDEX IF NOT EXISTS idx_doc_links_doc ON doc_links(to_doc_id);
    `);

    db.pragma("user_version = 1");
    userVersion = 1;
  }

  // -----------------------
  // v2 (ARP packets + actions)
  // -----------------------
  if (userVersion < 2) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS arp_packets (
        id TEXT PRIMARY KEY,
        source TEXT,
        actor TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_arp_packets_created_at ON arp_packets(created_at);

      CREATE TABLE IF NOT EXISTS arp_actions (
        id TEXT PRIMARY KEY,
        packet_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        risk TEXT NOT NULL,
        requires_approval INTEGER NOT NULL,
        status TEXT NOT NULL,
        payload_kind TEXT,
        payload_ref TEXT,
        notes TEXT,
        details_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(packet_id) REFERENCES arp_packets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_arp_actions_packet ON arp_actions(packet_id);
      CREATE INDEX IF NOT EXISTS idx_arp_actions_status ON arp_actions(status);
      CREATE INDEX IF NOT EXISTS idx_arp_actions_updated_at ON arp_actions(updated_at);
    `);

    db.pragma("user_version = 2");
    userVersion = 2;
  }

  // -----------------------
  // v3 (execution attempts)
  // -----------------------
  if (userVersion < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS action_executions (
        id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL,
        packet_id TEXT NOT NULL,
        mode TEXT NOT NULL,            -- dry_run|execute
        started_at TEXT NOT NULL,
        finished_at TEXT,
        success INTEGER,
        result_json TEXT,
        error_json TEXT,
        FOREIGN KEY(action_id) REFERENCES arp_actions(id) ON DELETE CASCADE,
        FOREIGN KEY(packet_id) REFERENCES arp_packets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_action_exec_action ON action_executions(action_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_action_exec_packet ON action_executions(packet_id, started_at);
    `);

    db.pragma("user_version = 3");
    userVersion = 3;
  }
}
