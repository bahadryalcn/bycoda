import { expect, it } from "vitest";
import { CheckoutCache, CHECKOUT_CACHE_BYTES, CHECKOUT_CACHE_ENTRIES } from "./checkoutCache";

it("evicts least-recent idle checkout while retaining explicit owners", () => {
  const cache = new CheckoutCache<string, number>();
  const release = cache.retain("original");
  cache.set("original", 1);
  cache.set("recent", 2);
  for (let i = 0; i < CHECKOUT_CACHE_ENTRIES - 2; i++) cache.set(String(i), i);
  cache.get("recent");
  cache.set("replacement", 3);
  expect(cache.has("original")).toBe(true);
  expect(cache.has("recent")).toBe(true);
  expect(cache.has("0")).toBe(false);
  expect(cache.size).toBe(CHECKOUT_CACHE_ENTRIES);
  release();
});
it("counts Map payload bytes and drops oversized idle snapshots after release", () => {
  const cache = new CheckoutCache<string, Map<string, string>>();
  const release = cache.retain("active");
  const payload = new Map([["path", "x".repeat(CHECKOUT_CACHE_BYTES / 2 + 1)]]);
  cache.set("active", payload);
  expect(cache.get("active")).toBe(payload);
  release();
  expect(cache.has("active")).toBe(false);
  cache.set("idle", payload);
  expect(cache.has("idle")).toBe(false);
});
it("never evicts protected operation evidence to pretend the cache bound held", () => {
  const cache = new CheckoutCache<string, { pending: boolean }>((value) => value.pending);
  for (let i = 0; i <= CHECKOUT_CACHE_ENTRIES; i++) cache.set(String(i), { pending: true });
  expect(cache.size).toBe(CHECKOUT_CACHE_ENTRIES + 1);
  cache.get("0")!.pending = false;
  cache.prune();
  expect(cache.has("0")).toBe(false);
  expect(cache.size).toBe(CHECKOUT_CACHE_ENTRIES);
});
