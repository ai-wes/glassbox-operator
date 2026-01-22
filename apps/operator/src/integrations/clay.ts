import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonRequest } from "./http.js";

function toText(obj: any) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function clayBase() {
  const base = process.env.CLAY_BASE_URL || process.env.CLAY_API_BASE_URL || "";
  return base.replace(/\/+$/, "");
}

function clayToken() {
  const token = process.env.CLAY_API_KEY;
  if (!token) throw new Error("Missing required env: CLAY_API_KEY");
  return token;
}

async function clayRequest(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, query?: any, body?: any) {
  if (!(path.startsWith("/") || path.startsWith("http://") || path.startsWith("https://"))) {
    throw new Error("Clay path must start with '/' or be a full URL (https://...)");
  }
  const headers = clayHeaders();
  return await jsonRequest({
    method,
    url: resolveClayUrl(path),
    headers,
    query,
    body,
    timeoutMs: 30000
  });
}

function clayHeaders() {
  const token = clayToken();
  const headerName = process.env.CLAY_API_KEY_HEADER || process.env.CLAY_API_HEADER_NAME || "";
  const prefix = process.env.CLAY_API_KEY_PREFIX || "";
  if (headerName) {
    return {
      [headerName]: `${prefix}${token}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    };
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
}

function resolveClayUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const base = clayBase();
  if (!base) {
    throw new Error("Missing CLAY_BASE_URL; either set CLAY_BASE_URL (or CLAY_API_BASE_URL) or pass a full URL in path.");
  }
  return `${base}${path}`;
}

export function registerClayTools(server: McpServer) {
  // Generic Clay API caller (enterprise / custom API)
  server.tool(
    "clay.request",
    {
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      path: z.string().min(1),
      query: z.record(z.any()).optional(),
      body: z.any().optional()
    },
    async ({ method, path, query, body }) => {
      try {
        const data = await clayRequest(method as any, path, query, body);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  // Clay webhook sender (no API key required; pass the webhook URL)
  server.tool(
    "clay.webhook_send",
    {
      webhook_url: z.string().url(),
      payload: z.any()
    },
    async ({ webhook_url, payload }) => {
      try {
        const data = await jsonRequest({
          method: "POST",
          url: webhook_url,
          headers: { "Content-Type": "application/json" },
          body: payload,
          timeoutMs: 30000
        });
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );
}
