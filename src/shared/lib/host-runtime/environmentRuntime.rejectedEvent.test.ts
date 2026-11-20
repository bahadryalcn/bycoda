import { afterEach, expect, it, vi } from "vitest";
import { EnvironmentRuntime } from "./environmentRuntime";
import type { ManagedHostConnectionPort, ManagedHostEvent } from "./ports";

const runtimes: EnvironmentRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
});
async function flush() {
  for (let index = 0; index < 40; index++) await Promise.resolve();
}

/** A port whose native side keeps sending an event that fails schema validation. */
function setup() {
  let listener: ((event: ManagedHostEvent) => void) | undefined;
  let onRejected: (() => void) | undefined;
  const port: ManagedHostConnectionPort = {
    listen: vi.fn(async (callback, rejected) => {
      listener = callback;
      onRejected = rejected;
      return () => {};
    }),
    // Re-attach replays the last state, but the replay itself is never readable.
    attach: vi.fn(async () => true),
    detach: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    bulk: vi.fn(async () => ({ count: 1 })),
    request: vi.fn(async () => ({ generation: 1, result: null })),
  };
  const runtime = new EnvironmentRuntime(
    { environmentId: "env", principalId: "device", accessEpoch: "unlocked" },
    port,
  );
  runtimes.push(runtime);
  return { runtime, port, listener: () => listener!, rejected: () => onRejected! };
}

it("re-attaches on a rejected native event, then shows a schema block instead of a stale state", async () => {
  const { runtime, port, listener, rejected } = setup();
  await runtime.start();
  listener()({ kind: "state", phase: "connecting", environmentId: "env", generation: 1 });
  expect(runtime.state.transport).not.toBe("blocked");
  const attachesAtStart = vi.mocked(port.attach).mock.calls.length;

  for (let index = 0; index < 3; index++) {
    rejected()();
    await flush();
  }
  expect(vi.mocked(port.attach).mock.calls.length - attachesAtStart).toBe(3);
  expect(runtime.state.transport).not.toBe("blocked");

  // The replay stayed unreadable: the user gets a visible block, not a frozen indicator.
  rejected()();
  await flush();
  expect(runtime.state).toMatchObject({ transport: "blocked", failure: "schema" });
  expect(vi.mocked(port.attach).mock.calls.length - attachesAtStart).toBe(3);
});
