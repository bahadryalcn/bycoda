import type { Block } from "./session";
import type { TranslationHistory } from "./translationHistory";
import { registerStreamingTextUpdate, streamingTextUpdate } from "./stableBlocks";

type Translation = TranslationHistory & { source: string; translatedVisible: boolean };
export type TranslationProjection = {
  source: Block[];
  translations: Readonly<Record<string, Translation>>;
  blocks: Block[];
};

/** Preserve text-only streaming lineage through unchanged translation history. */
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
  const index =
    previous?.translations === translations
      ? streamingTextUpdate(previous.source, source)
      : undefined;
  if (
    index !== undefined &&
    previous &&
    previous.blocks.length === source.length &&
    source[index]
  ) {
    const blocks = [...previous.blocks];
    blocks[index] = project(source[index]);
    registerStreamingTextUpdate(previous.blocks, blocks, index);
    return blocks;
  }
  return source.map(project);
}
