import { expect, it } from "vitest";
import { createAnnotationDraftCache } from "./annotationDraftCache";

const draft = (chars: number) => ({ frame: { base64: "x".repeat(chars) } });
const drafts = (chars: number, id = "device") => ({ [id]: draft(chars) });

it("evicts the least recently written scope past the scope limit", () => {
  const cache = createAnnotationDraftCache({ maxScopes: 2, maxFrameChars: 1000 });
  cache.set("a", drafts(1));
  cache.set("b", drafts(1));
  cache.set("a", drafts(2));
  cache.set("c", drafts(1));
  expect(cache.scopes()).toEqual(["a", "c"]);
  expect(cache.get("b")).toBeUndefined();
});

it("evicts old scopes until the summed screenshot size fits", () => {
  const cache = createAnnotationDraftCache({ maxScopes: 10, maxFrameChars: 10 });
  cache.set("a", { one: draft(4), two: draft(4) });
  cache.set("b", drafts(4));
  expect(cache.scopes()).toEqual(["b"]);
});

it("keeps the scope just written even when it alone exceeds the budget", () => {
  const cache = createAnnotationDraftCache({ maxScopes: 1, maxFrameChars: 5 });
  cache.set("old", drafts(1));
  cache.set("big", drafts(50));
  expect(cache.scopes()).toEqual(["big"]);
});

it("never evicts a scope a mounted panel pinned, until it is released", () => {
  const cache = createAnnotationDraftCache({ maxScopes: 1, maxFrameChars: 1000 });
  cache.set("active", drafts(1));
  const release = cache.pin("active");
  cache.set("other", drafts(1));
  cache.set("third", drafts(1));
  expect(cache.scopes()).toContain("active");
  expect(cache.scopes()).not.toContain("other");
  release();
  cache.set("fourth", drafts(1));
  expect(cache.scopes()).toEqual(["fourth"]);
});

it("keeps a scope pinned by two panels until both release it", () => {
  const cache = createAnnotationDraftCache({ maxScopes: 1, maxFrameChars: 1000 });
  cache.set("shared", drafts(1));
  const first = cache.pin("shared");
  const second = cache.pin("shared");
  first();
  cache.set("other", drafts(1));
  expect(cache.scopes()).toContain("shared");
  second();
  cache.set("last", drafts(1));
  expect(cache.scopes()).toEqual(["last"]);
});

it("keeps conversation and machine scopes apart and never merges their devices", () => {
  const cache = createAnnotationDraftCache({ maxScopes: 8, maxFrameChars: 1000 });
  cache.set("machine-1:conversation-1", drafts(1, "phone"));
  cache.set("machine-2:conversation-1", drafts(1, "tablet"));
  expect(Object.keys(cache.get("machine-1:conversation-1")!)).toEqual(["phone"]);
  expect(Object.keys(cache.get("machine-2:conversation-1")!)).toEqual(["tablet"]);
  expect(cache.get("machine-3:conversation-1")).toBeUndefined();
});

it("removes a scope when its drafts are cleared or deleted", () => {
  const cache = createAnnotationDraftCache({ maxScopes: 8, maxFrameChars: 1000 });
  cache.set("a", drafts(1));
  cache.set("a", {});
  expect(cache.get("a")).toBeUndefined();
  cache.set("b", drafts(1));
  cache.delete("b");
  expect(cache.scopes()).toEqual([]);
});
