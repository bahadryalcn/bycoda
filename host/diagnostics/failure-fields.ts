import { createHash } from "node:crypto";
import type { DiagnosticLogFields } from "@bycoda/account-contracts";

const FIELD_LIMIT = 64;

/**
 * Log fields for an unexpected failure whose message is not known to be safe. Messages can hold
 * paths, prompts or SQL text, so the message itself is never logged: identical failures share a
 * fingerprint of it, which correlates them without the text. `code` and `syscall` are bounded
 * short identifiers (for example `EADDRINUSE` and `listen`).
 */
export function failureFields(error: unknown): DiagnosticLogFields {
  const detail = (error ?? {}) as { code?: unknown; syscall?: unknown };
  const isError = error instanceof Error;
  const text = isError ? error.message : undefined;
  return {
    error: isError ? error.name.slice(0, FIELD_LIMIT) : typeof error,
    code: boundedField(detail.code),
    syscall: typeof detail.syscall === "string" ? detail.syscall.slice(0, FIELD_LIMIT) : undefined,
    fingerprint:
      text === undefined ? undefined : createHash("sha256").update(text).digest("hex").slice(0, 12),
  };
}

function boundedField(value: unknown): string | number | undefined {
  if (typeof value === "number") return value;
  return typeof value === "string" ? value.slice(0, FIELD_LIMIT) : undefined;
}
