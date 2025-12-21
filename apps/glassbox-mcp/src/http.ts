import { loadConfig } from "./config.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function withTimeout(timeoutMs: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  return { signal: ac.signal, cancel: () => clearTimeout(t) };
}

export async function gbRequest(
  method: HttpMethod,
  path: string,
  query?: Record<string, any>,
  body?: any
) {
  const cfg = loadConfig();

  if (!path.startsWith("/")) throw new Error("path must start with '/'");
  if (path.includes("://")) throw new Error("absolute URLs not allowed");

  const url = new URL(cfg.baseUrl + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (cfg.bearer) headers["Authorization"] = `Bearer ${cfg.bearer}`;
  if (cfg.internalKey) headers["X-API-Key"] = cfg.internalKey;

  const { signal, cancel } = withTimeout(cfg.timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
    }
    return json ?? text;
  } finally {
    cancel();
  }
}
