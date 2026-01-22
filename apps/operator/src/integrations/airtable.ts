import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonRequest } from "./http.js";

function toText(obj: any) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

function airtableBase() {
  return (process.env.AIRTABLE_BASE_URL || "https://api.airtable.com/v0").replace(/\/+$/, "");
}

function airtableToken() {
  const token = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY || "";
  if (!token) throw new Error("Missing required env: AIRTABLE_TOKEN (or AIRTABLE_API_KEY)");
  return token;
}

async function airtableRequest(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, query?: any, body?: any) {
  const headers = {
    Authorization: `Bearer ${airtableToken()}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  return await jsonRequest({
    method,
    url: `${airtableBase()}${path}`,
    headers,
    query,
    body,
    timeoutMs: 30000
  });
}

export function registerAirtableTools(server: McpServer) {
  server.tool("airtable.list_bases", {}, async () => {
    try {
      const data = await airtableRequest("GET", "/meta/bases");
      return toText({ ok: true, data });
    } catch (err: any) {
      return toText({ ok: false, error: err?.message || String(err) });
    }
  });

  server.tool(
    "airtable.list_tables",
    { base_id: z.string().min(1) },
    async ({ base_id }) => {
      try {
        const data = await airtableRequest("GET", `/meta/bases/${encodeURIComponent(base_id)}/tables`);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "airtable.list_records",
    {
      base_id: z.string().min(1),
      table: z.string().min(1),
      view: z.string().optional(),
      filter: z.string().optional(),
      fields: z.array(z.string()).optional(),
      max_records: z.number().int().min(1).max(1000).optional(),
      page_size: z.number().int().min(1).max(100).optional(),
      offset: z.string().optional(),
      sort: z.array(z.object({ field: z.string(), direction: z.enum(["asc", "desc"]).optional() })).optional()
    },
    async ({ base_id, table, view, filter, fields, max_records, page_size, offset, sort }) => {
      try {
        const query: Record<string, any> = {};
        if (view) query.view = view;
        if (filter) query.filterByFormula = filter;
        if (fields?.length) query.fields = fields;
        if (max_records) query.maxRecords = max_records;
        if (page_size) query.pageSize = page_size;
        if (offset) query.offset = offset;
        if (sort?.length) {
          sort.forEach((s, i) => {
            query[`sort[${i}][field]`] = s.field;
            if (s.direction) query[`sort[${i}][direction]`] = s.direction;
          });
        }
        const path = `/${encodeURIComponent(base_id)}/${encodeURIComponent(table)}`;
        const data = await airtableRequest("GET", path, query);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "airtable.get_record",
    {
      base_id: z.string().min(1),
      table: z.string().min(1),
      record_id: z.string().min(1)
    },
    async ({ base_id, table, record_id }) => {
      try {
        const path = `/${encodeURIComponent(base_id)}/${encodeURIComponent(table)}/${encodeURIComponent(record_id)}`;
        const data = await airtableRequest("GET", path);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "airtable.create_record",
    {
      base_id: z.string().min(1),
      table: z.string().min(1),
      fields: z.record(z.any()),
      typecast: z.boolean().optional()
    },
    async ({ base_id, table, fields, typecast }) => {
      try {
        const path = `/${encodeURIComponent(base_id)}/${encodeURIComponent(table)}`;
        const body: any = { records: [{ fields }] };
        if (typecast !== undefined) body.typecast = typecast;
        const data = await airtableRequest("POST", path, undefined, body);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "airtable.update_record",
    {
      base_id: z.string().min(1),
      table: z.string().min(1),
      record_id: z.string().min(1),
      fields: z.record(z.any()),
      typecast: z.boolean().optional()
    },
    async ({ base_id, table, record_id, fields, typecast }) => {
      try {
        const path = `/${encodeURIComponent(base_id)}/${encodeURIComponent(table)}/${encodeURIComponent(record_id)}`;
        const body: any = { fields };
        if (typecast !== undefined) body.typecast = typecast;
        const data = await airtableRequest("PATCH", path, undefined, body);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );

  server.tool(
    "airtable.upsert_record",
    {
      base_id: z.string().min(1),
      table: z.string().min(1),
      fields: z.record(z.any()),
      fields_to_merge_on: z.array(z.string()).min(1),
      typecast: z.boolean().optional()
    },
    async ({ base_id, table, fields, fields_to_merge_on, typecast }) => {
      try {
        const path = `/${encodeURIComponent(base_id)}/${encodeURIComponent(table)}`;
        const body: any = {
          records: [{ fields }],
          performUpsert: { fieldsToMergeOn: fields_to_merge_on }
        };
        if (typecast !== undefined) body.typecast = typecast;
        const data = await airtableRequest("PATCH", path, undefined, body);
        return toText({ ok: true, data });
      } catch (err: any) {
        return toText({ ok: false, error: err?.message || String(err) });
      }
    }
  );
}
