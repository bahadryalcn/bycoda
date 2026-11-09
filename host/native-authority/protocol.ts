import type { JsonValue } from "../../src/shared/model/host-contracts/schemas";
import { types } from "node:util";

export type { JsonValue };
export const HELPER_VERSION = 1;
export const HELPER_MAX_FRAME_BYTES = 64 * 1024;
export const HELPER_ERROR_CODES = [
  "INVALID_BOOTSTRAP",
  "INVALID_COMMAND",
  "INVALID_FRAME",
  "FRAME_TOO_LARGE",
  "PEER_REJECTED",
  "PIPE_UNAVAILABLE",
  "DEADLINE",
  "CANCELLED",
  "PIPE_CLOSED",
  "IO_ERROR",
  "STDIO_ERROR",
  "UNSUPPORTED",
] as const;
export type NativeHelperErrorCode = (typeof HELPER_ERROR_CODES)[number];
export type HelperCommand =
  | { kind: "send"; id: number; value: JsonValue }
  | { kind: "receive" | "close"; id: number };
export type HelperReply =
  | { version: 1; kind: "ready" }
  | { kind: "sent" | "closed"; id: number }
  | { kind: "received"; id: number; value: JsonValue }
  | { kind: "error"; id?: number; code: NativeHelperErrorCode };

export class HelperProtocolError extends Error {
  constructor(readonly code: "INVALID_FRAME" | "FRAME_TOO_LARGE" | "INVALID_VALUE") {
    super(`Native helper protocol: ${code}`);
    this.name = "HelperProtocolError";
  }
}

export function isHelperAddress(address: string): boolean {
  return /^\\\\\.\\pipe\\bycoda-authority-v1-[0-9a-f]{32}(?![\s\S])/.test(address);
}
export function isHelperId(id: unknown): id is number {
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

/** Bound traversal before stringify; reject lossy/non-JSON objects and accessors. */
export function assertJsonValue(value: unknown): asserts value is JsonValue {
  const stack: { value?: unknown; depth: number; leave?: object }[] = [{ value, depth: 0 }];
  const ancestors = new Set<object>();
  let nodes = 0;
  let minimumBytes = 0;
  const count = (bytes: number) => {
    minimumBytes += bytes;
    if (minimumBytes > HELPER_MAX_FRAME_BYTES) throw new HelperProtocolError("FRAME_TOO_LARGE");
  };
  while (stack.length) {
    const next = stack.pop()!;
    if (next.leave) {
      ancestors.delete(next.leave);
      continue;
    }
    if (++nodes > 65_536 || next.depth >= 128) throw new HelperProtocolError("INVALID_VALUE");
    const item = next.value;
    if (item === null || typeof item === "boolean") {
      count(item === null ? 4 : item ? 4 : 5);
      continue;
    }
    if (typeof item === "number" && Number.isFinite(item)) {
      count(String(item).length);
      continue;
    }
    if (typeof item === "string") {
      // Bound before stringify; UTF8/escaping adds only a bounded constant factor.
      count(item.length + 2);
      if (/[\uD800-\uDFFF]/u.test(item)) throw new HelperProtocolError("INVALID_VALUE");
      continue;
    }
    if (!item || typeof item !== "object" || types.isProxy(item) || ancestors.has(item))
      throw new HelperProtocolError("INVALID_VALUE");
    const array = Array.isArray(item);
    if (array && item.length > HELPER_MAX_FRAME_BYTES / 2)
      throw new HelperProtocolError("FRAME_TOO_LARGE");
    if (
      !array &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) {
      throw new HelperProtocolError("INVALID_VALUE");
    }
    ancestors.add(item);
    count(2);
    stack.push({ depth: next.depth, leave: item });
    const keys = Reflect.ownKeys(item).filter((key) => !(array && key === "length"));
    count(Math.max(0, keys.length - 1));
    if (array && keys.length !== item.length) throw new HelperProtocolError("INVALID_VALUE");
    for (const key of keys) {
      if (
        typeof key !== "string" ||
        /[\uD800-\uDFFF]/u.test(key) ||
        (array && (!/^(?:0|[1-9][0-9]*)(?![\s\S])/.test(key) || Number(key) >= item.length))
      )
        throw new HelperProtocolError("INVALID_VALUE");
      if (!array) count(key.length + 3);
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!descriptor.enumerable || !("value" in descriptor))
        throw new HelperProtocolError("INVALID_VALUE");
      stack.push({ value: descriptor.value, depth: next.depth + 1 });
    }
  }
}

