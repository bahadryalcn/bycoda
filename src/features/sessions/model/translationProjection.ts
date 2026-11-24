import type { Block } from "./session";
import type { TranslationHistory } from "./translationHistory";
import { registerStreamingBlockUpdate, streamingBlockUpdate } from "./stableBlocks";

type Translation = TranslationHistory & { source: string; translatedVisible: boolean };
export type TranslationProjection = {
  source: Block[];
  translations: Readonly<Record<string, Translation>>;
  blocks: Block[];
};

/** Preserve streaming lineage through unchanged translation history. */
export function projectTranslatedBlocks(
  source: Block[],
  translations: TranslationProjection["translations"],
  previous?: TranslationProjection | null,
): Block[] {
  if (!Object.keys(translations).length) return source;
  const project = (block: Block): Block => {
    const entry = translations[block.id];
    if (!entry || entry.source !== block.text) return block;
    const text = entry.translatedVisible ? entry.translated : entry.original;
    return text === block.text ? block : { ...block, text };
  };
  const update =
    previous?.translations === translations
      ? streamingBlockUpdate(previous.source, source)
      : undefined;
  if (update && previous && previous.blocks.length === source.length && source[update.index]) {
    const blocks = [...previous.blocks];
    blocks[update.index] = project(source[update.index]);
    registerStreamingBlockUpdate(previous.blocks, blocks, update.index, update.kind);
    return blocks;
  }
  return source.map(project);
}
