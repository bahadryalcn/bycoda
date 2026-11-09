import { expect, it, vi } from "vitest";
import {
  copyNativeCaptureData,
  createNativeCaptureSnapshotEncoder,
  NativeCaptureJsonError,
  NATIVE_CAPTURE_JSON_LIMITS,
  stringifyNativeCaptureJson,
} from "./native-capture-json";

it("copies actual own undefined object members immutably without mutating prototypes", () => {
  const source = JSON.parse('{"__proto__":{"value":"kept"},"text":"  \\nç 😀 "}');
  source.attachment = { missing: undefined };
  const copy = copyNativeCaptureData(source);
  source.attachment.missing = "late";
  expect(copy.text).toBe("  \nç 😀 ");
  expect(Object.prototype.hasOwnProperty.call(copy.attachment, "missing")).toBe(true);
  expect(copy.attachment.missing).toBeUndefined();
  expect(copy.__proto__.value).toBe("kept");
  expect(Object.getPrototypeOf(copy)).toBeNull();
  expect(Object.isFrozen(copy.attachment)).toBe(true);
});

it("rejects accessors without invoking them and rejects cyclic, sparse or exotic data", () => {
  const getter = vi.fn(() => "secret");
  const accessor = Object.defineProperty({}, "text", { enumerable: true, get: getter });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const sparse: unknown[] = [];
  sparse.length = 2;
  for (const value of [
    accessor,
    cycle,
    new Date(),
    [undefined],
    sparse,
    { value: Symbol() },
    { value: Infinity },
    { text: "\ud800" },
  ])
    expect(() => copyNativeCaptureData(value)).toThrow(NativeCaptureJsonError);
  expect(getter).not.toHaveBeenCalled();
});

it("preserves JSON bytes and serializes presence paths outside opaque data", () => {
  const encode = createNativeCaptureSnapshotEncoder();
  const encoded = encode({ text: '"\\\t😀', item: { absent: undefined }, mode: undefined });
  expect(encoded.undefinedPaths).toEqual([["item", "absent"], ["mode"]]);
  expect(Object.prototype.hasOwnProperty.call(encoded.snapshot.item, "absent")).toBe(false);
  const json = stringifyNativeCaptureJson(encoded);
  expect(JSON.parse(json)).toEqual({
    snapshot: { text: '"\\\t😀', item: {} },
    undefinedPaths: [["item", "absent"], ["mode"]],
  });
  expect(() => stringifyNativeCaptureJson({ absent: undefined })).toThrow(NativeCaptureJsonError);
});

it("holds excessive depth, node count and output bytes before serialization", () => {
  let deep: unknown = "leaf";
  for (let depth = 0; depth < NATIVE_CAPTURE_JSON_LIMITS.depth + 1; depth++) deep = { child: deep };
  expect(() => copyNativeCaptureData(deep)).toThrow(NativeCaptureJsonError);
  expect(() =>
    stringifyNativeCaptureJson(
      Array.from({ length: NATIVE_CAPTURE_JSON_LIMITS.nodes + 1 }, () => 0),
    ),
  ).toThrow(NativeCaptureJsonError);
  expect(() => stringifyNativeCaptureJson("x".repeat(NATIVE_CAPTURE_JSON_LIMITS.bytes))).toThrow(
    NativeCaptureJsonError,
  );
});

it("holds negative zero instead of normalizing an opaque value to positive zero", () => {
  expect(() => copyNativeCaptureData({ value: -0 })).toThrow(NativeCaptureJsonError);
  expect(() => createNativeCaptureSnapshotEncoder()({ value: -0 })).toThrow(NativeCaptureJsonError);
  expect(() => stringifyNativeCaptureJson({ value: -0 })).toThrow(NativeCaptureJsonError);
  expect(stringifyNativeCaptureJson({ value: 0 })).toBe('{"value":0}');
});

it("charges large plain-ASCII (base64) strings like the exact per-character count", () => {
  const base64 = "QUJD".repeat(2_000);
  const quoted = `a"bc\n${"x".repeat(40)}`;
  expect(stringifyNativeCaptureJson({ data: base64, quoted })).toBe(
    JSON.stringify({ data: base64, quoted }),
  );
  expect(() => copyNativeCaptureData({ lone: `${"x".repeat(40)}\ud800` })).toThrow(
    NativeCaptureJsonError,
  );
});
