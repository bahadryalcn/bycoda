import { createHash } from "node:crypto";
import { truncateGraphemes } from "../../../src/shared/lib/text/truncate";

export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const UNASSIGNED_REVIEW =
  "Multiple/no project matches. Assign this conversation before replying.";

export function str(value: unknown, field: string, maximum = 20000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || value.includes("\0"))
    throw new Error(`Invalid ${field}.`);
  return value.trim();
}
export function array(value: unknown, field: string, maximum = 100): string[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Invalid ${field}.`);
  return [...new Set(value.map((item) => str(item, field, 300)))];
}
export function url(value: unknown, field: string): string {
  const parsed = new URL(str(value, field, 2048));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    throw new Error(`Use an HTTPS ${field} without credentials.`);
  return parsed.toString();
}
export function finite(
  value: unknown,
  field: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error(`Invalid ${field}.`);
  return value;
}
export function exact(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("Unknown or protected social field.");
}

/** Keeps logs and startup errors free of credential-looking text. */
export function sanitizeSocialError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateGraphemes(
    message
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(
        /\b(access[_-]?token|refresh[_-]?token|token|secret|password|cookie|authorization)\b\s*[=:]\s*\S+/gi,
        "$1=[redacted]",
      )
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]"),
    300,
  );
}
