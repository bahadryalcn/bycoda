import { expect, it, vi } from "vitest";
import { TranscriptRowCache } from "./transcriptRowCache";

it("retains row, block ids and callbacks only while all render inputs match", () => {
  const cache = new TranscriptRowCache();
  const block = { id: "answer", text: "settled" };
  const firstRender = () => block.text;
  const create = vi.fn(() => ({ id: block.id, blockIds: [block.id], render: firstRender }));
  const first = cache.row(block.id, [block, false, firstRender], create);
  expect(cache.row(block.id, [block, false, firstRender], create)).toBe(first);
  expect(create).toHaveBeenCalledTimes(1);
  const secondRender = () => "updated callback";
  const second = cache.row(block.id, [block, false, secondRender], () => ({
    ...first,
    render: secondRender,
  }));
  expect(second).not.toBe(first);
  expect(second.render()).toBe("updated callback");
  expect(cache.row(block.id, [block, true, secondRender], create)).not.toBe(second);
});

it("drops removed rows instead of retaining their blocks and render closures", () => {
  const cache = new TranscriptRowCache();
  const create = () => ({ id: "removed", blockIds: ["removed"], render: () => null });
  const first = cache.row("removed", [], create);
  cache.retain([first]);
  expect(cache.row("removed", [], create)).toBe(first);
  cache.retain([]);
  expect(cache.row("removed", [], create)).not.toBe(first);
});
