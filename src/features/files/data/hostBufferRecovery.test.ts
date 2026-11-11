import { afterEach, expect, it, vi } from "vitest";
import {
  createHostBufferRecovery,
  hostBufferReportKey,
  type HostBufferCursor,
} from "./hostBufferRecovery";

const hash = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const file = { path: "C:\\repo\\未保存.txt", dirty: true };
async function fixture(bom = false) {
  const context = {
    hostEnvironmentId: "native-selected-host",
    sourceStoreId: "actual-store",
    sourceProfileId: "actual-profile",
    nativeStoreInstance: "2bf5bb67-6ad0-45a8-8563-269fbfe67c63",
    clientId: "c".repeat(64),
  };
  const provenance = {
    version: 2,
    sourceStoreId: context.sourceStoreId,
    sourceProfileId: context.sourceProfileId,
    storeInstance: "15f0185b-73d1-4a42-b7bf-b65a78d03c62",
    windowIncarnation: "f8da2329-ac66-4f69-921a-9985f84e7779",
    kind: "physical",
    reportVersion: 1,
    reportNonce: "00357950-9329-44c1-a6b2-5fbecf1a2fd2",
    snapshotDigest: "d".repeat(64),
  };
  const owner = {
    ownerId: "physical-owner",
    updatedAt: 10,
    unknown: false,
    buffers: [file],
    source: provenance,
  };
  const body = {
    clientId: context.clientId,
    instanceId: "original-instance",
    device: "a".repeat(64),
    processId: 1,
    receivedAt: 11,
    owners: [owner],
    recovery: { reportVersion: 2, ownerVersions: { "physical-owner": 3 } },
  };
  const raw = `${bom ? "\uFEFF" : ""}${JSON.stringify(body)}`;
  const source = {
    reportId: await hash(JSON.stringify([body.device, body.clientId, body.instanceId])),
    reportVersion: 2,
    ownerId: owner.ownerId,
    ownerVersion: 3,
    snapshotDigest: await hash(raw),
  };
  const row = {
    source,
    clientId: context.clientId,
    instanceId: body.instanceId,
    processId: 1,
    updatedAt: 10,
    byteLength: new TextEncoder().encode(raw).length,
    bufferCount: 1,
    dirtyCount: 1,
    unknown: false,
    provenance,
    lineage: "physical",
    ownerMissing: false,
    compatibilityHoldId: "b".repeat(64),
    verification: "metadata-only",
    retention: "held",
    inspectable: true,
    qualified: false,
    resolution: "unsupported",
  };
  const page = {
    version: 1,
    qualified: false,
    resolution: "unsupported",
    context,
    records: [row],
    next: null as HostBufferCursor | null,
    incomplete: false,
    duplicatesPossible: false,
    unavailable: false,
  };
  const read = {
    version: 1,
    qualified: false,
    resolution: "unsupported",
    source,
    context,
    rawReport: raw,
    owner,
    buffers: [file],
    contentAvailable: false,
  };
  const status = {
    version: 1,
    qualified: false,
    resolution: "unsupported",
    source,
    context,
    found: true,
    inspectable: true,
    unavailable: false,
  };
  const invoke = vi.fn(async (command: string, _args?: Record<string, unknown>): Promise<unknown> =>
    command.endsWith("_list") ? page : command.endsWith("_status") ? status : read,
  );
  const api = createHostBufferRecovery({ invoke, available: () => true });
  return {
    context,
    provenance,
    owner,
    body,
    source,
    row,
    page,
    read,
    status,
    invoke,
    api,
    record: async () => (await api.list({ after: null, limit: 25 })).records[0]!,
    async replaceRaw(value: unknown) {
      read.rawReport = JSON.stringify(value);
      source.snapshotDigest = await hash(read.rawReport);
      row.byteLength = new TextEncoder().encode(read.rawReport).length;
    },
  };
}
afterEach(() => vi.useRealTimers());

