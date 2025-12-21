import { createLogger } from "../logger.js";
import type { UpstreamConfig } from "./types.js";
import { UpstreamClient } from "./upstreamClient.js";

export type AggregatedTool = {
  qualifiedName: string; // upstreamId__toolName
  upstreamId: string;
  cluster: string;
  name: string;
  description?: string;
  inputSchema?: any;
};

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export class UpstreamManager {
  private readonly log = createLogger("UpstreamManager");
  private readonly clients = new Map<string, UpstreamClient>();

  constructor(cfgs: UpstreamConfig[]) {
    for (const cfg of cfgs) {
      if (this.clients.has(cfg.id)) throw new Error(`Duplicate upstream id: ${cfg.id}`);
      this.clients.set(cfg.id, new UpstreamClient(cfg));
    }
  }

  listUpstreams(): UpstreamClient[] {
    return Array.from(this.clients.values());
  }

  get(upstreamId: string): UpstreamClient {
    const c = this.clients.get(upstreamId);
    if (!c) throw new Error(`Unknown upstream: ${upstreamId}`);
    return c;
  }

  async connectAll(bestEffort = true): Promise<void> {
    const ups = this.listUpstreams();
    await Promise.all(
      ups.map(async (u) => {
        try {
          await u.connect();
        } catch (e) {
          if (!bestEffort) throw e;
          this.log.warn("Upstream connect failed (best-effort)", { id: u.id, err: u.lastError });
        }
      })
    );
  }

  async refreshAllTools(bestEffort = true): Promise<void> {
    const ups = this.listUpstreams();
    await Promise.all(
      ups.map(async (u) => {
        try {
          await u.refreshTools();
        } catch (e) {
          if (!bestEffort) throw e;
          this.log.warn("Upstream tool refresh failed (best-effort)", { id: u.id, err: u.lastError });
        }
      })
    );
  }

  getAggregatedTools(): AggregatedTool[] {
    const out: AggregatedTool[] = [];
    for (const u of this.listUpstreams()) {
      for (const t of u.tools) {
        const qualifiedName = `${sanitize(u.id)}__${sanitize(t.name)}`;
        out.push({
          qualifiedName,
          upstreamId: u.id,
          cluster: u.cluster,
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        });
      }
    }
    return out.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
  }
}
