import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccountPlatformRuntime } from "./account-platform";
import type { ServerBindings } from "./bindings";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "account-platform-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function fakes() {
  const dispatch = vi.fn(async () => ({ ok: true }));
  const change = vi.fn(async () => ({}));
  const deleteQueue = vi.fn(async () => undefined);
  const onSettled = vi.fn(async () => undefined);
  const dependencies = {
    featureDirectory: directory,
    engine: {
      onSettled,
      store: { projects: vi.fn(async () => []), summaries: vi.fn(async () => []) },
      command: vi.fn(),
    },
    tasks: { list: vi.fn(async () => []), move: vi.fn(), onDelete: undefined },
    sessionQueues: { get: vi.fn(async () => ({ messages: [] })), delete: deleteQueue },
    queueSessionKnown: vi.fn(async () => "idle"),
    hostRuns: vi.fn(async () => false),
    commandService: { dispatch },
    sessionQueueService: { change },
  } as unknown as Pick<
    ServerBindings,
    | "engine"
    | "featureDirectory"
    | "tasks"
    | "sessionQueues"
    | "queueSessionKnown"
    | "hostRuns"
    | "commandService"
    | "sessionQueueService"
  >;
  return { dependencies, dispatch, change };
}

const context = { authorized: async () => true, principalId: "p" } as never;

describe("account platform wiring", () => {
  it("new work wakes a settled session; Stop and other sessions do not", async () => {
    const { dependencies, dispatch, change } = fakes();
    const runtime = await createAccountPlatformRuntime(dependencies);
    runtime.stop();
    await runtime.lifecycle.settle("s1", context);
    await runtime.lifecycle.settle("s2", context);

    await dependencies.commandService.dispatch({ type: "cancel", sessionId: "s1" }, context);
    await dependencies.commandService.dispatch({ type: "send", sessionId: "s2" }, context);
    expect((await runtime.lifecycle.get("s1")).state).toBe("settled");
    expect((await runtime.lifecycle.get("s2")).state).toBe("active");

    await dependencies.sessionQueueService.change(
      { sessionId: "s1" },
      context as never,
      {} as never,
    );
    expect((await runtime.lifecycle.get("s1")).state).toBe("active");
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("a refused command leaves the session settled", async () => {
    const { dependencies, dispatch } = fakes();
    const runtime = await createAccountPlatformRuntime(dependencies);
    runtime.stop();
    await runtime.lifecycle.settle("s1", context);
    dispatch.mockRejectedValueOnce(new Error("busy"));
    await expect(
      dependencies.commandService.dispatch({ type: "send", sessionId: "s1" }, context),
    ).rejects.toThrow("busy");
    expect((await runtime.lifecycle.get("s1")).state).toBe("settled");
  });

  it("drops the lifecycle row and task link of a deleted session", async () => {
    const { dependencies } = fakes();
    const runtime = await createAccountPlatformRuntime(dependencies);
    runtime.stop();
    await runtime.lifecycle.settle("s1", context);
    await dependencies.sessionQueues.delete("s1");
    expect((await runtime.lifecycle.get("s1")).state).toBe("active");
  });
});