it("uses only local Native commands and preserves explicit metadata without manufacturing a window label", async () => {
  const f = await fixture();
  const page = await f.api.list({ after: null, limit: 25 });
  expect(f.invoke).toHaveBeenCalledExactlyOnceWith("managed_workspace_host_buffer_recovery_list", {
    request: { after: null, limit: 25 },
  });
  expect(page.records[0]).toMatchObject({
    windowLabel: null,
    held: true,
    current: false,
    qualified: false,
    contentAvailable: false,
    retainedBytes: f.row.byteLength,
  });
  expect(Object.isFrozen(page.records[0]!.source)).toBe(true);
  expect(Object.isFrozen(page.context)).toBe(true);
  expect(page.records[0]!.provenance.storeInstance).not.toBe(page.context.nativeStoreInstance);
  await expect(f.api.list({ after: null, limit: 101 })).rejects.toMatchObject({
    code: "invalid-request",
  });
  await expect(
    f.api.list({ after: { version: 1, cursorId: crypto.randomUUID(), page: 1 }, limit: 25 }),
  ).rejects.toMatchObject({ code: "invalid-request" });
  expect(f.invoke).toHaveBeenCalledTimes(1);
});
it("hashes original BOM UTF8 then parses it and returns only selected closed content", async () => {
  const f = await fixture(true);
  const record = await f.record();
  const result = await f.api.read(record);
  expect(result.record).toBe(record);
  expect(result.buffers).toEqual([file]);
  expect(result.contentAvailable).toBe(false);
  expect(Object.keys(result).sort()).toEqual([
    "buffers",
    "contentAvailable",
    "qualified",
    "record",
    "resolution",
  ]);
  expect(Object.isFrozen(result.buffers[0])).toBe(true);
  expect(f.invoke).toHaveBeenLastCalledWith("managed_workspace_host_buffer_recovery_read", {
    source: f.source,
    expectedContext: f.context,
  });
  expect(await hash(f.read.rawReport.slice(1))).not.toBe(f.source.snapshotDigest);
});
it("forwards empty-page continuation and exact Native context without converting cursor to a local offset", async () => {
  const f = await fixture();
  const cursor: HostBufferCursor = { version: 1, cursorId: crypto.randomUUID(), page: 1 };
  f.page.records = [];
  f.page.next = cursor;
  f.page.incomplete = true;
  f.page.unavailable = true;
  const first = await f.api.list({ after: null, limit: 25 });
  f.page.next = { ...cursor, page: 2 };
  const second = await f.api.list({
    after: first.next!,
    expectedContext: first.context,
    limit: 25,
  });
  expect(second.records).toEqual([]);
  expect(second.unavailable).toBe(true);
  expect(f.invoke).toHaveBeenLastCalledWith("managed_workspace_host_buffer_recovery_list", {
    request: { after: cursor, limit: 25 },
    expectedContext: f.context,
  });
});
it("keeps duplicate metadata rows with distinct presentation keys and no report-version ordering assumption", async () => {
  const f = await fixture();
  f.page.records = [f.row, f.row];
  f.page.duplicatesPossible = true;
  const page = await f.api.list({ after: null, limit: 25 });
  expect(page.records).toHaveLength(2);
  expect(page.duplicatesPossible).toBe(true);
  expect(hostBufferReportKey(page.records[0]!)).not.toBe(hostBufferReportKey(page.records[1]!));
});
it.each(["context", "source", "digest", "charge", "owner", "buffers", "provenance"])(
  "rejects stale/mismatched %s without exposing raw Native error details",
  async (field) => {
    const f = await fixture();
    const record = await f.record();
    if (field === "context")
      f.read.context = { ...f.context, nativeStoreInstance: crypto.randomUUID() };
    if (field === "source") f.read.source = { ...f.source, ownerVersion: 7 };
    if (field === "digest") f.read.rawReport += " ";
    if (field === "charge") {
      f.row.byteLength++;
      const wrong = (await f.api.list({ after: null, limit: 25 })).records[0]!;
      await expect(f.api.read(wrong)).rejects.toMatchObject({ code: "invalid-response" });
      return;
    }
    if (field === "owner") f.read.owner = { ...f.owner, updatedAt: 12 };
    if (field === "buffers") f.read.buffers = [{ ...file, dirty: false }];
    if (field === "provenance")
      f.read.owner = { ...f.owner, source: { ...f.provenance, sourceProfileId: "other-profile" } };
    await expect(f.api.read(record)).rejects.toMatchObject({
      message: "HOST_BUFFER_RECOVERY_invalid-response",
    });
  },
);
it.each(["page", "metadata", "context", "provenance", "source"])(
  "rejects undeclared %s IPC fields",
  async (field) => {
    const f = await fixture();
    const target =
      field === "page"
        ? f.page
        : field === "metadata"
          ? f.row
          : field === "context"
            ? f.context
            : field === "provenance"
              ? f.provenance
              : f.source;
    (target as Record<string, unknown>).secret = "hidden detail";
    await expect(f.api.list({ after: null, limit: 25 })).rejects.toMatchObject({
      code: "invalid-response",
    });
  },
);
it("checks raw closed shape, versions and selected-owner identity after a valid recomputed digest", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => ({ ...f.body, foreign: "secret" }),
    (f: Awaited<ReturnType<typeof fixture>>) => ({
      ...f.body,
      recovery: { ...f.body.recovery, reportVersion: 9 },
    }),
    (f: Awaited<ReturnType<typeof fixture>>) => ({
      ...f.body,
      owners: [{ ...f.owner, ownerId: "another-owner" }],
    }),
    (f: Awaited<ReturnType<typeof fixture>>) => ({
      ...f.body,
      owners: [{ ...f.owner, buffers: [{ path: "relative/file", dirty: true }] }],
    }),
  ]) {
    const f = await fixture();
    await f.replaceRaw(change(f));
    const record = await f.record();
    await expect(f.api.read(record)).rejects.toMatchObject({ code: "invalid-response" });
  }
});
it("accepts legacy zero report/owner versions only when exact original raw has no recovery versions", async () => {
  const f = await fixture();
  const { recovery: _unused, ...body } = f.body;
  await f.replaceRaw(body);
  f.source.reportVersion = 0;
  f.source.ownerVersion = 0;
  const record = await f.record();
  expect((await f.api.read(record)).buffers).toEqual([file]);
});
it("bounds raw UTF8 bytes, rows and source scope before returning data", async () => {
  const f = await fixture();
  const record = await f.record();
  f.read.rawReport = "界".repeat(400_000);
  await expect(f.api.read(record)).rejects.toMatchObject({ code: "invalid-response" });
  f.page.records = Array.from({ length: 101 }, () => f.row);
  await expect(f.api.list({ after: null, limit: 100 })).rejects.toMatchObject({
    code: "invalid-response",
  });
  f.page.records = [
    { ...f.row, provenance: { ...f.provenance, sourceStoreId: "different-store" } },
  ];
  await expect(f.api.list({ after: null, limit: 25 })).rejects.toMatchObject({
    code: "invalid-response",
  });
});
it("does not follow malformed/repeated/different-context cursors", async () => {
  const f = await fixture();
  const cursor: HostBufferCursor = { version: 1, cursorId: crypto.randomUUID(), page: 1 };
  f.page.next = cursor;
  await expect(
    f.api.list({ after: cursor, expectedContext: f.context, limit: 25 }),
  ).rejects.toMatchObject({ code: "invalid-response" });
  f.page.next = { ...cursor, page: 2, cursorId: crypto.randomUUID() };
  await expect(
    f.api.list({ after: cursor, expectedContext: f.context, limit: 25 }),
  ).rejects.toMatchObject({ code: "invalid-response" });
  f.page.next = null;
  await expect(
    f.api.list({
      after: cursor,
      expectedContext: { ...f.context, hostEnvironmentId: "other-host" },
      limit: 25,
    }),
  ).rejects.toMatchObject({ code: "invalid-response" });
});

