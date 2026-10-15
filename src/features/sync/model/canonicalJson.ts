function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] !== undefined) out[key] = sortKeys(source[key]);
  }
  return out;
}

/**
 * `JSON.stringify` with object keys sorted at every depth, so two values
 * that differ only in key order compare equal. Needed because the desktop's
 * transport (Rust `serde_json::Value`) re-serializes objects alphabetically.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? "null";
}

/** Canonical form of an already-serialized value; unparseable text is returned as is. */
export function canonicalizeJsonText(text: string): string {
  try {
    return canonicalJson(JSON.parse(text));
  } catch {
    return text;
  }
}
