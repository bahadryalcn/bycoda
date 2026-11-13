import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostStore } from "../store";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { cancelSessionWorkOccurrence, cancelSessionWorkRun } from "../work/session-adapter";
import { RoomAutomationSessionChildren } from "./room-session-children";
vi.mock("../work/session-adapter", () => ({
  cancelSessionWorkOccurrence: vi.fn(async () => undefined),
  cancelSessionWorkRun: vi.fn(async () => true),
}));
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.clearAllMocks();
});

it("binds accepted session runs before provider admission and Stop cannot cancel a later owner run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "room-session-child-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  let active = true;
  let receipt: Awaited<ReturnType<HostStore["receiptStatus"]>>;
  let current = {
    session: { id: "session" },
    projectId: "project",
    revision: 1,
    status: "idle",
  } as HostSession;
  vi.spyOn(store, "session").mockImplementation(async () => current);
  vi.spyOn(store, "receiptStatus").mockImplementation(async () => receipt);
  const engine = { command: vi.fn() };
  const children = new RoomAutomationSessionChildren(
    store,
    async () => active,
    () => engine as never,
  );
  const call = {
    threadId: "room",
    projectId: "project",
    family: "conversation" as const,
    action: "sessions.submit",
    input: { sessionId: "session", expectedRevision: 1, text: "Work" },
    requestId: "original",
  };
  await children.withChild(
    call,
    { workId: "parent", occurrence: "occurrence" },
    async () => true,
    async () => {
      const row = await store.db
        .prepare("SELECT value FROM metadata WHERE key='room-session-child:original'")
        .get();
      expect(JSON.parse(String(row!.value))).toMatchObject({
        workId: "parent",
        occurrence: "occurrence",
        sessionId: "session",
        commandId: expect.stringMatching(/^room-session-/),
      });
      expect(await children.allowed("session", "accepted-run", "original")).toBe(false);
      receipt = { sessionId: "session", runId: "accepted-run" } as NonNullable<typeof receipt>;
      current = { ...current, status: "running", runId: "accepted-run" };
      expect(await children.allowed("session", "accepted-run", "original")).toBe(true);
    },
  );
  active = false;
  expect(await children.allowed("session", "accepted-run", "original")).toBe(false);
  await children.stop("occurrence");
  expect(cancelSessionWorkOccurrence).toHaveBeenCalledWith(store, {
    kind: "assistant",
    id: "room:room",
    occurrence: expect.stringMatching(/^room-session-/),
  });
  expect(cancelSessionWorkRun).toHaveBeenCalledExactlyOnceWith(store, {
    sessionId: "session",
    runId: "accepted-run",
  });
  vi.mocked(cancelSessionWorkRun).mockClear();
  current = { ...current, runId: "later-owner-run" };
  await children.stop("occurrence");
  expect(cancelSessionWorkRun).not.toHaveBeenCalled();
  expect(engine.command).not.toHaveBeenCalled();
});
