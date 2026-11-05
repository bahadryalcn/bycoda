import { expect, it } from "vitest";
import type { Block } from "./session";
import { registerStreamingTextUpdate, streamingTextUpdate } from "./stableBlocks";
import { projectTranslatedBlocks, type TranslationProjection } from "./translationProjection";
import { TranscriptTurnCache } from "./transcriptTurnCache";

it("keeps translated history and grouping cold while an unrelated reply streams", () => {
  let reads = 0;
  let source: Block[] = [
    { id: "u0", role: "user", text: "first" },
    {
      id: "a0",
      role: "assistant",
      get text() {
        reads++;
        return "original";
      },
    },
    { id: "u1", role: "user", text: "next" },
    { id: "a1", role: "assistant", text: "reply", streaming: true },
  ];
  const translations = {
    a0: {
      source: "original",
      original: "original",
      translated: "translated",
      translatedVisible: true,
    },
  };
  let blocks = projectTranslatedBlocks(source, translations);
  let previous: TranslationProjection = { source, translations, blocks };
  const cache = new TranscriptTurnCache();
  const history = cache.group(blocks)[0];
  const baseline = reads;
  for (let frame = 0; frame < 30; frame++) {
    const next = [...source];
    next[3] = { ...next[3], text: next[3].text + " more" };
    registerStreamingTextUpdate(source, next, 3);
    const updated = projectTranslatedBlocks(next, translations, previous);
    expect(streamingTextUpdate(blocks, updated)).toBe(3);
    expect(updated[1]).toBe(blocks[1]);
    expect(cache.group(updated)[0]).toBe(history);
    previous = { source: next, translations, blocks: updated };
    source = next;
    blocks = updated;
  }
  expect(reads).toBe(baseline);
});

it("rebuilds translated history for visibility changes and invalidates edited source", () => {
  const source: Block[] = [{ id: "a", role: "assistant", text: "original" }];
  const translations = {
    a: {
      source: "original",
      original: "original",
      translated: "translated",
      translatedVisible: true,
    },
  };
  const blocks = projectTranslatedBlocks(source, translations);
  const previous = { source, translations, blocks };
  const hidden = projectTranslatedBlocks(
    source,
    { a: { ...translations.a, translatedVisible: false } },
    previous,
  );
  expect(hidden[0].text).toBe("original");
  expect(streamingTextUpdate(blocks, hidden)).toBeUndefined();
  const edited = [{ ...source[0], text: "edited" }];
  expect(projectTranslatedBlocks(edited, translations, previous)[0]).toBe(edited[0]);
});
