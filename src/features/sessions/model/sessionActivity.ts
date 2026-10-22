import type { Session } from "./session";

/** Latest submitted turn's start or completion, independent of read/focus state. */
export function sessionActivityAt(session: Session): number {
  let latest = 0;
  for (const block of session.blocks) {
    const { startedAt, durationMs } = block;
    if (
      block.role !== "user" ||
      block.draft ||
      typeof startedAt !== "number" ||
      !Number.isFinite(startedAt)
    )
      continue;
    const duration =
      typeof durationMs === "number" && Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    latest = Math.max(latest, startedAt + duration);
  }
  return latest;
}
