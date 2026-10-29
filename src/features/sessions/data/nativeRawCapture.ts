/** Raw mounted data only. Neither these bytes nor their metadata supplies
 * producer coverage, Native authority or a provider/application commitment. */
export const NATIVE_RAW_CAPTURE_LIMITS = Object.freeze({
  bytes: 16 * 1024 * 1024,
  snapshots: 256,
  depth: 16,
  nodes: 65_536,
});

export class NativeRawCaptureError extends Error {
  constructor(readonly code: "invalid" | "capacity" | "session-mismatch" | "capture-unavailable") {
    super(`Raw mounted capture unavailable: ${code}`);
    this.name = "NativeRawCaptureError";
  }
}
const fail = (code: NativeRawCaptureError["code"]): never => {
  throw new NativeRawCaptureError(code);
};
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const owns = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);

function fields(value: unknown, allowed: readonly string[], required = allowed) {
  if (!plain(value)) return fail("invalid");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (
      typeof key !== "string" ||
      !allowed.includes(key) ||
      !descriptors[key]!.enumerable ||
      !("value" in descriptors[key]!)
    )
      return fail("invalid");
  }
  if (required.some((key) => !owns(descriptors, key))) return fail("invalid");
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return fail("invalid");
  if (value.length > NATIVE_RAW_CAPTURE_LIMITS.nodes) return fail("capacity");
  if (Reflect.ownKeys(value).length !== value.length + 1) return fail("invalid");
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor?.enumerable || !("value" in descriptor)) return fail("invalid");
  }
  return value;
}
const safe = (value: unknown, minimum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
function sessionIdentity(value: string): boolean {
  if (!value.length || value.length > 512 || new TextEncoder().encode(value).byteLength > 512)
    return false;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < 32 || (code >= 127 && code <= 159)) return false;
  }
  return true;
}

/** Counts JSON string bytes before allocating serialized output. Lone UTF16
 * surrogates have no lossless Native Unicode representation and stay held. */
function stringBytes(value: string): number {
  let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code === 34 ||
      code === 92 ||
      code === 8 ||
      code === 9 ||
      code === 10 ||
      code === 12 ||
      code === 13
    )
      bytes += 2;
    else if (code < 32) bytes += 6;
    else if (code < 128) bytes++;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return fail("invalid");
      bytes += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) return fail("invalid");
    else bytes += 3;
    if (bytes > NATIVE_RAW_CAPTURE_LIMITS.bytes) return fail("capacity");
  }
  return bytes;
}

/** Encode the actual closed lease's immutable capture. Missing snapshots cannot
 * be converted to an empty roster. Normal draft serialization is deliberately
 * outside this path: whitespace, empty text and opaque JSON metadata survive. */
