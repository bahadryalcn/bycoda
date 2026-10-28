import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  readRetainedSource,
  reserveRetainedSourceTransfer,
  retainedSourceTransferObservation,
  RETAINED_SOURCE_CHUNK_BYTES as CHUNK,
  RETAINED_SOURCE_MAX_BYTES as MAX,
  type RetainedSourceCommand,
} from "./retained-source";

const association = {
  environmentId: "env",
  sourceStoreId: "store",
  sourceProfileId: "profile",
  sourceEpoch: randomUUID(),
};
const scope = { sessionId: "session", migrationId: "migration" };
function transport(
  options: {
    raw?: Buffer;
    sourceJson?: string;
    absent?: boolean;
    change?: (value: Record<string, unknown>, command: RetainedSourceCommand) => void;
  } = {},
) {
  const raw = options.raw ?? Buffer.from(options.sourceJson ?? '{"value":"retained"}');
  const exportId = randomUUID();
  const commands: RetainedSourceCommand[] = [];
  let counter = 0;
  const fence = {
    ...scope,
    environmentId: association.environmentId,
    sourceStoreId: association.sourceStoreId,
    sourceProfileId: association.sourceProfileId,
    protocol: 2,
    generation: 1,
    sourceRevision: 9,
    sourceDigest: createHash("sha256").update(raw).digest("hex"),
    snapshotEncoding: "source-json-utf8/v1",
    minWriterProtocol: 2,
    quiescent: true,
    unknownReservations: false,
    writerInventoryVerified: true,
    unsupportedWriters: false,
    evidenceDigest: "e".repeat(64),
  };
  const exchange = async (command: RetainedSourceCommand) => {
    commands.push(command);
    const requestId = ++counter;
    const common = {
      version: 1,
      requestId,
      sourceEpoch: association.sourceEpoch,
      qualified: false,
    };
    let value: Record<string, unknown>;
    if (command.kind === "source-retained-open")
      value = {
        ...common,
        kind: "source-retained-open-result",
        ...scope,
        state: options.absent ? "absent" : "retained",
        ...(!options.absent
          ? { exportId, fence: { ...fence }, totalBytes: raw.length, chunkBytes: CHUNK }
          : {}),
      };
    else if (command.kind === "source-retained-chunk")
      value = {
        ...common,
        kind: "source-retained-chunk-result",
        exportId,
        offset: command.offset,
        data: raw.subarray(command.offset, command.offset + CHUNK).toString("base64"),
        eof: command.offset + CHUNK >= raw.length,
      };
    else value = { ...common, kind: "source-retained-close-result", exportId, retired: true };
    options.change?.(value, command);
    return { requestId, value };
  };
  return { exchange, commands, fence, raw };
}

