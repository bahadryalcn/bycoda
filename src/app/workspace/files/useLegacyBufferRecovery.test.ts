// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useLegacyBufferRecovery } from "./useLegacyBufferRecovery";
import type { LegacyBufferReport } from "../../../features/files/data/legacyBufferRecovery";

const record: LegacyBufferReport = {
  source: {
    sourceStoreId: "s",
    sourceProfileId: "p",
    ownerId: "main",
    reportVersion: 1,
    snapshotDigest: "a".repeat(64),
  },
  reportVersion: 1,
  ownerId: "main",
  kind: "legacy",
  windowLabel: "Earlier",
  updatedAt: 1,
  legacyTimestamp: null,
  retainedBytes: 2,
  current: false,
  held: true,
  confirmed: false,
  contentAvailable: false,
  inspectable: true,
};
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  container?.remove();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function mount() {
  let permitted = true;
  let privacyRevision = 0;
  let enabled = true;
  const api = {
    available: () => true,
    list: vi.fn().mockResolvedValue({ records: [record], next: 1, qualified: false }),
    read: vi.fn().mockResolvedValue({
      record,
      buffers: [{ path: "C:\\repo\\draft.txt", dirty: true }],
      contentAvailable: false,
      qualified: false,
    }),
  };
  let value!: ReturnType<typeof useLegacyBufferRecovery>;
  function Probe() {
    value = useLegacyBufferRecovery({
      enabled,
      canInspect: () => permitted,
      getPrivacySnapshot: () => privacyRevision,
      api,
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
    api,
    get value() {
      return value;
    },
    render,
    lock: () => {
      permitted = false;
      privacyRevision++;
    },
    unlock: () => {
      permitted = true;
      privacyRevision++;
    },
    disable: () => {
      enabled = false;
    },
  };
}
it("does not auto-read Native metadata or text even under StrictMode", async () => {
  const f = await mount();
  expect(f.api.list).not.toHaveBeenCalled();
  expect(f.api.read).not.toHaveBeenCalled();
  await act(() => f.value.refresh());
  expect(f.value.loaded).toBe(true);
  expect(f.value.records).toEqual([record]);
});
it("rejects late list and read replies after privacy ABA without an intermediate render", async () => {
  for (const kind of ["list", "read"] as const) {
    const f = await mount();
    const pending = deferred<any>();
    const outcome = await (kind === "read" ? f.api.read() : f.api.list({ after: null, limit: 25 }));
    f.api[kind].mockReturnValueOnce(pending.promise);
    let job!: Promise<void>;
    await act(async () => {
      job = kind === "read" ? f.value.inspect(record) : f.value.refresh();
    });
    f.lock();
    f.unlock();
    pending.resolve(outcome);
    await act(() => job);
    expect(f.value.details).toBeNull();
    expect(f.value.records).toEqual([]);
    expect(f.value.pending).toBeNull();
    expect(f.value.error).toBe(false);
    await act(() => root!.unmount());
    root = undefined;
    container.remove();
  }
});
it("keeps the previous page/cursor after a failed next and retries the same cursor", async () => {
  const f = await mount();
  await act(() => f.value.refresh());
  f.api.list.mockRejectedValueOnce(new Error("unavailable"));
  await act(() => f.value.next());
  expect(f.value.error).toBe(true);
  expect(f.value.records).toEqual([record]);
  expect(f.value.hasPrevious).toBe(false);
  f.api.list.mockResolvedValueOnce({
    records: [{ ...record, reportVersion: 2 }],
    next: null,
    qualified: false,
  });
  await act(() => f.value.next());
  expect(f.api.list.mock.calls.slice(-2).map(([request]) => request.after)).toEqual([1, 1]);
  expect(f.value.hasPrevious).toBe(true);
  await act(() => f.value.previous());
  expect(f.api.list).toHaveBeenLastCalledWith({ after: null, limit: 25 });
});
it("joins duplicate UI inspection attempts and keeps failure local to its report", async () => {
  const f = await mount();
  const pending = deferred<never>();
  f.api.read.mockReturnValueOnce(pending.promise);
  let first!: Promise<void>;
  await act(async () => {
    first = f.value.inspect(record);
    void f.value.inspect(record);
  });
  expect(f.api.read).toHaveBeenCalledTimes(1);
  expect(f.value.pending).not.toBeNull();
  // A read-only waiter may close without canceling the actual Native request.
  await act(async () => {
    f.value.closeDetails();
  });
  expect(f.value.pending).toBeNull();
  pending.resolve(undefined as never);
  await act(() => first);
  expect(f.value.details).toBeNull();
  f.api.read.mockRejectedValueOnce(new Error("changed"));
  await act(() => f.value.inspect(record));
  expect(f.value.readError).not.toBeNull();
  expect(f.value.details).toBeNull();
});
it("rechecks privacy before and after awaits, including lock→unlock before a late reply", async () => {
  const f = await mount();
  const pending = deferred<Awaited<ReturnType<typeof f.api.read>>>();
  f.api.read.mockReturnValueOnce(pending.promise);
  let read!: Promise<void>;
  await act(async () => {
    read = f.value.inspect(record);
  });
  f.lock();
  await f.render();
  expect(f.value.records).toHaveLength(0);
  expect(container.textContent).toBe("concealed");
  f.unlock();
  await f.render();
  pending.resolve({
    record,
    buffers: [{ path: "C:\\secret\\draft.txt", dirty: true }],
    contentAvailable: false,
    qualified: false,
  });
  await act(() => read);
  expect(f.value.details).toBeNull();
  f.lock();
  await act(() => f.value.inspect(record));
  expect(f.api.read).toHaveBeenCalledTimes(1);
});
it("does not publish a late list after disable/unmount or read uninspectable sources", async () => {
  const f = await mount();
  await act(() => f.value.inspect({ ...record, source: null, inspectable: false }));
  expect(f.api.read).not.toHaveBeenCalled();
  const pending = deferred<unknown>();
  f.api.list.mockReturnValueOnce(pending.promise);
  let load!: Promise<void>;
  await act(async () => {
    load = f.value.refresh();
  });
  f.disable();
  await f.render();
  pending.resolve({ records: [record], next: null, qualified: false });
  await act(() => load);
  expect(f.value.records).toHaveLength(0);
});
