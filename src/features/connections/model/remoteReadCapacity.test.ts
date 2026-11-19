// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { HostSession } from "./protocol";
import { loadRemoteSession, resetRemoteSessionReadsForTests } from "./connections";
import { classifyRemoteError } from "./remoteFailure";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  resetRemoteSessionReadsForTests();
});

const snapshot = (sessionId: string): HostSession => ({
  projectId: "p",
  revision: 1,
  updatedAt: 1,
  status: "running",
  session: {
    id: sessionId,
    cwd: "/tmp",
    harness: "codex",
    model: "test",
    runtimeMode: "supervised",
    title: "Test",
    blocks: [],
  },
});

/** The stalled machine never answers; the healthy machine answers at once. */
function answerOnlyHealthyMachine() {
  vi.mocked(invoke).mockImplementation(async (_command, input) => {
    const { machineId, method, params } = input as {
      machineId: string;
      method: string;
      params: { sessionId?: string };
    };
    if (machineId === "stalled") return new Promise(() => {});
    if (method === "sessions.sync") return { kind: "snapshot", value: snapshot(params.sessionId!) };
    throw new Error(method);
  });
}

it("does not let a stalled machine's pending reads refuse another machine's reads", async () => {
  answerOnlyHealthyMachine();
  // Distinct sessions give distinct read identities, so each one stays pending.
  for (let i = 0; i < 64; i += 1) void loadRemoteSession("stalled", `stalled-${i}`);

  const healthy = await loadRemoteSession("healthy", "healthy-session");
  expect(healthy.session.id).toBe("healthy-session");
  expect(healthy.status).toBe("running");
});

it("still caps the stalled machine and reports the refusal as temporary", async () => {
  answerOnlyHealthyMachine();
  for (let i = 0; i < 64; i += 1) void loadRemoteSession("stalled", `stalled-${i}`);

  const refused = await loadRemoteSession("stalled", "stalled-overflow").catch(
    (error: unknown) => error,
  );
  expect(refused).toBeInstanceOf(Error);
  expect(classifyRemoteError(refused).kind).toBe("temporary");
});

it("still joins an identical read already in flight instead of sending it again", async () => {
  answerOnlyHealthyMachine();
  const first = loadRemoteSession("healthy", "shared-session");
  const second = loadRemoteSession("healthy", "shared-session");
  await Promise.all([first, second]);

  const syncs = vi
    .mocked(invoke)
    .mock.calls.filter(([, input]) => (input as { method: string }).method === "sessions.sync");
  expect(syncs).toHaveLength(1);
});
