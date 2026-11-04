// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as Array<{ shellId: string; raw: string; legacyRaw: string | null; version: number }> }));
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
    shellId: "shell", version, legacyRaw: "original",
    raw: JSON.stringify({
      shell: { id: "shell", blocks: [] },
      binding: { kind: "local-host", machineId: "machine", environmentId: "env", projectId: "project", sessionId, authorityGeneration: null, created: true },
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
