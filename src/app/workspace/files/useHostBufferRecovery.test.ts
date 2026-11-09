// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useHostBufferRecovery } from "./useHostBufferRecovery";
import type {
  HostBufferPage,
  HostBufferReport,
  HostBufferDetails,
} from "../../../features/files/data/hostBufferRecovery";
type HostApi = typeof import("../../../features/files/data/hostBufferRecovery").hostBufferRecovery;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const context = Object.freeze({
  hostEnvironmentId: "selected-host",
  sourceStoreId: "store",
  sourceProfileId: "profile",
  nativeStoreInstance: "c98f2726-d8bd-4934-8fc4-baff94b520a2",
  clientId: "c".repeat(64),
});
const cursor = Object.freeze({
  version: 1 as const,
  cursorId: "794580cf-1838-4ffb-b518-a32d0e5de003",
  page: 1,
});
const record: HostBufferReport = Object.freeze({
  key: "selected-row",
  source: Object.freeze({
    reportId: "a".repeat(64),
    reportVersion: 2,
    ownerId: "owner",
    ownerVersion: 3,
    snapshotDigest: "b".repeat(64),
  }),
  context,
  clientId: context.clientId,
  instanceId: "instance",
  processId: 1,
  updatedAt: 5,
  byteLength: 500,
  retainedBytes: 500,
  bufferCount: 1,
  dirtyCount: 1,
  unknown: false,
  provenance: Object.freeze({
    version: 2 as const,
    sourceStoreId: "store",
    sourceProfileId: "profile",
    storeInstance: null,
    windowIncarnation: null,
    kind: "legacy" as const,
    reportVersion: 1,
    reportNonce: null,
    snapshotDigest: "d".repeat(64),
  }),
  lineage: "legacy",
  ownerMissing: false,
  compatibilityHoldId: "e".repeat(64),
  verification: "metadata-only",
  retention: "held",
  inspectable: true,
  qualified: false,
  resolution: "unsupported",
  ownerId: "owner",
  reportVersion: 2,
  windowLabel: null,
  kind: "legacy",
  current: false,
  held: true,
  contentAvailable: false,
});
const page = (rows: readonly HostBufferReport[] = [record]): HostBufferPage => ({
  version: 1,
  qualified: false,
  resolution: "unsupported",
  context,
  records: rows,
  next: cursor,
  incomplete: false,
  duplicatesPossible: false,
  unavailable: false,
});
const details: HostBufferDetails = Object.freeze({
  record,
  buffers: [{ path: "C:\\repo\\draft.txt", dirty: true }],
  qualified: false,
  resolution: "unsupported",
  contentAvailable: false,
});
let root: Root | null = null;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
});
async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let enabled = true;
  let permitted = true;
  let privacy = 0;
  let available = true;
  let limit = 25;
  let api = {
    available: () => available,
    list: vi.fn(async (_input: Parameters<HostApi["list"]>[0], _wait?: { signal?: AbortSignal }) =>
      page(),
    ),
    read: vi.fn(async (_record: HostBufferReport) => details),
  };
  let value!: ReturnType<typeof useHostBufferRecovery>;
  function Probe() {
    value = useHostBufferRecovery({
      enabled,
      canInspect: () => permitted,
      getPrivacySnapshot: () => privacy,
      api,
      limit,
    });
    return createElement(
      "span",
      null,
      value.details?.buffers[0]?.path ?? (value.visible ? "visible" : "concealed"),
    );
  }
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const render = () =>
    act(() => root!.render(createElement(StrictMode, null, createElement(Probe))));
  await render();
  return {
    get value() {
      return value;
    },
    get api() {
      return api;
    },
    render,
    lock: () => {
      permitted = false;
      privacy++;
    },
    unlock: () => {
      permitted = true;
      privacy++;
    },
    disable: () => {
      enabled = false;
    },
    enable: () => {
      enabled = true;
    },
    unavailable: () => {
      available = false;
    },
    limit: (next: number) => {
      limit = next;
    },
    replaceApi: () => {
      api = { ...api, list: vi.fn(async () => page()), read: vi.fn(async () => details) };
    },
  };
}
it("performs no automatic list/read/status in StrictMode and publishes explicit scoped data", async () => {
  const f = await mount();
  expect(f.api.list).not.toHaveBeenCalled();
  expect(f.api.read).not.toHaveBeenCalled();
  await act(() => f.value.refresh());
  expect(f.value.records).toEqual([record]);
  expect(f.value.loaded).toBe(true);
  expect(f.api.list).toHaveBeenCalledWith(
    { after: null, limit: 25 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  await act(() => f.value.inspect(record));
  expect(f.value.details?.record).toBe(record);
  expect(f.value.detailsAreCurrent()).toBe(true);
});
it("continues an empty page using exactly its opaque cursor/context, then previous pins the same context", async () => {
  const f = await mount();
  f.api.list.mockResolvedValueOnce({ ...page([]), unavailable: true, incomplete: true });
  await act(() => f.value.refresh());
  expect(f.value.hasNext).toBe(true);
  expect(f.value.records).toEqual([]);
  expect(f.value.unavailable).toBe(true);
  const newer = { ...record, key: "selected-row-newer", reportVersion: 3 };
  f.api.list.mockResolvedValueOnce({ ...page([newer]), next: null });
  await act(() => f.value.next());
  expect(f.api.list).toHaveBeenLastCalledWith(
    { after: cursor, expectedContext: context, limit: 25 },
    expect.anything(),
  );
  expect(f.value.hasPrevious).toBe(true);
  expect(f.value.records.map((item) => item.reportVersion)).toEqual([3]);
  await act(() => f.value.previous());
  expect(f.value.records.map((item) => item.reportVersion)).toEqual([2, 3]);
  expect(f.api.list).toHaveBeenLastCalledWith(
    { after: null, expectedContext: context, limit: 25 },
    expect.anything(),
  );
});
it("failed list keeps prior page and retries the same exact cursor instead of skipping a page", async () => {
  const f = await mount();
  await act(() => f.value.refresh());
  f.api.list.mockRejectedValueOnce(new Error("private Native failure"));
  await act(() => f.value.next());
  expect(f.value.records).toEqual([record]);
  expect(f.value.error).toBe(true);
  expect(f.value.hasPrevious).toBe(false);
  f.api.list.mockResolvedValueOnce({ ...page(), next: null });
  await act(() => f.value.next());
  expect(f.api.list.mock.calls.slice(-2).map(([input]) => input)).toEqual([
    { after: cursor, expectedContext: context, limit: 25 },
    { after: cursor, expectedContext: context, limit: 25 },
  ]);
});
it("keeps read failure local and duplicate inspection owns only one actual request", async () => {
  const f = await mount();
  await act(() => f.value.refresh());
  const gate = deferred<HostBufferDetails>();
  f.api.read.mockReturnValueOnce(gate.promise);
  let a!: Promise<void>;
  let b!: Promise<void>;
  await act(async () => {
    a = f.value.inspect(record);
    b = f.value.inspect(record);
  });
  expect(a).toBe(b);
  expect(f.api.read).toHaveBeenCalledTimes(1);
  expect(f.value.pending).toBe(record.key);
  gate.reject(new Error("secret path"));
  await act(() => a);
  expect(f.value.readError).toBe(record.key);
  expect(f.value.details).toBeNull();
  await act(() => f.value.inspect(record));
  expect(f.value.details?.record).toBe(record);
  expect(f.value.readError).toBeNull();
});
it("rejects foreign/old row objects and a returned different selection", async () => {
  const f = await mount();
  await act(() => f.value.refresh());
  await act(() => f.value.inspect({ ...record }));
  expect(f.api.read).not.toHaveBeenCalled();
  f.api.read.mockResolvedValueOnce({ ...details, record: { ...record, key: "different" } });
  await act(() => f.value.inspect(record));
  expect(f.value.details).toBeNull();
  expect(f.value.readError).toBe(record.key);
  const old = f.value.records[0]!;
  const changed = { ...record, key: "new" };
  f.api.list.mockResolvedValueOnce(page([changed]));
  await act(() => f.value.refresh());
  await act(() => f.value.inspect(old));
  expect(f.api.read).toHaveBeenCalledTimes(1);
});
it("privacy transition conceals data synchronously on render and rejects old replies after unlock", async () => {
  const f = await mount();
  await act(() => f.value.refresh());
  const gate = deferred<HostBufferDetails>();
  f.api.read.mockReturnValueOnce(gate.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = f.value.inspect(record);
  });
  f.lock();
  await f.render();
  expect(f.value.records).toEqual([]);
  expect(f.value.pending).toBeNull();
  expect(container.textContent).toBe("concealed");
  f.unlock();
  await f.render();
  gate.resolve(details);
  await act(() => pending);
  expect(f.value.details).toBeNull();
  expect(f.value.records).toEqual([]);
  expect(f.value.detailsAreCurrent()).toBe(false);
});
it("privacy ABA without an intermediate render rejects pending results and invalidates the old page", async () => {
  const f = await mount();
  await act(() => f.value.refresh());
  const gate = deferred<HostBufferDetails>();
  f.api.read.mockReturnValueOnce(gate.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = f.value.inspect(record);
  });
  f.lock();
  f.unlock();
  gate.resolve(details);
  await act(() => pending);
  expect(f.value.details).toBeNull();
  expect(f.value.records).toEqual([]);
  expect(f.value.hasNext).toBe(false);
  await act(() => f.value.next());
  expect(f.api.list).toHaveBeenCalledTimes(1);
});
it("changing API/limit/local Native availability invalidates data and old continuations", async () => {
  const f = await mount();
  await act(() => f.value.refresh());
  f.limit(50);
  await f.render();
  expect(f.value.records).toEqual([]);
  await act(() => f.value.next());
  expect(f.api.list).toHaveBeenCalledTimes(1);
  await act(() => f.value.refresh());
  expect(f.api.list).toHaveBeenLastCalledWith({ after: null, limit: 50 }, expect.anything());
  f.replaceApi();
  await f.render();
  expect(f.value.records).toEqual([]);
  await act(() => f.value.previous());
  expect(f.api.list).not.toHaveBeenCalled();
  await act(() => f.value.refresh());
  f.unavailable();
  await f.render();
  expect(f.value.available).toBe(false);
  expect(f.value.records).toEqual([]);
});
it("closing details does not falsely cancel an unrelated in-flight list or leave it loading forever", async () => {
  const f = await mount();
  const gate = deferred<HostBufferPage>();
  f.api.list.mockReturnValueOnce(gate.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = f.value.refresh();
    f.value.closeDetails();
  });
  gate.resolve(page());
  await act(() => pending);
  expect(f.value.loading).toBe(false);
  expect(f.value.records).toEqual([record]);
});
it("close/refresh/unmount prevent late reads while the actual accepted promise still owns its settlement", async () => {
  const f = await mount();
  await act(() => f.value.refresh());
  const gate = deferred<HostBufferDetails>();
  f.api.read.mockReturnValueOnce(gate.promise);
  let pending!: Promise<void>;
  await act(async () => {
    pending = f.value.inspect(record);
  });
  await act(() => f.value.closeDetails());
  expect(f.value.pending).toBeNull();
  expect(f.value.detailsAreCurrent()).toBe(false);
  await act(() => f.value.refresh());
  gate.resolve(details);
  await act(() => pending);
  expect(f.value.details).toBeNull();
  const last = deferred<HostBufferPage>();
  f.api.list.mockReturnValueOnce(last.promise);
  let list!: Promise<void>;
  await act(async () => {
    list = f.value.refresh();
  });
  await act(() => root!.unmount());
  root = null;
  last.resolve(page());
  await list;
});
it("bounds previous-page history without silently dropping earlier routes", async () => {
  const f = await mount();
  await act(() => f.value.refresh());
  for (let index = 0; index < 32; index++) await act(() => f.value.next());
  const count = f.api.list.mock.calls.length;
  await act(() => f.value.next());
  expect(f.api.list).toHaveBeenCalledTimes(count);
  expect(f.value.error).toBe(true);
  expect(f.value.hasPrevious).toBe(true);
  await act(() => f.value.refresh());
  expect(f.value.hasPrevious).toBe(false);
});

it("a captured old details guard cannot authorize paths from an earlier selection after a newer inspection", async () => {
  const f = await mount();
  await act(() => f.value.refresh());
  await act(() => f.value.inspect(record));
  const oldGuard = f.value.detailsAreCurrent;
  expect(oldGuard()).toBe(true);
  await act(() => f.value.closeDetails());
  const newer = Object.freeze({
    ...record,
    key: "newer-selection",
    source: { ...record.source, ownerId: "other-owner" },
  });
  f.api.list.mockResolvedValueOnce(page([newer]));
  await act(() => f.value.refresh());
  f.api.read.mockResolvedValueOnce({ ...details, record: newer });
  await act(() => f.value.inspect(newer));
  expect(f.value.detailsAreCurrent()).toBe(true);
  expect(oldGuard()).toBe(false);
});
