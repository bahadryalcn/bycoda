// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<{ shellId: string; raw: string; legacyRaw: string | null; version: number }>,
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string) => {
    if (command === "canonical_store_session_guard_ready") return true;
    if (command === "canonical_store_get") return { version: 1, value: true };
    throw new Error(`Unexpected command: ${command}`);
  }),
}));
vi.mock("./hostSessionBindingDatabase", () => ({
  readBindingEvidencePage: vi.fn(async () => state.rows),
  readBindingEvidence: vi.fn(async (id: string) => state.rows.find((row) => row.shellId === id)),
  skipImportedNativeBindingLegacy: vi.fn(),
  preserveBindingSource: vi.fn(),
  writeBindingEvidence: vi.fn(),
}));

function evidence(sessionId: string, version: number) {
  return {
    shellId: "shell",
    version,
    legacyRaw: "original",
    raw: JSON.stringify({
      shell: { id: "shell", blocks: [] },
      binding: {
        kind: "local-host",
        machineId: "machine",
        environmentId: "env",
        projectId: "project",
        sessionId,
        authorityGeneration: null,
        created: true,
      },
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  state.rows = [evidence("first", 1)];
});

it("refreshes another window's canonical owner on an unscoped admission flush", async () => {
  const storage = await import("./sessionExecutionBinding");
  await storage.hydrateHostSessionBindings();
  state.rows = [evidence("second", 2)];
  await storage.flushHostSessionBindings();
  expect(storage.hostSessionBinding({ id: "shell" })?.sessionId).toBe("second");
  state.rows = [];
  await storage.flushHostSessionBindings();
  expect(storage.hostSessionBinding({ id: "shell" })).toBeUndefined();
});

it("checks a single shell on every open and notifies readers only when its canonical evidence changes", async () => {
  const storage = await import("./sessionExecutionBinding");
  const database = await import("./hostSessionBindingDatabase");
  await storage.hydrateHostSessionBindings();
  const notify = vi.fn();
  const unsubscribe = storage.subscribeHostSessionBindings(notify);
  try {
    const shell = { id: "shell" };
    const first = storage.hostSessionBindingSnapshot(shell);
    vi.mocked(database.readBindingEvidence).mockClear();
    state.rows = [evidence("first", 1)];
    await storage.flushHostSessionBindings(shell.id);
    expect(database.readBindingEvidence).toHaveBeenCalledWith(shell.id);
    expect(notify).toHaveBeenCalledTimes(0);
    expect(storage.hostSessionBindingSnapshot(shell)).toBe(first);

    state.rows = [evidence("other-window", 2)];
    await storage.flushHostSessionBindings(shell.id);
    expect(storage.hostSessionBindingSnapshot(shell)?.sessionId).toBe("other-window");
    state.rows = [];
    await storage.flushHostSessionBindings(shell.id);
    expect(storage.hostSessionBindingSnapshot(shell)).toBeUndefined();
    await storage.flushHostSessionBindings(shell.id);
    expect(database.readBindingEvidence).toHaveBeenCalledTimes(4);
    expect(notify).toHaveBeenCalledTimes(2);
  } finally {
    unsubscribe();
  }
});

it("releases only unchanged legacy bytes after canonical migration is confirmed", async () => {
  localStorage.setItem("bycoda.host-session-binding.v1:shell", "original");
  localStorage.setItem("bycoda.host-session-binding.v1:other", "unreviewed");
  const storage = await import("./sessionExecutionBinding");
  await storage.hydrateHostSessionBindings();
  expect(localStorage.getItem("bycoda.host-session-binding.v1:shell")).toBeNull();
  expect(localStorage.getItem("bycoda.host-session-binding.v1:other")).toBe("unreviewed");
});

it("preserves legacy bytes changed since native backup", async () => {
  localStorage.setItem("bycoda.host-session-binding.v1:shell", "changed");
  const storage = await import("./sessionExecutionBinding");
  await storage.hydrateHostSessionBindings();
  expect(localStorage.getItem("bycoda.host-session-binding.v1:shell")).toBe("changed");
});

it("reads every owner page once when the first flush hydrates the window", async () => {
  const database = await import("./hostSessionBindingDatabase");
  const storage = await import("./sessionExecutionBinding");
  vi.mocked(database.readBindingEvidencePage).mockClear();
  await storage.flushHostSessionBindings();
  expect(database.readBindingEvidencePage).toHaveBeenCalledTimes(1);
  expect(storage.hostSessionBinding({ id: "shell" })?.sessionId).toBe("first");
  // A hydrated window still re-reads on the next admission flush.
  state.rows = [evidence("second", 2)];
  await storage.flushHostSessionBindings();
  expect(database.readBindingEvidencePage).toHaveBeenCalledTimes(2);
  expect(storage.hostSessionBinding({ id: "shell" })?.sessionId).toBe("second");
});

it("re-reads after joining a hydration another caller started", async () => {
  const database = await import("./hostSessionBindingDatabase");
  const storage = await import("./sessionExecutionBinding");
  vi.mocked(database.readBindingEvidencePage).mockClear();
  const hydrating = storage.hydrateHostSessionBindings();
  await storage.flushHostSessionBindings();
  await hydrating;
  expect(database.readBindingEvidencePage).toHaveBeenCalledTimes(2);
});
