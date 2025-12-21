type AnyObj = Record<string, any>;

function getPath(obj: AnyObj, path: string): any {
  const parts = path.split(".").filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function renderString(template: string, ctx: AnyObj): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_m, key) => {
    const v = getPath(ctx, key);
    return v == null ? "" : String(v);
  });
}

export function renderTemplate<T>(value: T, ctx: AnyObj): T {
  if (typeof value === "string") return renderString(value, ctx) as any;
  if (Array.isArray(value)) return value.map((v) => renderTemplate(v, ctx)) as any;
  if (value && typeof value === "object") {
    const out: AnyObj = {};
    for (const [k, v] of Object.entries(value as AnyObj)) {
      out[k] = renderTemplate(v, ctx);
    }
    return out as any;
  }
  return value;
}
