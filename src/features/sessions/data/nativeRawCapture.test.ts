import { expect, it, vi } from "vitest";
import { encodeNativeRawCapture, NATIVE_RAW_CAPTURE_LIMITS } from "./nativeRawCapture";

const snapshot = (text = "") => ({ text, attachments: [] as unknown[], mcpTags: [] as unknown[] });
const entry = (id = 1, text = "") => ({
  id,
  revision: 0,
  sessionId: "session",
  snapshot: snapshot(text),
});
const capture = (snapshots: unknown[] = [entry()]) => ({
  qualified: false,
  snapshots,
  missingCoverage: ["provider-output"],
});

it("retains exact empty and whitespace mounts, opaque metadata and absent versus save mode", () => {
  const first = entry(),
    second = entry(2, " \n\t😀");
  const opaque = {
    nested: [null, false, 0, "Türkçe", { arbitrary: "value" }],
    constructor: "data",
  };
  second.snapshot.attachments.push(opaque);
  second.snapshot.mcpTags.push({ server: { unknownKey: [true] } });
  const withMode = { ...second, snapshot: { ...second.snapshot, mode: "save" } };
  const raw = encodeNativeRawCapture("session", capture([first, withMode]));
  const decoded = JSON.parse(raw);
  expect(decoded).toEqual({
    version: 1,
    kind: "mounted-composer-raw-capture",
    qualified: false,
    sessionId: "session",
    snapshots: [first, withMode],
  });
  expect(Object.hasOwn(decoded.snapshots[0].snapshot, "mode")).toBe(false);
  opaque.nested[0] = "later";
  expect(JSON.parse(raw).snapshots[1].snapshot.attachments[0].nested[0]).toBeNull();
});

it("keeps an honestly empty roster and unassigned mounted data explicit", () => {
  expect(JSON.parse(encodeNativeRawCapture("session", capture([]))).snapshots).toEqual([]);
  const { sessionId: _session, ...unassigned } = entry();
  expect(JSON.parse(encodeNativeRawCapture("session", capture([unassigned]))).snapshots).toEqual([
    unassigned,
  ]);
  expect(() =>
    encodeNativeRawCapture("session", { qualified: false, missingCoverage: [] }),
  ).toThrow("capture-unavailable");
  expect(() =>
    encodeNativeRawCapture("session", { qualified: true, snapshots: [], missingCoverage: [] }),
  ).toThrow("capture-unavailable");
});

it("retains own undefined object-member presence outside opaque user data without changing array semantics", () => {
  const next = entry();
  const optional = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(optional, "__proto__", { value: undefined, enumerable: true });
  optional.missing = undefined;
  optional.undefinedPaths = "opaque user key";
  next.snapshot.attachments = [optional];
  next.snapshot.mcpTags = [{ server: { enabled: undefined, nested: { optional: undefined } } }];
  const raw = encodeNativeRawCapture("session", capture([next]));
  const retained = JSON.parse(raw).snapshots[0];
  expect(retained.undefinedPaths).toEqual([
    ["attachments", 0, "__proto__"],
    ["attachments", 0, "missing"],
    ["mcpTags", 0, "server", "enabled"],
    ["mcpTags", 0, "server", "nested", "optional"],
  ]);
  expect(retained.snapshot.attachments[0].undefinedPaths).toBe("opaque user key");
  expect(Object.hasOwn(retained.snapshot.attachments[0], "missing")).toBe(false);
  expect(Object.hasOwn(retained.snapshot.attachments[0], "__proto__")).toBe(false);
  expect(Object.getPrototypeOf(retained.snapshot.attachments[0])).toBe(Object.prototype);
  const absent = encodeNativeRawCapture("session", capture());
  const undefinedMode = { ...entry(), snapshot: { ...snapshot(), mode: undefined } };
  const withPresence = encodeNativeRawCapture("session", capture([undefinedMode]));
  expect(withPresence).not.toBe(absent);
  expect(JSON.parse(withPresence).snapshots[0].undefinedPaths).toEqual([["mode"]]);
  expect(JSON.parse(withPresence).snapshots[0].snapshot).toEqual(
    JSON.parse(absent).snapshots[0].snapshot,
  );
});

it("rejects foreign sessions, duplicate mounts and unsafe or aliased mount revisions", () => {
  expect(() =>
    encodeNativeRawCapture("session", capture([{ ...entry(), sessionId: "other" }])),
  ).toThrow("session-mismatch");
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null])
    expect(() => encodeNativeRawCapture("session", capture([{ ...entry(), id: value }]))).toThrow(
      "invalid",
    );
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "0", null])
    expect(() =>
      encodeNativeRawCapture("session", capture([{ ...entry(), revision: value }])),
    ).toThrow("invalid");
  expect(() => encodeNativeRawCapture("session", capture([entry(), entry()]))).toThrow("invalid");
  expect(
    JSON.parse(
      encodeNativeRawCapture(
        "session",
        capture([{ ...entry(Number.MAX_SAFE_INTEGER), revision: Number.MAX_SAFE_INTEGER }]),
      ),
    ).snapshots[0].revision,
  ).toBe(Number.MAX_SAFE_INTEGER);
});

