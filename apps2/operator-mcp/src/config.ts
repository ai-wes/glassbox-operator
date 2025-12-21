import fs from "node:fs";
import path from "node:path";

export type ChildServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpServersConfigFile = {
  mcpServers: Record<string, ChildServerConfig>;
};

export type OperatorConfig = {
  actorId: string;
  dbPath: string;

  neo4jUri?: string;
  neo4jUser?: string;
  neo4jPassword?: string;

  childServersConfigPath?: string;
  maxPersistBytes: number;
};

function ensureDirForFile(filePath: string) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export function loadConfig(): OperatorConfig {
  const actorId = (process.env.OPERATOR_ACTOR_ID || "wes").trim();

  const dbPath = (process.env.OPERATOR_DB_PATH || "./data/operator.db").trim();
  ensureDirForFile(dbPath);

  const neo4jUri = (process.env.NEO4J_URI || "").trim() || undefined;
  const neo4jUser = (process.env.NEO4J_USER || "").trim() || undefined;
  const neo4jPassword = (process.env.NEO4J_PASSWORD || "").trim() || undefined;

  const childServersConfigPath = (process.env.MCP_SERVERS_CONFIG || "").trim() || undefined;

  const maxPersistBytes = Number(process.env.MAX_PERSIST_BYTES || "200000"); // 200 KB default
  if (!Number.isFinite(maxPersistBytes) || maxPersistBytes <= 1024) {
    throw new Error("MAX_PERSIST_BYTES must be a positive number > 1024");
  }

  return {
    actorId,
    dbPath,
    neo4jUri,
    neo4jUser,
    neo4jPassword,
    childServersConfigPath,
    maxPersistBytes
  };
}

export function loadChildServersConfig(filePath?: string): McpServersConfigFile | null {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as McpServersConfigFile;

  if (!parsed || typeof parsed !== "object" || !parsed.mcpServers || typeof parsed.mcpServers !== "object") {
    throw new Error(`Invalid MCP servers config file: ${filePath}`);
  }

  for (const [name, cfg] of Object.entries(parsed.mcpServers)) {
    if (!cfg.command || typeof cfg.command !== "string") {
      throw new Error(`Child server "${name}" missing command`);
    }
    if (cfg.args && !Array.isArray(cfg.args)) {
      throw new Error(`Child server "${name}" args must be array`);
    }
    if (cfg.env && typeof cfg.env !== "object") {
      throw new Error(`Child server "${name}" env must be object`);
    }
  }

  return parsed;
}
