export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RequestOptions = {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  query?: Record<string, any>;
  body?: any;
  timeoutMs?: number;
};

function withTimeout(timeoutMs: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  return { signal: ac.signal, cancel: () => clearTimeout(t) };
}

export async function jsonRequest(opts: RequestOptions) {
  const url = new URL(opts.url);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, String(item));
      } else {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.headers || {})
  };

  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    body = headers["Content-Type"].includes("application/json") ? JSON.stringify(opts.body) : String(opts.body);
  }

  const { signal, cancel } = withTimeout(opts.timeoutMs ?? 30000);
  try {
    const res = await fetch(url.toString(), {
      method: opts.method,
      headers,
      body,
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
      const msg = text || res.statusText || "Request failed";
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }

    return json ?? text;
  } finally {
    cancel();
  }
}
