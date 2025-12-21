import "dotenv/config";
import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./config.js";
import { log } from "./logger.js";
import { createGlassboxMcpServer } from "./mcpServer.js";

async function main() {
  const cfg = loadConfig();
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.post("/mcp", async (req, res) => {
    const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      const server = createGlassboxMcpServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport!;
          log("session initialized", sid);
        }
      });
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        id: null
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
    const transport = sessionId ? transports[sessionId] : undefined;
    if (!transport) return res.status(400).send("No session");
    await transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
    const transport = sessionId ? transports[sessionId] : undefined;
    if (!transport) return res.status(400).send("No session");
    await transport.handleRequest(req, res);
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.listen(cfg.port, cfg.host, () => {
    log(`Glassbox MCP listening on http://${cfg.host}:${cfg.port}`);
    log(`MCP endpoint: http://${cfg.host}:${cfg.port}/mcp`);
  });
}

main().catch((e) => {
  log("fatal", e);
  process.exit(1);
});
