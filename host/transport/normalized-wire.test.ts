import { expect, it, vi } from "vitest";
import { z } from "zod";
import { composeJsonWire, extendJsonWire, normalizeJsonField, normalizeJsonWire, readNormalizedJsonWire, type NormalizedJsonWire } from "./normalized-wire";

it("preserves both source and transformed actual toJSON boundaries with schema stripping", () => {
  const source = vi.fn((key: string) => ({ value: "kept", removed: "strip", sourceKey: key }));
  const initial = normalizeJsonWire({ toJSON: source });
  const output = vi.fn((key: string) => ({ key, value: "transformed" }));
  const schema = z.object({ value: z.string() }).transform((value) => ({ ...value, toJSON: output }));
  const parsed = schema.parse(readNormalizedJsonWire(initial).wire);
  const transformed = normalizeJsonField(parsed, "result");
  const envelope = readNormalizedJsonWire(composeJsonWire({ jsonrpc: "2.0", id: "typed" }, "result", transformed));
  expect(envelope.wire).toEqual({ jsonrpc: "2.0", id: "typed", result: { key: "result", value: "transformed" } });
  expect(JSON.parse(envelope.serialized)).toEqual(envelope.wire);
  expect(source).toHaveBeenCalledExactlyOnceWith("");
  expect(output).toHaveBeenCalledExactlyOnceWith("result");
});

it.each(["", "雪😀\\\"\n", "x".repeat(5000)])("composes exact bytes and UTF8 lengths for %s", (text) => {
  const payload = normalizeJsonWire({ text });
  const event = extendJsonWire(composeJsonWire({ kind: "snapshot" }, "data", payload), { subscriptionId: "sub" });
  const capture = readNormalizedJsonWire(composeJsonWire({ jsonrpc: "2.0", method: "subscription.event" }, "params", event));
  expect(capture.serialized).toBe(JSON.stringify(capture.wire));
  expect(capture.byteLength).toBe(Buffer.byteLength(capture.serialized));
});

it("rejects forged captures and duplicate metadata rather than trusting caller bytes", () => {
  expect(() => readNormalizedJsonWire({} as NormalizedJsonWire)).toThrow("Unknown normalized");
  expect(() => extendJsonWire(normalizeJsonWire({ id: "original" }), { id: "replacement" })).toThrow("Invalid normalized");
  expect(() => normalizeJsonField(undefined, "result")).toThrow("omitted");
});

it("captures a private wire copy before later source mutation", () => {
  const source = { nested: { value: "original" } };
  const capture = readNormalizedJsonWire(normalizeJsonWire(source));
  source.nested.value = "changed";
  expect(capture.wire).toEqual({ nested: { value: "original" } });
  expect(JSON.parse(capture.serialized)).toEqual(capture.wire);
});
