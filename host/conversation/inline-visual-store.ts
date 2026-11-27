import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";
import {
  INLINE_VISUAL_ID,
  inlineVisualSource,
  type InlineVisualRef,
  type InlineVisualSource,
} from "../../src/features/sessions/model/inlineVisual";

/** Desktop reads the same folder by id (src-tauri/src/inline_visual.rs). */
export const INLINE_VISUAL_DIRECTORY = "inline-visuals";

/**
 * Content-addressed and immutable: the same source maps to the same file, so a
 * rewrite never changes what an earlier transcript shows.
 * shortcut: a file is reclaimed only when its session is permanently deleted
 * (inline-visual-retention.ts); orphans from crashed writes are never pruned.
 */
export async function storeInlineVisual(
  dataDir: string,
  source: InlineVisualSource,
): Promise<InlineVisualRef> {
  const body = JSON.stringify({ version: 1, ...source });
  const id = createHash("sha256").update(body).digest("hex");
  await writeFileAtomic(join(dataDir, INLINE_VISUAL_DIRECTORY, `${id}.json`), body);
  return { version: 2, id, title: source.title, height: source.height };
}

export async function readInlineVisual(dataDir: string, id: string): Promise<InlineVisualSource> {
  if (!INLINE_VISUAL_ID.test(id)) throw new Error("Invalid visual id");
  const path = join(dataDir, INLINE_VISUAL_DIRECTORY, `${id}.json`);
  const file = await stat(path);
  if (!file.isFile() || file.size > 4 * 1024 * 1024) throw new Error("Invalid visual file");
  const source = await readStateFile(
    path,
    (body) => {
      if (createHash("sha256").update(body).digest("hex") !== id)
        throw new Error("Visual content does not match its id");
      const visual = inlineVisualSource(JSON.parse(body));
      if (!visual) throw new Error("Invalid stored visual");
      return visual;
    },
    { quarantine: false },
  );
  if (source.status !== "ok") throw new Error("Stored visual is unavailable");
  return source.value;
}
