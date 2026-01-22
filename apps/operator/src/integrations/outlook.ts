import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonRequest } from "./http.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_BASE = "https://login.microsoftonline.com";

function toText(obj: any) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function envFirst(...names: string[]) {
  for (const name of names) {
    const v = process.env[name];
    if (v) return v;
  }
  return "";
}

function requireEnv(name: string, aliases: string[] = []) {
  const v = envFirst(name, ...aliases);
  if (!v) throw new Error(`Missing required env: ${[name, ...aliases].join(" or ")}`);
  return v;
}

type TokenCache = { token: string; expiresAt: number } | null;
let tokenCache: TokenCache = null;

async function getAccessToken() {
  const tenantId = requireEnv("OUTLOOK_TENANT_ID", ["MS365_MCP_TENANT_ID"]);
  const clientId = requireEnv("OUTLOOK_CLIENT_ID", ["MS365_MCP_CLIENT_ID"]);
  const clientSecret = requireEnv("OUTLOOK_CLIENT_SECRET", ["MS365_MCP_CLIENT_SECRET"]);
  const refreshToken = envFirst("OUTLOOK_REFRESH_TOKEN", "MS365_REFRESH_TOKEN");
  const scope = envFirst("OUTLOOK_SCOPES", "MS365_SCOPES") || "https://graph.microsoft.com/.default";

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const url = `${TOKEN_BASE}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams();
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  if (refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
    body.set("scope", scope);
  } else {
    body.set("grant_type", "client_credentials");
    body.set("scope", scope);
  }

  const res = await jsonRequest({
    method: "POST",
    url,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    timeoutMs: 20000
  });

  const token = res?.access_token as string | undefined;
  const expiresIn = Number(res?.expires_in || 3600);
  if (!token) throw new Error("Failed to obtain Outlook access token");
  tokenCache = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}

function mailboxPath() {
  const upn = envFirst("OUTLOOK_MAILBOX_UPN", "M365_MAILBOX_UPN", "MS365_MAILBOX_UPN");
  if (upn) return `/users/${encodeURIComponent(upn)}`;
  const refresh = envFirst("OUTLOOK_REFRESH_TOKEN", "MS365_REFRESH_TOKEN");
  if (!refresh) {
    throw new Error("OUTLOOK_MAILBOX_UPN (or M365_MAILBOX_UPN) is required for app-only auth");
  }
  return "/me";
}

async function graphRequest(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, query?: any, body?: any) {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json"
  };
  if (query && ("$search" in query || "search" in query)) {
    headers["ConsistencyLevel"] = "eventual";
  }
  return await jsonRequest({
    method,
    url: `${GRAPH_BASE}${path}`,
    headers,
    query,
    body,
    timeoutMs: 30000
  });
}

function toRecipients(emails?: string[]) {
  if (!emails?.length) return [];
  return emails.map((address) => ({ emailAddress: { address } }));
}

export function registerOutlookTools(server: McpServer) {
  server.tool(
    "outlook.search_messages",
    {
      query: z.string().optional(),
      top: z.number().int().min(1).max(50).optional(),
      skip: z.number().int().min(0).optional(),
      folder: z.string().optional(),
      select: z.array(z.string()).optional(),
      orderby: z.string().optional()
    },
    async ({ query, top, skip, folder, select, orderby }) => {
      try {
        const base = mailboxPath();
        const folderPath = folder ? `/mailFolders/${encodeURIComponent(folder)}` : "";
        const path = `${base}${folderPath}/messages`;
        const qp: Record<string, any> = {};
        if (query) qp["$search"] = `"${query}"`;
        if (top) qp["$top"] = top;
        if (skip) qp["$skip"] = skip;
        if (select?.length) qp["$select"] = select.join(",");
        if (orderby) qp["$orderby"] = orderby;
        const data = await graphRequest("GET", path, qp);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "outlook.get_message",
    {
      message_id: z.string().min(1),
      select: z.array(z.string()).optional()
    },
    async ({ message_id, select }) => {
      try {
        const base = mailboxPath();
        const path = `${base}/messages/${encodeURIComponent(message_id)}`;
        const qp: Record<string, any> = {};
        if (select?.length) qp["$select"] = select.join(",");
        const data = await graphRequest("GET", path, qp);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "outlook.list_folders",
    {
      top: z.number().int().min(1).max(200).optional()
    },
    async ({ top }) => {
      try {
        const base = mailboxPath();
        const path = `${base}/mailFolders`;
        const qp: Record<string, any> = {};
        if (top) qp["$top"] = top;
        const data = await graphRequest("GET", path, qp);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "outlook.create_draft",
    {
      subject: z.string().min(1),
      body: z.string().min(1),
      to: z.array(z.string()).min(1),
      cc: z.array(z.string()).optional(),
      bcc: z.array(z.string()).optional(),
      content_type: z.enum(["text", "html"]).optional()
    },
    async ({ subject, body, to, cc, bcc, content_type }) => {
      try {
        const base = mailboxPath();
        const path = `${base}/messages`;
        const payload = {
          subject,
          body: {
            contentType: content_type === "html" ? "HTML" : "Text",
            content: body
          },
          toRecipients: toRecipients(to),
          ccRecipients: toRecipients(cc),
          bccRecipients: toRecipients(bcc),
          isDraft: true
        };
        const data = await graphRequest("POST", path, undefined, payload);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "outlook.create_reply_draft",
    {
      message_id: z.string().min(1)
    },
    async ({ message_id }) => {
      try {
        const base = mailboxPath();
        const path = `${base}/messages/${encodeURIComponent(message_id)}/createReply`;
        const data = await graphRequest("POST", path, undefined, {});
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "outlook.update_draft",
    {
      message_id: z.string().min(1),
      subject: z.string().optional(),
      body: z.string().optional(),
      to: z.array(z.string()).optional(),
      cc: z.array(z.string()).optional(),
      bcc: z.array(z.string()).optional(),
      content_type: z.enum(["text", "html"]).optional()
    },
    async ({ message_id, subject, body, to, cc, bcc, content_type }) => {
      try {
        const base = mailboxPath();
        const path = `${base}/messages/${encodeURIComponent(message_id)}`;
        const payload: Record<string, any> = {};
        if (subject) payload.subject = subject;
        if (body) {
          payload.body = {
            contentType: content_type === "html" ? "HTML" : "Text",
            content: body
          };
        }
        if (to) payload.toRecipients = toRecipients(to);
        if (cc) payload.ccRecipients = toRecipients(cc);
        if (bcc) payload.bccRecipients = toRecipients(bcc);
        const data = await graphRequest("PATCH", path, undefined, payload);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "outlook.send_draft",
    {
      message_id: z.string().min(1)
    },
    async ({ message_id }) => {
      try {
        const base = mailboxPath();
        const path = `${base}/messages/${encodeURIComponent(message_id)}/send`;
        const data = await graphRequest("POST", path, undefined, {});
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );
}
