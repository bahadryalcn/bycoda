export type RedactableSecret = { name: string; value: string };

const MIN_VALUE_LENGTH = 4;

/** Plain, base64, base64url and URL-encoded spellings of each value, longest first. */
function replacements(secrets: readonly RedactableSecret[]): [string, string][] {
  const seen = new Map<string, string>();
  for (const { name, value } of secrets) {
    if (value.length < MIN_VALUE_LENGTH) continue;
    const bytes = Buffer.from(value, "utf8");
    for (const form of [
      value,
      bytes.toString("base64"),
      bytes.toString("base64url"),
      encodeURIComponent(value),
    ]) {
      if (form.length >= MIN_VALUE_LENGTH && !seen.has(form)) seen.set(form, `[secret:${name}]`);
    }
  }
  return [...seen.entries()].sort((a, b) => b[0].length - a[0].length);
}

/** Returns a deep copy with every secret value (and its common encodings) replaced by
 * `[secret:<name>]`. The input is never mutated; non-string leaves are kept as they are. */
export function redactSecretValues<T>(value: T, secrets: readonly RedactableSecret[]): T {
  const pairs = replacements(secrets);
  if (!pairs.length) return value;
  const redactText = (text: string) => {
    let out = text;
    for (const [from, to] of pairs) if (out.includes(from)) out = out.split(from).join(to);
    return out;
  };
  const memo = new WeakMap<object, unknown>();
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return redactText(node);
    if (!node || typeof node !== "object") return node;
    if (memo.has(node)) return memo.get(node);
    if (Array.isArray(node)) {
      const copy: unknown[] = [];
      memo.set(node, copy);
      for (const item of node) copy.push(walk(item));
      return copy;
    }
    const proto = Object.getPrototypeOf(node);
    if (proto !== Object.prototype && proto !== null) return node;
    const copy: Record<string, unknown> = {};
    memo.set(node, copy);
    for (const [key, item] of Object.entries(node)) copy[key] = walk(item);
    return copy;
  };
  return walk(value) as T;
}
