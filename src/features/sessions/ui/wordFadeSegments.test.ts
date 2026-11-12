import { expect, it, vi } from "vitest";
import { WordFadeSegments } from "./wordFadeSegments";

it("matches full splitting across partial words, whitespace and replacements", () => {
  const cache = new WordFadeSegments();
  for (const text of [
    "hel",
    "hello",
    "hello ",
    "hello \n\t",
    "hello \n\tworld",
    "hello \n\tworld\u00a0",
    "hello \n\tworld\u00a0 ",
    "hello \n\tworld\u00a0 x",
    "replacement",
    "",
    "🙂! e\u0301",
  ]) {
    const result = cache.update(text);
    expect(result.parts.map(({ start, end }) => text.slice(start, end))).toEqual(
      text.split(/(\s+)/).filter(Boolean),
    );
    expect(result.words.map(({ start, end }) => text.slice(start, end))).toEqual(
      text.split(/(\s+)/).filter((part) => part && ![32, 10, 9, 13].includes(part.charCodeAt(0))),
    );
    expect(result.count).toBe((text.match(/[^ \n\t\r]+/g) ?? []).length);
  }
});

it("splits only the delta of a long text, including an unfinished word", () => {
  const cache = new WordFadeSegments();
  const text = "word ".repeat(10000) + "x".repeat(10000);
  cache.update(text);
  const split = vi.spyOn(String.prototype, "split");
  try {
    cache.update(text + "tail more");
    cache.update(text + "tail more");
    expect(split).toHaveBeenCalledTimes(1);
    expect(String(split.mock.contexts[0])).toBe("tail more");
  } finally {
    split.mockRestore();
  }
});
