import { afterEach, expect, it, vi } from "vitest";
import { createHostDispatcher, type HostDispatchContext } from "./dispatch";

afterEach(() => vi.restoreAllMocks());

const context: HostDispatchContext = {
  environmentId: "fixture-host",
  principal: { kind: "device", id: "opaque-device" },
  authorized: async () => true,
};

function failing(method: string, message: string) {
  return createHostDispatcher({
    environmentId: "fixture-host",
    environment: { describe: async () => ({}) },
    projects: { list: async () => [] },
    operations: {
      [method]: async () => {
        throw new Error(message);
      },
    },
  });
}

it("logs a failed read with the transport request id and keeps the wire result generic", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const dispatcher = failing("sessions.sync", "read exploded for correlation");
  const call = (requestId?: string) =>
    dispatcher
      .dispatch("sessions.sync", { sessionId: "session" }, { ...context, requestId })
      .catch((error: unknown) => error);
  const first = await call("rpc-41");
  expect(first).toMatchObject({
    code: "service-unavailable",
    message: "Host read could not be completed.",
  });
  expect(JSON.stringify(first)).not.toContain("rpc-41");
  expect(warn.mock.calls).toEqual([
    ["Host read sessions.sync failed: read exploded for correlation request=rpc-41"],
  ]);
  // The request id is not part of the warning's identity: a retry loop stays one line.
  await call("rpc-42");
  await call();
  expect(warn).toHaveBeenCalledTimes(1);
});

it("logs an unknown-outcome command once per command id", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const dispatcher = failing("commands.dispatch", "effect exploded for correlation");
  const call = (commandId: string, requestId: number) =>
    dispatcher
      .dispatch(
        "commands.dispatch",
        { commandId, sessionId: "session-a", type: "draft", text: "kept" },
        { ...context, requestId },
      )
      .catch((error: unknown) => error);
  const first = await call("command-a", 7);
  expect(first).toMatchObject({
    code: "service-unavailable",
    details: { delivery: "unknown", commandId: "command-a" },
  });
  await call("command-a", 8);
  await call("command-b", 9);
  expect(warn.mock.calls).toEqual([
    [
      "Host operation commands.dispatch command=command-a failed with an unknown outcome: effect exploded for correlation request=7",
    ],
    [
      "Host operation commands.dispatch command=command-b failed with an unknown outcome: effect exploded for correlation request=9",
    ],
  ]);
});
