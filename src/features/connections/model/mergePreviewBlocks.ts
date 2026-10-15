import { isEqual } from "es-toolkit";
import type { Block } from "../../sessions/model/session";

const indexes = new WeakMap<Block[], Map<string, number>>();
/** Preview deltas preserve durable text and reuse unchanged blocks/attachment data. */
export function mergePreviewBlocks(blocks: Block[], previews: Block[]): Block[] {
  let index = indexes.get(blocks);
  if (!index) {
    index = new Map(blocks.map((block, i) => [block.id, i]));
    indexes.set(blocks, index);
  }
  let next = blocks;
  for (const preview of previews) {
    const at = index.get(preview.id);
    if (at === undefined) continue;
    const block = next[at];
    const files = new Map((block.attachments ?? []).map((file) => [file.id, file]));
    for (const file of preview.attachments ?? [])
      files.set(file.id, files.get(file.id)?.data ? files.get(file.id)! : file);
    const attachments = files.size ? [...files.values()] : block.attachments;
    const image = block.image?.data ? block.image : (preview.image ?? block.image);
    if (isEqual(attachments, block.attachments) && isEqual(image, block.image)) continue;
    if (next === blocks) next = blocks.slice();
    next[at] = { ...block, attachments, image };
  }
  if (next !== blocks) indexes.set(next, index);
  return next;
}
