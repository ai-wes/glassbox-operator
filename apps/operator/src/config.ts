import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ActionMap, UpstreamConfig } from "./upstreams/types.js";

const UpstreamTransportSchema = z.union([
  z.object({
    type: z.literal("streamable_http"),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
    readonly: z.boolean().optional()
  }),
  z.object({
    type: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional()
  })
]);

const UpstreamConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  cluster: z.union([z.literal("revops"), z.literal("engops")]),
  allowWrite: z.boolean().optional(),
  transport: UpstreamTransportSchema
});

const ActionSpecSchema = z.object({
  upstream_id: z.string().min(1),
  tool: z.string().min(1),
  args_template: z.any(),
  mutating: z.boolean().optional()
});

const ActionMapSchema = z
  .object({
    revops: z.record(ActionSpecSchema).optional(),
    engops: z.record(ActionSpecSchema).optional()
  })
  .passthrough();

function readJsonFile(p: string): any {
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw);
}

export function loadConfig() {
  const host = process.env.OPERATOR_HOST || "0.0.0.0";
  const port = Number(process.env.OPERATOR_PORT || "8090");
  const apiKey = process.env.OPERATOR_API_KEY || undefined;

  // global gate: if 0, no mutating calls are allowed (even with confirm_write)
  const allowWriteGlobal = (process.env.OPERATOR_ALLOW_WRITE || "0") === "1";

  const upstreamsPath = process.env.OPERATOR_UPSTREAMS_PATH || "";
  const upstreamsJson = process.env.OPERATOR_UPSTREAMS_JSON || "";

  let upstreams: UpstreamConfig[] = [];
  if (upstreamsJson) {
    upstreams = z.array(UpstreamConfigSchema).parse(JSON.parse(upstreamsJson));
  } else if (upstreamsPath) {
    upstreams = z.array(UpstreamConfigSchema).parse(readJsonFile(upstreamsPath));
  } else {
    throw new Error("Provide OPERATOR_UPSTREAMS_JSON or OPERATOR_UPSTREAMS_PATH");
  }

  const actionMapPath = process.env.OPERATOR_ACTION_MAP_PATH || "";
  const actionMapJson = process.env.OPERATOR_ACTION_MAP_JSON || "";
  let actionMap: ActionMap | null = null;

  if (actionMapJson) actionMap = ActionMapSchema.parse(JSON.parse(actionMapJson)) as any;
  else if (actionMapPath && fs.existsSync(actionMapPath)) {
    actionMap = ActionMapSchema.parse(readJsonFile(actionMapPath)) as any;
  }

  // Ensure data dir exists
  const dataDir = path.resolve(process.cwd(), ".data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  return {
    host,
    port,
    apiKey,
    allowWriteGlobal,
    upstreams,
    actionMap
  };
}
