/** Stable input for new Room facades. Existing management receipt hashes stay unchanged. */
export function roomOperationInput(input: Record<string, unknown>, operationId: string): Record<string, unknown> {
  const normalize = (value: unknown, depth: number): unknown => {
    if (depth > 32) throw new Error("Room operation input is too deeply nested.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(item => normalize(item, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, entry]) => [key, normalize(entry, depth + 1)]));
    throw new Error("Room operation input must contain JSON values.");
  };
  return normalize({ ...input, requestId: operationId }, 0) as Record<string, unknown>;
}
