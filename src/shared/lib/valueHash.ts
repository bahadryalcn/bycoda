/** Small render signatures without serializing a complete object graph. */
export function valueHash(value: unknown): number {
  let hash = 2166136261;
  const text = (value: string) => {
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  };
  const visit = (value: unknown) => {
    text(typeof value);
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        text("[");
        for (const item of value) visit(item);
        text("]");
      } else
        for (const key of Object.keys(value)) {
          text(key);
          visit((value as Record<string, unknown>)[key]);
        }
    } else text(String(value));
    text("\0");
  };
  visit(value);
  return hash >>> 0;
}
