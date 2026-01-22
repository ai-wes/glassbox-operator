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
import { OperatorDb } from "./controlPlane/persistence/db.js";
import { Audit } from "./controlPlane/audit.js";
import { Neo4jGraph as ControlPlaneGraph } from "./controlPlane/graph/neo4j.js";

const log = createLogger("operator");

async function main() {
  const cfg = loadConfig();
  const mgr = new UpstreamManager(cfg.upstreams);

  const db = new OperatorDb(cfg.dbPath);
  let controlPlaneGraph: ControlPlaneGraph | undefined;
  if (process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD) {
    try {
      controlPlaneGraph = new ControlPlaneGraph(
        String(process.env.NEO4J_URI),
        String(process.env.NEO4J_USER),
        String(process.env.NEO4J_PASSWORD)
      );
      await controlPlaneGraph.ensureSchema();
      await controlPlaneGraph.upsertActor(cfg.actorId, cfg.actorId);
      log.info("Control-plane Neo4j connected.");
    } catch (err) {
      log.warn({ err }, "Control-plane Neo4j unavailable; continuing without graph.");
      try {
        await controlPlaneGraph?.close();
      } catch {
        // ignore close errors
      }
      controlPlaneGraph = undefined;
    }
  }
  const audit = new Audit(db, cfg.actorId, cfg.maxPersistBytes, controlPlaneGraph);

  const dataDir = path.resolve(process.cwd(), ".data");
  const kb = new KnowledgeVault(dataDir);
  kb.loadFromDisk();

  const graph = new Neo4jGraph(loadNeo4jConfig());
  try {
    await graph.start();
  } catch (err) {
    log.warn({ err }, "Neo4j graph unavailable; continuing without graph.");
  }

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
      graph,
      db,
      audit,
      controlPlaneGraph,
      actorId: cfg.actorId,
      operatorVersion: cfg.operatorVersion,
      maxPersistBytes: cfg.maxPersistBytes
    })
  );

  app.post("/mcp", session.handle);
  app.get("/mcp", session.handle);
  app.delete("/mcp", session.handle);

  app.get("/health", (_req, res) => res.json({ ok: true }));

  const shutdown = async () => {
    try {
      await graph.stop();
      if (controlPlaneGraph) await controlPlaneGraph.close();
    } catch {
      // ignore
    }
    try {
      db.close();
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
