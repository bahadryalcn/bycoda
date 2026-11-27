/** The Room and project a native owner request names. Display and navigation only. */
export type OwnerRequestSource = { threadId?: string; cwd?: string };

const text = (value: unknown, max: number) =>
  typeof value === "string" && value && value.length <= max ? value : undefined;

/** Keeps only well-formed source fields; a malformed one is dropped, never trusted. */
export function ownerRequestSource(payload: {
  threadId?: unknown;
  cwd?: unknown;
}): OwnerRequestSource {
  const threadId = text(payload.threadId, 200);
  const cwd = text(payload.cwd, 4096);
  return { ...(threadId ? { threadId } : {}), ...(cwd ? { cwd } : {}) };
}
