// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Handler = (event: { payload: { scope: string; revision: number } }) => void;

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (event: unknown) => void>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: native.invoke }));
vi.mock("../../../platform/tauri/listenWindow", () => ({
  listenWindowAsync: async (name: string, handler: (event: unknown) => void) => {
    native.listeners.set(name, handler);
    return () => native.listeners.delete(name);
  },
}));

const FOLDERS = "bycoda.sessionFolders";
const ORDER = "bycoda.sessionOrder";
let revision = 1;
let folders: Record<string, unknown> = { "/project": [] };

function reads() {
  return native.invoke.mock.calls.filter(([command]) => command === "canonical_store_read").length;
}

async function mount() {
  const store = await import("./sessionOrganizationStore");
  const onChange = vi.fn();
  const unsubscribe = store.subscribeSessionOrganization(onChange, (error) => {
    throw error;
  });
  await vi.advanceTimersByTimeAsync(0);
  return { store, onChange, unsubscribe };
}

const emit = (scope: string, at: number) =>
  (native.listeners.get("canonical-store-changed") as Handler)({
    payload: { scope, revision: at },
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  native.invoke.mockReset();
  native.listeners.clear();
  revision = 1;
  folders = { "/project": [] };
  native.invoke.mockImplementation(async (command: string) => {
    if (command !== "canonical_store_read") throw new Error(`Unexpected ${command}`);
    return {
      revision,
      entries: [
        { key: FOLDERS, version: revision, value: JSON.stringify(folders) },
        { key: ORDER, version: 1, value: "{}" },
      ],
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

it("publishes once for a subscriber and not again while the revision is unchanged", async () => {
  const { onChange, unsubscribe } = await mount();
  expect(onChange).toHaveBeenCalledTimes(1);

  const before = reads();
  await vi.advanceTimersByTimeAsync(90_000);
  expect(reads()).toBeGreaterThan(before);
  expect(onChange).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it("polls slowly instead of every five seconds", async () => {
  const { unsubscribe } = await mount();
  const before = reads();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reads()).toBe(before);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(reads()).toBe(before + 1);
  unsubscribe();
});

it("publishes a change made by another process on the next poll", async () => {
  const { store, onChange, unsubscribe } = await mount();
  revision = 2;
  folders = { "/project": [{ id: "a", name: "A", sessionIds: [], collapsed: false }] };
  await vi.advanceTimersByTimeAsync(30_000);
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(store.cachedSessionOrganization()?.folders).toEqual(folders);
  unsubscribe();
});

it("refreshes on a changed revision event and ignores the revision it already holds", async () => {
  const { onChange, unsubscribe } = await mount();
  const before = reads();

  emit("session-organization.v1", 1);
  await vi.advanceTimersByTimeAsync(0);
  expect(reads()).toBe(before);

  revision = 2;
  folders = { "/project": [{ id: "b", name: "B", sessionIds: [], collapsed: true }] };
  emit("session-organization.v1", 2);
  await vi.advanceTimersByTimeAsync(0);
  expect(reads()).toBe(before + 1);
  expect(onChange).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it("still notifies on a pin-saga change that leaves the organization revision alone", async () => {
  const { onChange, unsubscribe } = await mount();
  emit("session-pin-saga.v1", 7);
  await vi.advanceTimersByTimeAsync(0);
  expect(onChange).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it("notifies a second subscriber from the unchanged cache and on focus", async () => {
  const first = await mount();
  const onChange = vi.fn();
  const unsubscribe = first.store.subscribeSessionOrganization(onChange, (error) => {
    throw error;
  });
  await vi.advanceTimersByTimeAsync(0);
  // The revision is unchanged since the first subscriber, yet a new one still gets its snapshot.
  expect(onChange).toHaveBeenCalledTimes(1);

  const heard = onChange.mock.calls.length;
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(0);
  expect(onChange.mock.calls.length).toBeGreaterThan(heard);
  unsubscribe();
  first.unsubscribe();
});

it("hands readers copies, so mutating a result never changes the cache", async () => {
  const { store, unsubscribe } = await mount();
  const hydrated = await store.hydrateSessionOrganization();
  hydrated.folders["/project"] = ["mutated"];
  const cachedCopy = store.cachedSessionOrganization();
  expect(cachedCopy?.folders["/project"]).toEqual([]);
  (cachedCopy as { folders: Record<string, unknown> }).folders["/project"] = ["mutated"];
  expect(store.cachedSessionOrganization()?.folders["/project"]).toEqual([]);
  unsubscribe();
});

it("lets an explicit hydrate notify even when the revision is unchanged", async () => {
  const { store, onChange, unsubscribe } = await mount();
  await store.hydrateSessionOrganization();
  expect(onChange).toHaveBeenCalledTimes(2);
  unsubscribe();
});
