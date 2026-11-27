import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { INLINE_VISUAL_ID } from "../../src/features/sessions/model/inlineVisual";
import { INLINE_VISUAL_DIRECTORY } from "./inline-visual-store";

/** A file this young may belong to a write whose transcript block is not saved yet. */
export const INLINE_VISUAL_RECLAIM_GRACE_MS = 60 * 60 * 1000;

type VisualBearing = { blocks: readonly { inlineVisual?: unknown }[] };

/** Store-backed visual ids a session references. Legacy v1 snapshots carry no file. */
export function inlineVisualIds(session: VisualBearing): string[] {
  const ids = new Set<string>();
  for (const block of session.blocks) {
    const visual = block.inlineVisual as { version?: unknown; id?: unknown } | undefined;
    if (visual?.version === 2 && typeof visual.id === "string" && INLINE_VISUAL_ID.test(visual.id))
      ids.add(visual.id);
  }
  return [...ids];
}

/**
 * Removes the deleted session's visual files that no remaining session references.
 * A file stays when any remaining session (archived ones included) references it, or
 * when it is still inside the grace window.
 */
export async function reclaimDeletedInlineVisuals(input: {
  dataDir: string;
  deletedIds: readonly string[];
  remaining: readonly VisualBearing[];
  now?: number;
}): Promise<{ removed: string[]; retained: string[] }> {
  const referenced = new Set(input.remaining.flatMap(inlineVisualIds));
  const now = input.now ?? Date.now();
  const removed: string[] = [];
  const retained: string[] = [];
  for (const id of new Set(input.deletedIds)) {
    if (referenced.has(id)) {
      retained.push(id);
      continue;
    }
    const path = join(input.dataDir, INLINE_VISUAL_DIRECTORY, `${id}.json`);
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) continue;
    if (info.mtimeMs > now - INLINE_VISUAL_RECLAIM_GRACE_MS) {
      retained.push(id);
      continue;
    }
    await rm(path, { force: true });
    removed.push(id);
  }
  return { removed, retained };
}

/**
 * Runs only after a successful permanent delete. A failed scan of the remaining
 * sessions removes nothing, because ownership would then be unproven.
 * shortcut: scans every session per delete; add a reference index if deletes get slow.
 */
export async function retireDeletedSessionVisuals(
  store: { sessions(): Promise<{ session: VisualBearing }[]> },
  dataDir: string,
  deletedIds: readonly string[],
): Promise<{ removed: string[]; retained: string[] }> {
  if (deletedIds.length === 0) return { removed: [], retained: [] };
  const remaining = (await store.sessions()).map((item) => item.session);
  return reclaimDeletedInlineVisuals({ dataDir, deletedIds, remaining });
}
