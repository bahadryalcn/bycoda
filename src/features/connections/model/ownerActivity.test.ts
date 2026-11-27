import { afterEach, expect, it, vi } from "vitest";
import { OWNER_ACTIVE_MS, reportOwnerActivity, startOwnerActivityReports } from "./ownerActivity";

afterEach(() => vi.useRealTimers());

it("tells every advertising Host only while the owner uses this window", async () => {
  let active = false;
  const send = vi.fn((id: string) =>
    id === "b" ? Promise.reject(new Error("down")) : Promise.resolve(),
  );
  const deps = {
    active: () => active,
    machines: () => [{ id: "a" }, { id: "b" }],
    reachable: () => true,
    send,
  };
  reportOwnerActivity(deps);
  expect(send).not.toHaveBeenCalled();
  active = true;
  reportOwnerActivity(deps);
  expect(send.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
});

it("never dials a machine that is down or turned off here", () => {
  const send = vi.fn((_id: string) => Promise.resolve());
  const reachable = vi.fn((machine: { id: string }) => machine.id === "up");
  reportOwnerActivity({
    active: () => true,
    machines: () => [{ id: "down" }, { id: "up" }, { id: "off" }],
    reachable,
    send,
  });
  expect(reachable).toHaveBeenCalledTimes(3);
  expect(send.mock.calls.map(([id]) => id)).toEqual(["up"]);
});

it("reports a machine again on the next tick after it reconnects", () => {
  vi.useFakeTimers();
  let connected = false;
  const send = vi.fn((_id: string) => Promise.resolve());
  const stop = startOwnerActivityReports({
    active: () => true,
    machines: () => [{ id: "a" }],
    reachable: () => connected,
    send,
  });
  vi.advanceTimersByTime(OWNER_ACTIVE_MS);
  expect(send).not.toHaveBeenCalled();
  connected = true;
  vi.advanceTimersByTime(OWNER_ACTIVE_MS);
  expect(send).toHaveBeenCalledTimes(1);
  stop();
});

it("reports on an interval until stopped", () => {
  vi.useFakeTimers();
  const send = vi.fn((_id: string) => Promise.resolve());
  const stop = startOwnerActivityReports({
    active: () => true,
    machines: () => [{ id: "a" }],
    reachable: () => true,
    send,
  });
  vi.advanceTimersByTime(OWNER_ACTIVE_MS * 2);
  expect(send).toHaveBeenCalledTimes(2);
  stop();
  vi.advanceTimersByTime(OWNER_ACTIVE_MS);
  expect(send).toHaveBeenCalledTimes(2);
});
