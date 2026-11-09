import type { SecondOpinionMeta } from "../../src/features/sessions/model/session";
import { isRemoteProvider } from "../../src/features/connections/model/protocol";

/** Validates the second opinion metadata a session command may carry. */
export function secondOpinionMeta(value: unknown): SecondOpinionMeta | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid second opinion metadata");
  const row = value as Record<string, unknown>;
  if (
    !isRemoteProvider(row.from) ||
    !isRemoteProvider(row.to) ||
    (row.kind !== undefined && row.kind !== "handoff") ||
    (row.request !== undefined && (typeof row.request !== "string" || row.request.length > 240)) ||
    (row.files !== undefined &&
      (!Number.isSafeInteger(row.files) || Number(row.files) < 0 || Number(row.files) > 40))
  )
    throw new Error("Invalid second opinion metadata");
  return {
    from: row.from,
    to: row.to,
    ...(row.request ? { request: row.request as string } : {}),
    ...(row.files !== undefined ? { files: Number(row.files) } : {}),
    ...(row.kind ? { kind: "handoff" as const } : {}),
  };
}
