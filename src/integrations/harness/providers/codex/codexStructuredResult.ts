const MAX_RESULT_CHARS = 8_000;
const MAX_RESULT_NODES = 256;
const BINARY = "[Binary content omitted]";

/** A bounded data-only projection: no binary blocks, accessors, or toJSON execution. */
export function codexStructuredResultText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let remaining = MAX_RESULT_CHARS;
  let nodes = 0;
  let shortened = false;
  const ancestors = new WeakSet<object>();
  const text = (input: string): string => {
    const kept = input.slice(0, Math.max(0, remaining));
    remaining -= kept.length;
    if (kept.length !== input.length) shortened = true;
    return kept;
  };
  const visit = (input: unknown, depth: number): unknown => {
    if (++nodes > MAX_RESULT_NODES || depth > 10 || remaining <= 0) {
      shortened = true;
      return "…";
    }
    if (typeof input === "string") {
      if (/^data:(?:image|audio|video|application\/octet-stream)[/;,]/i.test(input)) return BINARY;
      return text(input);
    }
    if (input === null || typeof input === "number" || typeof input === "boolean") return input;
    if (typeof input !== "object") return undefined;
    if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return BINARY;
    if (ancestors.has(input)) return "[Circular]";
    const type = Object.getOwnPropertyDescriptor(input, "type")?.value;
    if (type === "image" || type === "audio" || type === "video") return BINARY;
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        const result: unknown[] = [];
        for (let index = 0; index < input.length; index++) {
          if (nodes >= MAX_RESULT_NODES || remaining <= 0) {
            shortened = true;
            break;
          }
          result.push(
            visit(Object.getOwnPropertyDescriptor(input, String(index))?.value, depth + 1),
          );
        }
        return result;
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const key in input) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !("value" in descriptor)) continue;
        if (nodes >= MAX_RESULT_NODES || remaining <= 0) {
          shortened = true;
          break;
        }
        const outputKey = text(key);
        const binary =
          /^(?:base64|blob|bytes|binary)$/i.test(key) ||
          (key === "data" &&
            typeof descriptor.value === "string" &&
            descriptor.value.length >= 64 &&
            /^[A-Za-z0-9+/]+={0,2}$/.test(descriptor.value));
        result[outputKey] = binary ? BINARY : visit(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      ancestors.delete(input);
    }
  };
  try {
    const serialized = JSON.stringify(visit(value, 0), null, 2);
    if (serialized === undefined) return undefined;
    if (!shortened && serialized.length <= MAX_RESULT_CHARS) return serialized;
    const suffix = "\n… [structured result shortened]";
    return serialized.slice(0, MAX_RESULT_CHARS - suffix.length) + suffix;
  } catch {
    return "[Structured result could not be displayed]";
  }
}
