export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

function ts(): string {
  return new Date().toISOString();
}

function write(level: LogLevel, name: string, args: unknown[]) {
  // Important: stderr so we don't corrupt stdio transports if used later.
  const line = `[${ts()}] [${level.toUpperCase()}] [${name}] ${args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ")}`;
  // eslint-disable-next-line no-console
  console.error(line);
}

export function createLogger(name: string): Logger {
  return {
    debug: (...args) => write("debug", name, args),
    info: (...args) => write("info", name, args),
    warn: (...args) => write("warn", name, args),
    error: (...args) => write("error", name, args)
  };
}
