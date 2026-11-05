import { expect, it } from "vitest";
import {
  BackgroundEffectCache,
  BACKGROUND_SOURCE_BYTES,
  BACKGROUND_MAX_EDGE,
} from "./backgroundEffectCache";

it("bounds actual pixel bytes across projects sharing one image revision", () => {
  const cache = new BackgroundEffectCache<Uint8Array>(64, (value) => value.byteLength);
  for (let i = 0; i < 200; i++) cache.set(`/project-${i}?v=1`, new Uint8Array(16));
  expect(cache.retainedBytes).toBe(64);
  expect([...cache.keys()]).toHaveLength(4);
  expect(cache.get("/project-0?v=1")).toBeUndefined();
  expect(cache.get("/project-199?v=1")).toHaveLength(16);
  expect(BACKGROUND_SOURCE_BYTES).toBe(3 * BACKGROUND_MAX_EDGE ** 2 * 5);
});
it("uses access recency and releases cache references without destroying current owners", () => {
  const cache = new BackgroundEffectCache<Uint8Array>(8, (value) => value.byteLength);
  const current = new Uint8Array([1, 2, 3, 4]);
  cache.set("current", current);
  cache.set("other", new Uint8Array(4));
  cache.get("current");
  cache.set("new", new Uint8Array(4));
  expect(cache.get("other")).toBeUndefined();
  cache.clear();
  expect(cache.retainedBytes).toBe(0);
  expect([...current]).toEqual([1, 2, 3, 4]);
});
it("also bounds metadata for tiny completed images", () => {
  const cache = new BackgroundEffectCache<Blob>(1024, (blob) => blob.size);
  for (let i = 0; i < 1000; i++) cache.set(String(i), new Blob());
  expect([...cache.keys()]).toHaveLength(96);
});
