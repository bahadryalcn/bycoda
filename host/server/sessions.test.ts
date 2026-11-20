import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDomainRefusalError } from "../domains/context";
import { HostStore } from "../store";
import type { ServerBindings } from "./bindings";
import { createSessionQueueRuntime } from "./session-queue";
import { createSessionsRuntime } from "./sessions";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-sessions-runtime-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  cleanup.push(() => store.close());
  await store.ready;
  await store.addProject(directory, "Fixture");
  const desktop = {
    samePath: (a: string, b: string) => a === b,
    pathKey: (path: string) => path,
    metadataAsync: async (id: string) =>
      id === "desktop-only" ? { cwd: directory, harness: "codex", running: true } : undefined,
  };
  const runtime = await createSessionsRuntime(
    {
      engine: { store },
      desktop,
      providers: ["codex"],
      assertHostMayRun: async () => {},
      refresh: async () => {},
    } as unknown as Pick<
      ServerBindings,
      "engine" | "desktop" | "assertHostMayRun" | "providers" | "refresh"
    >,
    () => {},
  );
  return runtime;
}

it("refuses a queue existence check for a session nobody stores as not sent", async () => {
  const runtime = await fixture();
  expect(await runtime.queueSessionKnown("desktop-only")).toBe("running");
  for (const running of [false, true]) {
    const error = await runtime.queueSessionKnown("missing", running).catch((cause) => cause);
    expect(error).toBeInstanceOf(HostDomainRefusalError);
    expect(error).toMatchObject({
      message: "Session not found on this machine",
      category: "validation",
      retryable: false,
      delivery: "not-sent",
    });
  }
});

it("checks the desktop run holder for an adopted session without loading its transcript", async () => {
  const store = {
    session: vi.fn(async () => ({ projectId: "project", desktop: {}, status: "idle" })),
    sessionStateMetadata: vi.fn(async () => ({
      projectId: "project",
      desktop: true,
      status: "idle",
    })),
  };
  const stampAsync = vi.fn(async () => ({ updatedAt: 1, running: true }));
  const runtime = await createSessionQueueRuntime(
    {
      engine: { store, recoveredInterrupted: [] },
      desktop: { stampAsync, live: { overlay: () => undefined, runningClient: () => undefined } },
      runLeases: { holder: () => undefined },
      sessionQueues: {},
    } as unknown as Parameters<typeof createSessionQueueRuntime>[0],
    () => {},
  );
  expect(await runtime.desktopRunHolder("adopted")).toBe("desktop");
  expect(await runtime.desktopWatch("adopted")).toMatchObject({ projectId: "project" });
  stampAsync.mockResolvedValue({ updatedAt: 2, running: false });
  expect(await runtime.desktopRunHolder("adopted")).toBeUndefined();
  expect(store.session).not.toHaveBeenCalled();
});
