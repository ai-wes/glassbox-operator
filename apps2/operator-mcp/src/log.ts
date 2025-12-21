import pino from "pino";

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
    base: undefined
  },
  // IMPORTANT: MCP STDIO uses stdout; logs must go to stderr.
  pino.destination({ fd: 2 })
);
