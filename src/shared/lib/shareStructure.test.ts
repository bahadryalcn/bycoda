import { expect, it } from "vitest";
import { shareStructure } from "./shareStructure";

it("returns the previous object when nothing differs", () => {
  const previous = { a: [{ id: "1", n: 1 }], b: { c: "x" } };
  expect(shareStructure(previous, structuredClone(previous))).toBe(previous);
});

it("keeps unchanged siblings and replaces only the changed path", () => {
  const previous = {
    jobs: [
      { id: "a", state: "running" },
      { id: "b", state: "done" },
    ],
    notes: [{ id: "n", text: "hi" }],
  };
  const next = structuredClone(previous);
  next.jobs[0]!.state = "done";
  const shared = shareStructure(previous, next);
  expect(shared).not.toBe(previous);
  expect(shared.jobs).not.toBe(previous.jobs);
  expect(shared.jobs[0]).toEqual({ id: "a", state: "done" });
  expect(shared.jobs[1]).toBe(previous.jobs[1]);
  expect(shared.notes).toBe(previous.notes);
});

it("matches id arrays by id when an entry is prepended or removed", () => {
  const previous = [
    { id: "a", v: 1 },
    { id: "b", v: 2 },
  ];
  const prepended = shareStructure(previous, [{ id: "z", v: 0 }, ...structuredClone(previous)]);
  expect(prepended).toHaveLength(3);
  expect(prepended[1]).toBe(previous[0]);
  expect(prepended[2]).toBe(previous[1]);
  const removed = shareStructure(previous, [structuredClone(previous[1]!)]);
  expect(removed).toHaveLength(1);
  expect(removed[0]).toBe(previous[1]);
});

it("reports exact differences: removed, added and undefined keys, type changes, order", () => {
  const previous = { a: 1, b: 2 };
  expect(shareStructure(previous, { a: 1 })).toEqual({ a: 1 });
  expect(shareStructure(previous, { a: 1 })).not.toBe(previous);
  const withUndefined = shareStructure({ a: 1 }, { a: 1, b: undefined });
  expect(Object.keys(withUndefined)).toEqual(["a", "b"]);
  expect(shareStructure({ a: [1] }, { a: { 0: 1 } })).toEqual({ a: { 0: 1 } });
  expect(shareStructure([1, 2], [2, 1])).toEqual([2, 1]);
  expect(shareStructure(null, { a: 1 })).toEqual({ a: 1 });
  expect(shareStructure({ a: 1 }, { a: null })).toEqual({ a: null });
  expect(shareStructure({ a: NaN }, { a: NaN })).toEqual({ a: NaN });
});
