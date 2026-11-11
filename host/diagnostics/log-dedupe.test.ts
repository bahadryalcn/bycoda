import { expect, it } from "vitest";
import { createDedupedWarn } from "./log-dedupe";

it("prints the first occurrence, suppresses identical repeats, and reports the count after the window", () => {
  let now = 0;
  const lines: string[] = [];
  const warn = createDedupedWarn({
    windowMs: 1000,
    now: () => now,
    write: (l) => lines.push(l),
  });
  warn("failed A");
  warn("failed A");
  warn("failed A");
  warn("failed B");
  expect(lines).toEqual(["failed A", "failed B"]);

  now = 1500;
  warn("failed A");
  expect(lines).toHaveLength(4);
  expect(lines[2]).toContain("2 identical warnings suppressed");
  expect(lines[3]).toBe("failed A");
});

it("bounds the number of remembered messages", () => {
  const lines: string[] = [];
  const warn = createDedupedWarn({
    maxKeys: 2,
    now: () => 0,
    write: (l) => lines.push(l),
  });
  warn("one");
  warn("two");
  warn("three");
  warn("one");
  expect(lines).toEqual(["one", "two", "three", "one"]);
});

it("prints a detail with the line without making it part of the identity", () => {
  const lines: string[] = [];
  const warn = createDedupedWarn({ now: () => 0, write: (l) => lines.push(l) });
  warn("read failed", "request=1");
  warn("read failed", "request=2");
  warn("read failed");
  expect(lines).toEqual(["read failed request=1"]);
});
