/** Data only. Bounded captures never supply producer or execution authority. */
export const NATIVE_CAPTURE_JSON_LIMITS = Object.freeze({
  bytes: 16 * 1024 * 1024,
  depth: 16,
  nodes: 65_536,
});

export class NativeCaptureJsonError extends Error {
  constructor(readonly code: "invalid" | "capacity") {
    super(`Native capture data unavailable: ${code}`);
    this.name = "NativeCaptureJsonError";
  }
}
const fail = (code: NativeCaptureJsonError["code"]): never => {
  throw new NativeCaptureJsonError(code);
};
export const isNativeCaptureObject = (value: unknown): value is Record<string, unknown> =>
  !!value &&
  typeof value === "object" &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function denseArray(value: unknown[]): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype) return fail("invalid");
  if (value.length > NATIVE_CAPTURE_JSON_LIMITS.nodes) return fail("capacity");
  if (Reflect.ownKeys(value).length !== value.length + 1) return fail("invalid");
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, index);
    if (!property?.enumerable || !("value" in property)) return fail("invalid");
  }
  return value;
}

// Printable ASCII without quote/backslash costs exactly one byte per unit (base64, ids).
const PLAIN_ASCII = /^[\x20\x21\x23-\x5b\x5d-\x7e]*$/;

function stringBytes(value: string): number {
  if (value.length >= 32 && PLAIN_ASCII.test(value)) {
    if (value.length + 2 > NATIVE_CAPTURE_JSON_LIMITS.bytes) return fail("capacity");
    return value.length + 2;
  }
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
    if (bytes > NATIVE_CAPTURE_JSON_LIMITS.bytes) return fail("capacity");
  }
  return bytes;
}

type Path = (string | number)[];
type Mode = "copy" | "snapshot" | "json";

/** One budget spans all snapshots encoded through this instance. */
function walker(mode: Mode) {
  let nodes = 0;
  let bytes = 0;
  const visiting = new Set<object>();
  const charge = (amount: number) => {
    bytes += amount;
    if (bytes > NATIVE_CAPTURE_JSON_LIMITS.bytes) return fail("capacity");
  };
  const walk = (input: unknown, depth: number, path: Path, undefinedPaths: Path[]): unknown => {
    if (++nodes > NATIVE_CAPTURE_JSON_LIMITS.nodes || depth > NATIVE_CAPTURE_JSON_LIMITS.depth)
      return fail("capacity");
    if (typeof input === "string") {
      charge(stringBytes(input));
      return input;
    }
    if (input === null || typeof input === "boolean") {
      charge(input === null ? 4 : input ? 4 : 5);
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
        const items = denseArray(input);
        charge(2 + Math.max(0, items.length - 1));
        const result = items.map((value, index) =>
          walk(value, depth + 1, [...path, index], undefinedPaths),
        );
        return mode === "copy" ? Object.freeze(result) : result;
      }
      if (!isNativeCaptureObject(input)) return fail("invalid");
      const keys = Reflect.ownKeys(input);
      const result = Object.create(null) as Record<string, unknown>;
      charge(2 + Math.max(0, keys.length - 1));
      for (const key of keys) {
        if (typeof key !== "string") return fail("invalid");
        const property = Object.getOwnPropertyDescriptor(input, key)!;
        if (!property.enumerable || !("value" in property)) return fail("invalid");
        charge(stringBytes(key) + 1);
        const next = [...path, key];
        if (property.value === undefined && mode !== "json") {
          if (++nodes > NATIVE_CAPTURE_JSON_LIMITS.nodes) return fail("capacity");
          if (mode === "snapshot") undefinedPaths.push(next);
          else result[key] = undefined;
        } else result[key] = walk(property.value, depth + 1, next, undefinedPaths);
      }
      return mode === "copy" ? Object.freeze(result) : result;
    } finally {
      visiting.delete(input);
    }
  };
  return { walk, bytes: () => bytes };
}

/** Deep immutable plain copy; own undefined object members remain present. */
export function copyNativeCaptureData<T>(value: T): T {
  return walker("copy").walk(value, 0, [], []) as T;
}

export function createNativeCaptureSnapshotEncoder() {
  const state = walker("snapshot");
  return (input: unknown) => {
    if (!isNativeCaptureObject(input)) return fail("invalid");
    const undefinedPaths: Path[] = [];
    const snapshot = state.walk(input, 3, [], undefinedPaths) as Record<string, unknown>;
    return { snapshot, ...(undefinedPaths.length ? { undefinedPaths } : {}) };
  };
}

/** Reject before JSON.stringify allocates output beyond the shared byte cap. */
export function stringifyNativeCaptureJson(value: unknown): string {
  const state = walker("json");
  const copied = state.walk(value, 0, [], []);
  const json = JSON.stringify(copied);
  if (new TextEncoder().encode(json).byteLength !== state.bytes()) return fail("invalid");
  return json;
}