describe("unqualified retained source wire reassembly", () => {
  it("reassembles exact UTF8 once across an emoji byte boundary and explicitly closes before returning", async () => {
    const sourceJson = JSON.stringify({ x: "a".repeat(CHUNK - 7) + "🍏 İstanbul\r\nΩ" });
    const t = transport({ sourceJson });
    expect(t.raw[CHUNK - 1]).toBe(0xf0);
    const result = await readRetainedSource(association, scope, t.exchange);
    expect(result).toEqual({ state: "retained", sourceJson, fence: t.fence, qualified: false });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.state === "retained") expect(Object.isFrozen(result.fence)).toBe(true);
    expect(t.commands.map((command) => command.kind)).toEqual([
      "source-retained-open",
      "source-retained-chunk",
      "source-retained-chunk",
      "source-retained-close",
    ]);
    expect(
      t.commands
        .filter((command) => command.kind === "source-retained-chunk")
        .map((command) => command.offset),
    ).toEqual([0, CHUNK]);
  });
  it("returns a strict absent result without materializing bytes or opening/closing an export", async () => {
    const t = transport({ absent: true });
    expect(await readRetainedSource(association, scope, t.exchange)).toEqual({
      state: "absent",
      qualified: false,
    });
    expect(t.commands).toEqual([{ kind: "source-retained-open", ...scope }]);
  });
  it("preserves an initial UTF8 BOM instead of silently stripping retained bytes", async () => {
    const sourceJson = '\uFEFF{"value":"same bytes"}';
    const t = transport({ sourceJson });
    expect(await readRetainedSource(association, scope, t.exchange)).toMatchObject({ sourceJson });
  });
  it.each(["environmentId", "sourceStoreId", "sourceProfileId", "sessionId", "migrationId"])(
    "rejects fence %s outside the captured association/request",
    async (key) => {
      const t = transport({
        change(value, command) {
          if (command.kind === "source-retained-open")
            (value.fence as Record<string, unknown>)[key] = "different";
        },
      });
      await expect(readRetainedSource(association, scope, t.exchange)).rejects.toMatchObject({
        code: "SCOPE_CHANGED",
      });
      expect(t.commands).toHaveLength(1);
    },
  );
  it.each([
    { totalBytes: 0 },
    { totalBytes: MAX + 1 },
    { totalBytes: 1.5 },
    { chunkBytes: 8 },
    { qualified: true },
    { sourceEpoch: randomUUID() },
    { requestId: 2 },
    { sessionId: "other" },
    { migrationId: "other" },
    { exportId: "not-a-uuid" },
    { unexpected: "field" },
  ])("rejects malformed or mismatched opening before allocating: %j", async (change) => {
    const t = transport({
      change(value, command) {
        if (command.kind === "source-retained-open") Object.assign(value, change);
      },
    });
    await expect(readRetainedSource(association, scope, t.exchange)).rejects.toBeInstanceOf(Error);
    expect(t.commands).toHaveLength(1);
  });
  it.each([
    { data: "" },
    { data: "YQ" },
    { data: "YR==" },
    { data: "YQ==\n" },
    { data: "____" },
    { data: Buffer.alloc(CHUNK + 1).toString("base64") },
    { data: "YQ==" },
    { offset: 1 },
    { exportId: randomUUID() },
    { sourceEpoch: randomUUID() },
    { requestId: 1 },
    { eof: false },
    { qualified: true },
    { unexpected: 1 },
  ])("fails closed on invalid, noncanonical or trailing chunk data vector %#", async (change) => {
    const t = transport({
      change(value, command) {
        if (command.kind === "source-retained-chunk") Object.assign(value, change);
      },
    });
    await expect(readRetainedSource(association, scope, t.exchange)).rejects.toBeInstanceOf(Error);
    expect(t.commands.map((command) => command.kind)).not.toContain("source-retained-close");
  });
  it("rejects premature EOF on a full-size nonfinal chunk", async () => {
    const t = transport({
      raw: Buffer.alloc(CHUNK + 1, 97),
      change(value, command) {
        if (command.kind === "source-retained-chunk") value.eof = true;
      },
    });
    await expect(readRetainedSource(association, scope, t.exchange)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("rejects short nonfinal chunks even when bytes are canonical", async () => {
    const t = transport({
      raw: Buffer.alloc(CHUNK + 1, 97),
      change(value, command) {
        if (command.kind === "source-retained-chunk") value.data = "YQ==";
      },
    });
    await expect(readRetainedSource(association, scope, t.exchange)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("rejects digest mismatch and invalid UTF8 without returning or silently normalizing", async () => {
    const corrupt = transport({
      change(value, command) {
        if (command.kind === "source-retained-open")
          (value.fence as Record<string, unknown>).sourceDigest = "0".repeat(64);
      },
    });
    await expect(readRetainedSource(association, scope, corrupt.exchange)).rejects.toMatchObject({
      code: "DIGEST_MISMATCH",
    });
    const invalid = transport({ raw: Buffer.from([0xc3, 0x28]) });
    await expect(readRetainedSource(association, scope, invalid.exchange)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it.each([
    { exportId: randomUUID() },
    { sourceEpoch: randomUUID() },
    { requestId: 1 },
    { retired: false },
    { qualified: true },
    { extra: 1 },
  ])("never returns a retained result for an invalid close receipt: %j", async (change) => {
    const t = transport({
      change(value, command) {
        if (command.kind === "source-retained-close") Object.assign(value, change);
      },
    });
    await expect(readRetainedSource(association, scope, t.exchange)).rejects.toBeInstanceOf(Error);
  });
  it("bounds global accepted source-byte reservations before materialization and releases idempotently", () => {
    const first = reserveRetainedSourceTransfer();
    const second = reserveRetainedSourceTransfer();
    try {
      expect(retainedSourceTransferObservation()).toEqual({
        activeRetainedTransfers: 2,
        reservedSourceBytes: 2 * MAX,
      });
      expect(() => reserveRetainedSourceTransfer()).toThrow("CAPACITY");
      first();
      first();
      expect(retainedSourceTransferObservation().reservedSourceBytes).toBe(MAX);
    } finally {
      first();
      second();
    }
    expect(retainedSourceTransferObservation().reservedSourceBytes).toBe(0);
  });
  it("retains charged transfers across module re-evaluation instead of resetting the process budget", async () => {
    const first = reserveRetainedSourceTransfer();
    const second = reserveRetainedSourceTransfer();
    try {
      vi.resetModules();
      const reloaded = await import("./retained-source");
      expect(reloaded.retainedSourceTransferObservation().reservedSourceBytes).toBe(2 * MAX);
      expect(() => reloaded.reserveRetainedSourceTransfer()).toThrow("CAPACITY");
      first();
      const third = reloaded.reserveRetainedSourceTransfer();
      try {
        expect(retainedSourceTransferObservation().activeRetainedTransfers).toBe(2);
      } finally {
        third();
      }
    } finally {
      first();
      second();
    }
    expect(retainedSourceTransferObservation().activeRetainedTransfers).toBe(0);
  });
});
