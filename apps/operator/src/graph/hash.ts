import { createHash } from "node:crypto";

export function sha256Json(x: unknown): string {
  const s = JSON.stringify(x);
  return createHash("sha256").update(s).digest("hex");
}

export function sha256Text(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
