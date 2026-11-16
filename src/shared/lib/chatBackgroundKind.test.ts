import { expect, it } from "vitest";
import { chatBackgroundKind } from "./chatBackgroundKind";

it.each([
  ["/a.JPG", "image"],
  ["C:\\scene.HTML", "html"],
  ["/b.htm?v=2", "html"],
  ["/b.WEBM", "video"],
  ["/b.mp4#x", "video"],
  [null, "image"],
] as const)("classifies %s", (path, kind) => {
  expect(chatBackgroundKind(path)).toBe(kind);
});
