import { z } from "zod";

const EnvSchema = z.object({
  GLASSBOX_MCP_HOST: z.string().default("0.0.0.0"),
  GLASSBOX_MCP_PORT: z.string().default("8091"),

  GLASSBOX_API_BASE_URL: z.string().url(),

  GLASSBOX_BEARER_TOKEN: z.string().optional(),
  GLASSBOX_INTERNAL_API_KEY: z.string().optional(),

  GLASSBOX_HTTP_TIMEOUT_MS: z.string().optional().default("45000")
});

export function loadConfig() {
  const env = EnvSchema.parse(process.env);
  return {
    host: env.GLASSBOX_MCP_HOST,
    port: Number(env.GLASSBOX_MCP_PORT),
    baseUrl: env.GLASSBOX_API_BASE_URL.replace(/\/+$/, ""),
    bearer: env.GLASSBOX_BEARER_TOKEN,
    internalKey: env.GLASSBOX_INTERNAL_API_KEY,
    timeoutMs: Number(env.GLASSBOX_HTTP_TIMEOUT_MS)
  };
}
