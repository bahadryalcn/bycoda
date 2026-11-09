import { afterEach, expect, it, vi } from "vitest";
import {
  createLegacyBufferRecovery,
  LegacyBufferRecoveryError,
  type LegacyBufferSource,
} from "./legacyBufferRecovery";

const file = { path: "C:\\repo\\draft.txt", dirty: true };
async function fixture(raw = JSON.stringify([file])) {
  const bytes = new TextEncoder().encode(raw);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
  const source: LegacyBufferSource = {
    sourceStoreId: "store",
    sourceProfileId: "profile",
    ownerId: "main",
    reportVersion: 1,
    snapshotDigest: hash,
  };
  const record = {
    source,
    reportVersion: 1,
    ownerId: "main",
    kind: "legacy",
    windowLabel: null,
    updatedAt: 1,
    legacyTimestamp: null,
    retainedBytes: bytes.length,
    current: false,
    held: true,
    confirmed: false,
    contentAvailable: false as const,
    inspectable: true,
  };
  const page = { version: 1, qualified: false, records: [record], next: null };
  const details = { version: 1, qualified: false, record, rawSnapshot: raw, buffers: [file] };
  const invoke = vi.fn(async (name: string) => (name.endsWith("_list") ? page : details));
  const api = createLegacyBufferRecovery({ invoke: invoke as never, available: () => true });
  return { source, record, page, details, invoke, api };
}
afterEach(() => vi.useRealTimers());

it("reads metadata locally with bounded pages and no claimed content or qualification", async () => {
  const f = await fixture();
  expect(await f.api.list({ after: null, limit: 25 })).toMatchObject({
    qualified: false,
    records: [{ contentAvailable: false, held: true }],
    next: null,
  });
  expect(f.invoke).toHaveBeenCalledExactlyOnceWith("managed_workspace_buffer_recovery_list", {
    request: { after: null, limit: 25 },
  });
  await expect(f.api.list({ after: -1, limit: 25 })).rejects.toMatchObject({
    code: "invalid-request",
  });
  expect(f.invoke).toHaveBeenCalledTimes(1);
});

it("checks the original raw digest including legacy whitespace/extra fields without rewriting it", async () => {
  const f = await fixture(
    ` [ { "dirty": true, "extra": "kept原", "path": ${JSON.stringify(file.path)} } ] `,
  );
  const value = await f.api.read(f.source);
  expect(value).toMatchObject({ buffers: [file], qualified: false, contentAvailable: false });
  expect(f.details.rawSnapshot).toContain("kept原");
  expect(Object.isFrozen(value.buffers[0])).toBe(true);
  expect(f.invoke).toHaveBeenCalledExactlyOnceWith("managed_workspace_buffer_recovery_read", {
    source: f.source,
  });
});

it("rejects mismatched source, body digest, charge and parsed buffers", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.details.record.source = { ...f.source, ownerId: "other" };
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.details.rawSnapshot += " ";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.details.record.retainedBytes++;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.details.buffers = [{ ...file, dirty: false }];
    },
  ]) {
    const f = await fixture();
    change(f);
    await expect(f.api.read(f.source)).rejects.toBeInstanceOf(LegacyBufferRecoveryError);
  }
});

it("rejects unsafe pagination and qualifications instead of silently skipping rows", async () => {
  const f = await fixture();
  f.page.records.push(f.record);
  await expect(f.api.list({ after: null, limit: 25 })).rejects.toMatchObject({
    code: "invalid-response",
  });
  f.page.records.pop();
  f.page.qualified = true;
  await expect(f.api.list({ after: null, limit: 25 })).rejects.toMatchObject({
    code: "invalid-response",
  });
  f.page.qualified = false;
  f.page.next = 2 as never;
  await expect(f.api.list({ after: null, limit: 25 })).rejects.toMatchObject({
    code: "invalid-response",
  });
});

it("retains visible uninspectable metadata without inventing a source or timestamp", async () => {
  const f = await fixture();
  f.invoke.mockResolvedValue({
    ...f.page,
    records: [
      {
        ...f.record,
        source: null,
        inspectable: false,
        ownerId: null,
        updatedAt: null,
        legacyTimestamp: "9223372036854775807",
      },
    ],
  } as never);
  const result = await f.api.list({ after: null, limit: 25 });
  expect(result.records[0]).toMatchObject({
    source: null,
    inspectable: false,
    updatedAt: null,
    legacyTimestamp: "9223372036854775807",
  });
});

it("denies unsupported runtimes before any invoke and never routes to a selected remote Host", async () => {
  const invoke = vi.fn();
  const api = createLegacyBufferRecovery({ invoke, available: () => false });
  await expect(api.list({ after: null, limit: 25 })).rejects.toMatchObject({ code: "unsupported" });
  expect(invoke).not.toHaveBeenCalled();
});

it("keeps actual request permits after waiter deadlines and releases them only on settlement", async () => {
  const f = await fixture();
  vi.useFakeTimers();
  const release: ((value: unknown) => void)[] = [];
  const invoke = vi.fn(() => new Promise((resolve) => release.push(resolve)));
  const api = createLegacyBufferRecovery({
    invoke: invoke as never,
    available: () => true,
    timeoutMs: 10,
  });
  const jobs = Array.from({ length: 4 }, () =>
    api.list({ after: null, limit: 25 }).catch((error: unknown) => error),
  );
  await vi.advanceTimersByTimeAsync(11);
  expect(
    (await Promise.all(jobs)).every(
      (error) => error instanceof LegacyBufferRecoveryError && error.code === "deadline",
    ),
  ).toBe(true);
  await expect(api.list({ after: null, limit: 25 })).rejects.toMatchObject({ code: "capacity" });
  expect(invoke).toHaveBeenCalledTimes(4);
  release.forEach((resolve) => resolve(f.page));
  await vi.advanceTimersByTimeAsync(0);
  const next = api.list({ after: null, limit: 25 });
  await vi.advanceTimersByTimeAsync(0);
  release[4](f.page);
  expect((await next).records).toHaveLength(1);
});

it("freezes a supplied source before the asynchronous native call", async () => {
  const f = await fixture();
  const source = { ...f.source };
  const read = f.api.read(source);
  source.ownerId = "changed";
  await read;
  expect(f.invoke.mock.calls[0][1]).toEqual({ source: f.source });
});
