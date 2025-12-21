import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "../logger.js";
import type { UpstreamConfig } from "./types.js";

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: any;
};

export class UpstreamClient {
  private readonly log = createLogger("UpstreamClient");
  private readonly cfg: UpstreamConfig;

  private client: Client | null = null;
  private transport: StdioClientTransport | StreamableHTTPClientTransport | null = null;
  private connected = false;

  public tools: McpTool[] = [];
  public lastError: string | null = null;

  constructor(cfg: UpstreamConfig) {
    this.cfg = cfg;
  }

  get id() {
    return this.cfg.id;
  }
  get cluster() {
    return this.cfg.cluster;
  }
  get allowWrite() {
    return Boolean(this.cfg.allowWrite);
  }
  get label() {
    return this.cfg.label || this.cfg.id;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.client = new Client(
      { name: `operator-upstream-${this.cfg.id}`, version: "1.0.0" },
      { capabilities: {} }
    );

    if (this.cfg.transport.type === "stdio") {
      this.transport = new StdioClientTransport({
        command: this.cfg.transport.command,
        args: this.cfg.transport.args ?? [],
        env: this.cfg.transport.env ?? {}
      });
    } else {
      const headers = this.cfg.transport.headers ?? {};
      if (this.cfg.transport.readonly) {
        headers["X-MCP-Readonly"] = "true";
      }
      this.transport = new StreamableHTTPClientTransport(new URL(this.cfg.transport.url), {
        requestInit: { headers }
      });
    }

    try {
      await this.client.connect(this.transport);
      this.connected = true;
      this.lastError = null;
    } catch (e: any) {
      this.lastError = e?.message || String(e);
      this.log.error("Failed to connect upstream", { id: this.cfg.id, err: this.lastError });
      throw e;
    }
  }

  async refreshTools(): Promise<McpTool[]> {
    await this.connect();
    if (!this.client) throw new Error("Client not initialized");

    const resp = await this.client.request({ method: "tools/list" }, ListToolsResultSchema);
    this.tools = (resp.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema
    }));
    return this.tools;
  }

  async callTool(toolName: string, args: any): Promise<any> {
    await this.connect();
    if (!this.client) throw new Error("Client not initialized");

    const resp = await this.client.request(
      {
        method: "tools/call",
        params: { name: toolName, args }
      },
      CallToolResultSchema
    );
    return resp;
  }

  async close(): Promise<void> {
    try {
      // Some SDK versions expose close on transport.
      // @ts-expect-error - defensive across versions
      if (this.transport?.close) await this.transport.close();
    } catch {
      // ignore
    } finally {
      this.connected = false;
    }
  }
}