it("keeps oversized metadata visible but refuses raw reads and enforces the10000-buffer projection bound", async () => {
  const f = await fixture();
  const record = await f.record();
  f.read.buffers = Array.from({ length: 10_001 }, () => file);
  await expect(f.api.read(record)).rejects.toMatchObject({ code: "invalid-response" });
  f.page.records = [{ ...f.row, byteLength: 1024 * 1024 + 1, inspectable: false }];
  const oversized = (await f.api.list({ after: null, limit: 25 })).records[0]!;
  const calls = f.invoke.mock.calls.length;
  await expect(f.api.read(oversized)).rejects.toMatchObject({ code: "unavailable" });
  expect(f.invoke).toHaveBeenCalledTimes(calls);
});
it("closed read/status IPC projections reject extra fields rather than exposing them", async () => {
  const f = await fixture();
  const record = await f.record();
  (f.read as Record<string, unknown>).foreign = "must never escape";
  await expect(f.api.read(record)).rejects.toMatchObject({ code: "invalid-response" });
  (f.status as Record<string, unknown>).foreign = "must never escape";
  await expect(f.api.status(record)).rejects.toMatchObject({ code: "invalid-response" });
});
it("status is a scoped unsupported read and never grants absent/not-admitted proof", async () => {
  const f = await fixture();
  const record = await f.record();
  expect(await f.api.status(record)).toMatchObject({
    found: true,
    qualified: false,
    resolution: "unsupported",
  });
  f.status.found = false;
  f.status.inspectable = false;
  expect(await f.api.status(record)).toMatchObject({ found: false, unavailable: false });
  f.status.inspectable = true;
  await expect(f.api.status(record)).rejects.toMatchObject({ code: "invalid-response" });
  expect(f.invoke).toHaveBeenLastCalledWith("managed_workspace_host_buffer_recovery_status", {
    source: f.source,
    expectedContext: f.context,
  });
});
it("local Native unavailable and Native failures do not fall back or leak server paths", async () => {
  const invoke = vi.fn(async () => {
    throw new Error("token secret C:\\private\\store.sqlite");
  });
  const unavailable = createHostBufferRecovery({ invoke, available: () => false });
  await expect(unavailable.list({ after: null, limit: 25 })).rejects.toMatchObject({
    code: "unsupported",
  });
  expect(invoke).not.toHaveBeenCalled();
  const api = createHostBufferRecovery({ invoke, available: () => true });
  await expect(api.list({ after: null, limit: 25 })).rejects.toMatchObject({
    code: "unavailable",
    message: "HOST_BUFFER_RECOVERY_unavailable",
  });
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("deadlines/cancel detach waiters while four actual jobs stay charged across factories/module replacement", async () => {
  const f = await fixture();
  vi.useFakeTimers();
  const finish: Array<() => void> = [];
  const invoke = vi.fn(() => new Promise<unknown>((resolve) => finish.push(() => resolve(f.page))));
  const api = createHostBufferRecovery({ invoke, available: () => true, timeoutMs: 10 });
  const cancelled = new AbortController();
  const jobs = Array.from({ length: 4 }, (_, index) =>
    api
      .list({ after: null, limit: 25 }, index === 0 ? { signal: cancelled.signal } : undefined)
      .catch((error) => error),
  );
  await Promise.resolve();
  cancelled.abort();
  await vi.advanceTimersByTimeAsync(11);
  expect((await Promise.all(jobs)).map((error) => error.code)).toEqual([
    "cancelled",
    "deadline",
    "deadline",
    "deadline",
  ]);
  expect(api.observation().active).toBe(4);
  const freshModule = await import("./hostBufferRecovery?held-budget-reload");
  const fresh = freshModule.createHostBufferRecovery({
    invoke,
    available: () => true,
    timeoutMs: 10,
  });
  await expect(fresh.list({ after: null, limit: 25 })).rejects.toMatchObject({ code: "capacity" });
  expect(invoke).toHaveBeenCalledTimes(4);
  finish.forEach((resolve) => resolve());
  await vi.advanceTimersByTimeAsync(0);
  expect(fresh.observation().active).toBe(0);
});