it("uses the actual Native session identity byte limit without shrinking ordinary Unicode identities", () => {
  for (const session of ["s".repeat(512), "é".repeat(256)])
    expect(JSON.parse(encodeNativeRawCapture(session, capture([]))).sessionId).toBe(session);
  for (const session of ["", "s".repeat(513), "é".repeat(257), "session\n", "session\u0080"])
    expect(() => encodeNativeRawCapture(session, capture([]))).toThrow("invalid");
});

it("keeps outer, mount and snapshot fields closed and rejects null optional fields", () => {
  for (const value of [
    { ...capture(), extra: true },
    capture([{ ...entry(), extra: true }]),
    capture([{ ...entry(), sessionId: null }]),
    capture([{ ...entry(), snapshot: { ...snapshot(), extra: true } }]),
    capture([{ ...entry(), snapshot: { ...snapshot(), mode: null } }]),
    capture([{ ...entry(), snapshot: { ...snapshot(), mode: "send" } }]),
    capture([{ ...entry(), snapshot: { ...snapshot(), text: null } }]),
    capture([{ ...entry(), snapshot: { ...snapshot(), attachments: {} } }]),
  ])
    expect(() => encodeNativeRawCapture("session", value)).toThrow();
});

it("refuses lossy JSON coercions, cycles, accessors and prototype-bearing capabilities without invoking them", () => {
  const circular: { cycle?: unknown } = {};
  circular.cycle = circular;
  for (const value of [
    undefined,
    NaN,
    Infinity,
    BigInt(1),
    () => {},
    new Date(),
    circular,
    [undefined],
    Array(1),
  ]) {
    const next = entry();
    next.snapshot.attachments = [value];
    expect(() => encodeNativeRawCapture("session", capture([next]))).toThrow("invalid");
  }
  const getter = vi.fn(() => "must not run");
  const next = entry();
  next.snapshot.attachments = [
    Object.defineProperty({}, "value", { get: getter, enumerable: true }),
  ];
  expect(() => encodeNativeRawCapture("session", capture([next]))).toThrow("invalid");
  const source = Object.defineProperty(capture(), "qualified", { get: getter, enumerable: true });
  expect(() => encodeNativeRawCapture("session", source)).toThrow("capture-unavailable");
  expect(getter).not.toHaveBeenCalled();
});

it("bounds the actual mounted roster without dropping any mount", () => {
  const allowed = Array.from({ length: NATIVE_RAW_CAPTURE_LIMITS.snapshots }, (_, index) =>
    entry(index + 1),
  );
  expect(JSON.parse(encodeNativeRawCapture("session", capture(allowed))).snapshots).toHaveLength(
    256,
  );
  expect(() => encodeNativeRawCapture("session", capture([...allowed, entry(257)]))).toThrow(
    "capacity",
  );
});

it("counts complete raw-envelope depth and values at the Native parser's exact boundaries", () => {
  const next = entry();
  // Root/header/one assigned entry and this attachment consume 16 JSON values.
  next.snapshot.attachments = [{ payload: Array.from({ length: 65_520 }, () => 0) }];
  expect(() => encodeNativeRawCapture("session", capture([next]))).not.toThrow();
  (next.snapshot.attachments[0] as { payload: number[] }).payload.push(0);
  expect(() => encodeNativeRawCapture("session", capture([next]))).toThrow("capacity");
  let deep: unknown = true;
  for (let index = 0; index < 10; index++) deep = [deep];
  next.snapshot.attachments = [{ value: deep }];
  expect(() => encodeNativeRawCapture("session", capture([next]))).not.toThrow();
  next.snapshot.attachments = [{ value: [deep] }];
  expect(() => encodeNativeRawCapture("session", capture([next]))).toThrow("capacity");
});

it("enforces UTF8 JSON bytes including escapes before allocating an oversized serialized artifact", () => {
  const next = entry();
  const overhead = Buffer.byteLength(encodeNativeRawCapture("session", capture([next])));
  next.snapshot.text = "x".repeat(NATIVE_RAW_CAPTURE_LIMITS.bytes - overhead);
  expect(Buffer.byteLength(encodeNativeRawCapture("session", capture([next])))).toBe(
    NATIVE_RAW_CAPTURE_LIMITS.bytes,
  );
  next.snapshot.text += "x";
  expect(() => encodeNativeRawCapture("session", capture([next]))).toThrow("capacity");
  next.snapshot.text = "\u0000".repeat(Math.ceil(NATIVE_RAW_CAPTURE_LIMITS.bytes / 6));
  expect(() => encodeNativeRawCapture("session", capture([next]))).toThrow("capacity");
  next.snapshot.text = "\ud800";
  expect(() => encodeNativeRawCapture("session", capture([next]))).toThrow("invalid");
});
