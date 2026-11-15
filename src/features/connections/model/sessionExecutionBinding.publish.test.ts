// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../sessions/model/session";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string) => {
    if (command === "canonical_store_session_guard_ready") return true;
    if (command === "canonical_store_get") return { version: 1, value: true };
    throw new Error(`Unexpected command: ${command}`);
  }),
}));
const database = vi.hoisted(() => ({
  writeBindingEvidence: vi.fn(),
  rows: new Map<string, unknown>(),
}));
vi.mock("./hostSessionBindingDatabase", () => ({
  readBindingEvidencePage: vi.fn(async () => [...database.rows.values()]),
  readBindingEvidence: vi.fn(async (id: string) => database.rows.get(id)),
  skipImportedNativeBindingLegacy: vi.fn(),
  preserveBindingSource: vi.fn(),
  writeBindingEvidence: database.writeBindingEvidence,
}));

const binding = {
  kind: "local-host" as const,
  machineId: "machine",
  environmentId: "env",
  projectId: "project",
  sessionId: "host-session",
  authorityGeneration: null,
  created: true,
};

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  database.rows.clear();
  database.writeBindingEvidence.mockReset();
  database.writeBindingEvidence.mockImplementation(
    async (_previous: unknown, next: { shellId: string }) => {
      database.rows.set(next.shellId, next);
    },
  );
});

it("publishes nothing when a streamed snapshot changes no stored field", async () => {
  const storage = await import("./sessionExecutionBinding");
  await storage.hydrateHostSessionBindings();
  const shell = { ...newSession("codex", "/repo"), title: "Work" };
  const saved = storage.saveHostSessionBinding(shell, binding);
  await storage.flushHostSessionBindings();
  expect(database.writeBindingEvidence).toHaveBeenCalledTimes(1);
  const revision = storage.hostSessionBindingRevision();
  storage.saveHostSessionBinding(
    {
      ...saved,
      modelSettings: { ...saved.modelSettings },
      blocks: [{ id: "reply", role: "assistant", text: "streamed", streaming: true }],
    },
    { ...binding },
  );
  expect(storage.hostSessionBindingRevision()).toBe(revision);
  expect(storage.hostSessionBindingsPending()).toBe(false);
  storage.saveHostSessionBinding({ ...saved, title: "Renamed" }, binding);
  await storage.flushHostSessionBindings("shell-unused");
  expect(database.writeBindingEvidence).toHaveBeenCalledTimes(2);
});

it("settles a failed owner write and keeps publishing the ones after it", async () => {
  const storage = await import("./sessionExecutionBinding");
  await storage.hydrateHostSessionBindings();
  const shell = newSession("codex", "/repo");
  database.writeBindingEvidence.mockRejectedValueOnce(new Error("disk full"));
  storage.saveHostSessionBinding(shell, binding);
  await expect(storage.flushHostSessionBindings()).rejects.toThrow("disk full");
  expect(storage.hostSessionBindingsPending()).toBe(false);
  storage.saveHostSessionBinding({ ...shell, title: "Again" }, binding);
  await expect(storage.flushHostSessionBindings()).resolves.toBeUndefined();
  expect(storage.hostSessionBindingsPending()).toBe(false);
  expect(database.writeBindingEvidence).toHaveBeenCalledTimes(2);
});

it("coalesces owner writes queued behind one in flight to the latest", async () => {
  const storage = await import("./sessionExecutionBinding");
  await storage.hydrateHostSessionBindings();
  const shell = newSession("codex", "/repo");
  let release!: () => void;
  database.writeBindingEvidence.mockImplementationOnce(
    (_previous: unknown, next: { shellId: string }) =>
      new Promise<void>((resolve) => {
        release = () => {
          database.rows.set(next.shellId, next);
          resolve();
        };
      }),
  );
  storage.saveHostSessionBinding({ ...shell, title: "One" }, binding);
  storage.saveHostSessionBinding({ ...shell, title: "Two" }, binding);
  storage.saveHostSessionBinding({ ...shell, title: "Three" }, binding);
  release();
  await storage.flushHostSessionBindings();
  expect(database.writeBindingEvidence).toHaveBeenCalledTimes(2);
  const [previous, latest] = database.writeBindingEvidence.mock.calls[1] as [
    { raw: string },
    { raw: string },
  ];
  expect(JSON.parse(previous.raw).shell.title).toBe("One");
  expect(JSON.parse(latest.raw).shell.title).toBe("Three");
});
