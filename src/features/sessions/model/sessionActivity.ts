import type { Block, Session } from "./session";

// Block arrays are immutable snapshots, so the scan rides on the array identity
// instead of walking every block on each tool event of a long session.
const activityByBlocks = new WeakMap<Block[], number>();

/** Latest submitted turn's start or completion, independent of read/focus state. */
export function sessionActivityAt(session: Session): number {
  const cached = activityByBlocks.get(session.blocks);
  if (cached !== undefined) return cached;
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
  activityByBlocks.set(session.blocks, latest);
  return latest;
}
