import { beforeEach, describe, expect, it, vi } from "vitest";
import { readRemoteConnection, resetRemoteHealth, subscribeChanges } from "./remoteHealth";
import { watchTunnelExits, type TunnelExit } from "./remoteTunnelEvents";

type Handler = (event: { payload: TunnelExit }) => void;

function fakeListen() {
  let handler: Handler | undefined;
  const unlisten = vi.fn();
  const subscribe = vi.fn(async (next: Handler) => {
    handler = next;
    return unlisten;
  });
  return { subscribe, unlisten, emit: (payload: TunnelExit) => handler?.({ payload }) };
}

beforeEach(() => resetRemoteHealth());

describe("watchTunnelExits", () => {
  it("turns a tunnel exit into an unreachable machine and tells listeners once", async () => {
    const events = fakeListen();
    const changed = vi.fn();
    const unsubscribe = subscribeChanges(changed);
    const stop = watchTunnelExits(events.subscribe);
    await Promise.resolve();
    events.emit({
      environmentId: "env",
      exitCode: 255,
      stderr: "Timeout, server mini not responding.",
    });
    events.emit({
      environmentId: "env",
      exitCode: 255,
      stderr: "Timeout, server mini not responding.",
    });
    expect(readRemoteConnection("env")).toMatchObject({ status: "unreachable" });
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
    unsubscribe();
  });

  it("reads a drop that needs the user as such, and ignores malformed events", async () => {
    const events = fakeListen();
    const stop = watchTunnelExits(events.subscribe);
    await Promise.resolve();
    events.emit({ environmentId: "env", exitCode: 255, stderr: "Permission denied (publickey)." });
    expect(readRemoteConnection("env").status).toBe("needs-auth");
    events.emit({ stderr: "x" } as TunnelExit);
    stop();
  });

  it("stops listening, even when asked before the subscription finished", async () => {
    const events = fakeListen();
    const stop = watchTunnelExits(events.subscribe);
    stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(events.unlisten).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside the desktop app", () => {
    expect(() => watchTunnelExits()()).not.toThrow();
  });
});