export function encodeNativeRawCapture(sessionId: string, captured: unknown): string {
  if (typeof sessionId !== "string" || !sessionIdentity(sessionId)) return fail("invalid");
  if (
    !plain(captured) ||
    Object.getOwnPropertyDescriptor(captured, "qualified")?.value !== false ||
    !owns(captured, "snapshots")
  )
    return fail("capture-unavailable");
  const capture = fields(captured, ["qualified", "snapshots", "missingCoverage"]);
  const snapshots = array(capture.snapshots);
  if (snapshots.length > NATIVE_RAW_CAPTURE_LIMITS.snapshots) return fail("capacity");
  const ids = new Set<number>();
  let sourceNodes = 0;
  const visitingSource = new Set<object>();
  type Path = (string | number)[];
  const normalize = (input: unknown, path: Path, undefinedPaths: Path[]): unknown => {
    if (
      ++sourceNodes > NATIVE_RAW_CAPTURE_LIMITS.nodes ||
      path.length + 3 > NATIVE_RAW_CAPTURE_LIMITS.depth
    )
      return fail("capacity");
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean" ||
      (typeof input === "number" && Number.isFinite(input) && !Object.is(input, -0))
    )
      return input;
    if (!input || typeof input !== "object" || visitingSource.has(input)) return fail("invalid");
    visitingSource.add(input);
    try {
      if (Array.isArray(input))
        return array(input).map((item, index) => normalize(item, [...path, index], undefinedPaths));
      if (!plain(input)) return fail("invalid");
      const result = Object.create(null) as Record<string, unknown>;
      for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string") return fail("invalid");
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!descriptor.enumerable || !("value" in descriptor)) return fail("invalid");
        const next = [...path, key];
        if (descriptor.value === undefined) {
          if (++sourceNodes > NATIVE_RAW_CAPTURE_LIMITS.nodes) return fail("capacity");
          // Presence metadata is outside opaque user data. It distinguishes an
          // own undefined member from absence without inventing a JSON value.
          undefinedPaths.push(next);
        } else result[key] = normalize(descriptor.value, next, undefinedPaths);
      }
      return result;
    } finally {
      visitingSource.delete(input);
    }
  };
  const retained = [];
  for (const raw of snapshots) {
    const entry = fields(
      raw,
      ["id", "revision", "sessionId", "snapshot"],
      ["id", "revision", "snapshot"],
    );
    if (!safe(entry.id, 1) || !safe(entry.revision, 0) || ids.has(entry.id)) return fail("invalid");
    ids.add(entry.id);
    if (owns(entry, "sessionId") && entry.sessionId !== sessionId) return fail("session-mismatch");
    const snapshot = fields(
      entry.snapshot,
      ["text", "attachments", "mcpTags", "mode"],
      ["text", "attachments", "mcpTags"],
    );
    if (
      typeof snapshot.text !== "string" ||
      (owns(snapshot, "mode") && snapshot.mode !== undefined && snapshot.mode !== "save")
    )
      return fail("invalid");
    array(snapshot.attachments);
    array(snapshot.mcpTags);
    const undefinedPaths: Path[] = [];
    retained.push({
      id: entry.id,
      revision: entry.revision,
      ...(owns(entry, "sessionId") ? { sessionId: entry.sessionId } : {}),
      snapshot: normalize(snapshot, [], undefinedPaths),
      ...(undefinedPaths.length ? { undefinedPaths } : {}),
    });
  }
  const value = {
    version: 1,
    kind: "mounted-composer-raw-capture",
    qualified: false,
    sessionId,
    snapshots: retained,
  };
  let nodes = 0,
    bytes = 0;
  const visiting = new Set<object>();
  const charge = (size: number) => {
    bytes += size;
    if (bytes > NATIVE_RAW_CAPTURE_LIMITS.bytes) return fail("capacity");
  };
  const copy = (input: unknown, depth = 0): unknown => {
    if (++nodes > NATIVE_RAW_CAPTURE_LIMITS.nodes || depth > NATIVE_RAW_CAPTURE_LIMITS.depth)
      return fail("capacity");
    if (typeof input === "string") {
      charge(stringBytes(input));
      return input;
    }
    if (input === null) {
      charge(4);
      return null;
    }
    if (typeof input === "boolean") {
      charge(input ? 4 : 5);
      return input;
    }
    if (typeof input === "number" && Number.isFinite(input) && !Object.is(input, -0)) {
      charge(JSON.stringify(input).length);
      return input;
    }
    if (!input || typeof input !== "object" || visiting.has(input)) return fail("invalid");
    visiting.add(input);
    try {
      if (Array.isArray(input)) {
        const items = array(input);
        charge(2 + Math.max(0, items.length - 1));
        return items.map((item) => copy(item, depth + 1));
      }
      if (!plain(input)) return fail("invalid");
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const keys = Reflect.ownKeys(descriptors);
      charge(2 + Math.max(0, keys.length - 1));
      const result = Object.create(null) as Record<string, unknown>;
      for (const key of keys) {
        if (typeof key !== "string") return fail("invalid");
        const descriptor = descriptors[key]!;
        if (!descriptor.enumerable || !("value" in descriptor)) return fail("invalid");
        charge(stringBytes(key) + 1);
        result[key] = copy(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      visiting.delete(input);
    }
  };
  const json = JSON.stringify(copy(value));
  if (new TextEncoder().encode(json).byteLength !== bytes) return fail("invalid");
  return json;
}
