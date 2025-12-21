import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLogger } from "./logger.js";
import { loadConfig } from "./config.js";
import { requireBearerToken } from "./security.js";

import { UpstreamManager } from "./upstreams/upstreamManager.js";
import { createOperatorMcpServer } from "./mcp/createOperatorMcpServer.js";
import { createSessionRouter } from "./mcp/sessionRouter.js";
import { createApiRouter } from "./http/api.js";

import { KnowledgeVault } from "./kb/knowledgeVault.js";
import { Neo4jGraph, loadNeo4jConfig } from "./graph/neo4j.js";

const log = createLogger("operator");

async function main() {
  const cfg = loadConfig();
  const mgr = new UpstreamManager(cfg.upstreams);

  const dataDir = path.resolve(process.cwd(), ".data");
  const kb = new KnowledgeVault(dataDir);
  kb.loadFromDisk();

  const graph = new Neo4jGraph(loadNeo4jConfig());
  await graph.start();

  // Best-effort: connect + load tool catalogs
  await mgr.connectAll(true);
  await mgr.refreshAllTools(true);

  const app = express();
  app.use(express.json({ limit: "6mb" }));
  app.use(cors());
  app.use(requireBearerToken(cfg.apiKey));

  // Minimal UI
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const publicDir = path.resolve(__dirname, "../public");
  app.use("/", express.static(publicDir));

  // HTTP API for UI/testing (includes KB + graph endpoints now)
  app.use(
    "/api",
    createApiRouter({
      mgr,
      actionMap: cfg.actionMap,
      allowWriteGlobal: cfg.allowWriteGlobal,
      kb,
      graph
    })
  );

  // MCP endpoint
  const session = createSessionRouter(() =>
    createOperatorMcpServer({
      mgr,
      actionMap: cfg.actionMap,
      allowWriteGlobal: cfg.allowWriteGlobal,
      kb,
      graph
    })
  );

  app.post("/mcp", session.handle);
  app.get("/mcp", session.handle);
  app.delete("/mcp", session.handle);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  const shutdown = async () => {
    try {
      await graph.stop();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  app.listen(cfg.port, cfg.host, () => {
    log.info(`Operator listening on http://${cfg.host}:${cfg.port}`);
    log.info(`MCP endpoint: http://${cfg.host}:${cfg.port}/mcp`);
    log.info(`Neo4j enabled: ${graph.enabled}`);
  });
}

main().catch((e) => {
  log.error("Fatal", e);
  process.exit(1);
});
