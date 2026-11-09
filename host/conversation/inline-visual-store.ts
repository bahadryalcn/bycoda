import { createHash } from "node:crypto";
import { join } from "node:path";
import { writeFileAtomic } from "../storage/atomic-write";
import {
  type InlineVisualRef,
  type InlineVisualSource,
} from "../../src/features/sessions/model/inlineVisual";

/** Desktop reads the same folder by id (src-tauri/src/inline_visual.rs). */
export const INLINE_VISUAL_DIRECTORY = "inline-visuals";

/**
 * Content-addressed and immutable: the same source maps to the same file, so a
 * rewrite never changes what an earlier transcript shows.
 * shortcut: files are never pruned; add retention tied to session deletion if
 * the folder grows large in practice.
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
