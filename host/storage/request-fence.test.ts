import { expect, it } from "vitest";
import { RetiredRequestFence } from "./request-fence";

it("retains every retired identity after more than the former receipt limit", () => {
  const fence = new RetiredRequestFence();
  const keys = Array.from({ length: 10_000 }, (_, index) =>
    JSON.stringify(["owner", "project", index]),
  );
  for (const key of keys) fence.add(key);
  for (const key of keys) expect(fence.has(key)).toBe(true);
  expect(fence.saturated).toBe(false);
});

it("does not reset prior identities when its bounded storage saturates", () => {
  const fence = new RetiredRequestFence(16);
  const keys: string[] = [];
  for (let index = 0; index < 100; index++) {
    const key = `retired-${index}`;
    keys.push(key);
    fence.add(key);
  }
  expect(fence.saturated).toBe(true);
  for (const key of keys) expect(fence.has(key)).toBe(true);
  for (const key of keys) fence.add(key);
  expect(fence.saturated).toBe(true);
});

it("can conservatively match a different ID, so callers must reject matches", () => {
  const fence = new RetiredRequestFence(1);
  fence.add("retired");
  const collision = Array.from({ length: 1000 }, (_, index) => `other-${index}`).find((key) =>
    fence.has(key),
  );
  expect(collision).toBeDefined();
  expect(fence.has("retired")).toBe(true);
});

it.each([0, -1, 1.5, Number.NaN, 1024 * 1024 + 1])(
  "rejects unbounded or invalid storage size %s",
  (size) => {
    expect(() => new RetiredRequestFence(size)).toThrow("Invalid retired request fence size");
  },
);
