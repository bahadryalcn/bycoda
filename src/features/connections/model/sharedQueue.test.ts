import { expect, it } from "vitest";
import { canonicalJson } from "../../sync/model/canonicalJson";
import { mergeQueueChange, sameQueueValue, type SharedQueue } from "./sharedQueue";

const before = {
  messages: [
    {
      id: "one",
      text: "original",
      attachments: [],
      modelTarget: {
        harness: "claude" as const,
        model: "fixture",
        modelSettings: { z: "last", a: "first" },
      },
    },
  ],
  status: "paused" as const,
};
const transport = (value: unknown) => JSON.parse(canonicalJson(value));

it("compares nested JSON objects independently of transport key order", () => {
  expect(sameQueueValue(before, transport(before))).toBe(true);
});

it("merges an edit after a transport-only reordering without a conflict", () => {
  const current: SharedQueue = transport({ ...before, revision: 1 });
  const edited = { ...before.messages[0], text: "edited" };
  const after = { ...before, messages: [edited] };
  expect(mergeQueueChange(current, { before, after }).messages).toEqual([edited]);
});

it("accepts an already-applied retry after the transport reordered its keys", () => {
  const edited = { ...before.messages[0], text: "edited" };
  const after = { ...before, messages: [edited] };
  const current: SharedQueue = transport({ ...after, revision: 2 });
  expect(mergeQueueChange(current, { before, after }).messages).toEqual([edited]);
});

it("still rejects an actual competing edit", () => {
  const current: SharedQueue = transport({
    ...before,
    revision: 2,
    messages: [{ ...before.messages[0], text: "other edit" }],
  });
  const after = { ...before, messages: [{ ...before.messages[0], text: "my edit" }] };
  expect(() => mergeQueueChange(current, { before, after })).toThrow("changed on another computer");
});

it("preserves array order and distinguishes an absent value from null", () => {
  expect(sameQueueValue(["one", "two"], ["two", "one"])).toBe(false);
  expect(sameQueueValue(undefined, null)).toBe(false);
  expect(sameQueueValue(undefined, undefined)).toBe(true);
});