export function encodeHelperFrame(value: unknown): Buffer {
  assertJsonValue(value);
  const json = JSON.stringify(value);
  const length = Buffer.byteLength(json, "utf8");
  if (!length || length > HELPER_MAX_FRAME_BYTES) throw new HelperProtocolError("FRAME_TOO_LARGE");
  const frame = Buffer.allocUnsafe(4 + length);
  frame.writeUInt32LE(length);
  frame.write(json, 4, length, "utf8");
  return frame;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HelperProtocolError("INVALID_FRAME");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key)))
    throw new HelperProtocolError("INVALID_FRAME");
}

export function parseHelperReply(value: unknown): HelperReply {
  const frame = object(value);
  if (frame.kind === "ready") {
    keys(frame, ["version", "kind"]);
    if (frame.version !== HELPER_VERSION) throw new HelperProtocolError("INVALID_FRAME");
  } else if (frame.kind === "error") {
    keys(frame, "id" in frame ? ["kind", "id", "code"] : ["kind", "code"]);
    if (
      ("id" in frame && !isHelperId(frame.id)) ||
      !HELPER_ERROR_CODES.includes(frame.code as NativeHelperErrorCode)
    ) {
      throw new HelperProtocolError("INVALID_FRAME");
    }
  } else {
    if (!["sent", "received", "closed"].includes(String(frame.kind)))
      throw new HelperProtocolError("INVALID_FRAME");
    keys(frame, frame.kind === "received" ? ["kind", "id", "value"] : ["kind", "id"]);
    if (!isHelperId(frame.id)) throw new HelperProtocolError("INVALID_FRAME");
  }
  return frame as HelperReply;
}

/** Incremental bounded reader. A callback can reject the first unsolicited frame. */
export class HelperFrameReader {
  private readonly header = Buffer.alloc(4);
  private headerBytes = 0;
  private body: Buffer | undefined;
  private bodyBytes = 0;

  push(chunk: Buffer, onFrame: (value: JsonValue) => void): void {
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.body) {
        const count = Math.min(4 - this.headerBytes, chunk.length - offset);
        chunk.copy(this.header, this.headerBytes, offset, offset + count);
        this.headerBytes += count;
        offset += count;
        if (this.headerBytes < 4) continue;
        const length = this.header.readUInt32LE();
        if (!length) throw new HelperProtocolError("INVALID_FRAME");
        if (length > HELPER_MAX_FRAME_BYTES) throw new HelperProtocolError("FRAME_TOO_LARGE");
        this.body = Buffer.allocUnsafe(length);
      }
      const count = Math.min(this.body.length - this.bodyBytes, chunk.length - offset);
      chunk.copy(this.body, this.bodyBytes, offset, offset + count);
      offset += count;
      this.bodyBytes += count;
      if (this.bodyBytes !== this.body.length) continue;
      const body = this.body;
      this.body = undefined;
      this.bodyBytes = 0;
      this.headerBytes = 0;
      let value: unknown;
      try {
        // Keep a BOM visible to JSON.parse, and reject invalid UTF-8 rather than replacing it.
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body));
        assertJsonValue(value);
      } catch {
        throw new HelperProtocolError("INVALID_FRAME");
      }
      onFrame(value);
    }
  }

  finish(): void {
    if (this.headerBytes || this.body) throw new HelperProtocolError("INVALID_FRAME");
  }
}
