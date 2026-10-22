import { expect, it } from "vitest";
import type { Block } from "../../sessions/model/session";
import { mergePreviewBlocks } from "./mergePreviewBlocks";
it("reuses unaffected rows and treats identical preview deltas as no change", () => {
  const first = { id: "a", role: "assistant", text: "durable" } as Block;
  const last = { id: "b", role: "assistant", text: "owner text" } as Block;
  const blocks = [first, last];
  expect(mergePreviewBlocks(blocks, [{ ...last, text: "preview must not overwrite text" }])).toBe(
    blocks,
  );
  const preview = { ...last, image: { data: "image data", mime: "image/png" } } as Block;
  const merged = mergePreviewBlocks(blocks, [preview]);
  expect(merged[0]).toBe(first);
  expect(merged[1].text).toBe("owner text");
  expect(merged[1].image?.data).toBe("image data");
  expect(mergePreviewBlocks(merged, [preview])).toBe(merged);
});
