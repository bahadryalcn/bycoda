import { afterEach, expect, it, vi } from "vitest";
import { OWNER_ACTIVE_MS, reportOwnerActivity, startOwnerActivityReports } from "./ownerActivity";

afterEach(() => vi.useRealTimers());

it("tells every advertising Host only while the owner uses this window", async () => {
  let active = false;
  const send = vi.fn((id: string) =>
    id === "b" ? Promise.reject(new Error("down")) : Promise.resolve(),
  );
  const deps = { active: () => active, machines: () => [{ id: "a" }, { id: "b" }], send };
  reportOwnerActivity(deps);
  expect(send).not.toHaveBeenCalled();
  active = true;
  reportOwnerActivity(deps);
  expect(send.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
});

it("reports on an interval until stopped", () => {
  vi.useFakeTimers();
  const send = vi.fn(() => Promise.resolve());
  const stop = startOwnerActivityReports({
    active: () => true,
    machines: () => [{ id: "a" }],
    send,
  });
  vi.advanceTimersByTime(OWNER_ACTIVE_MS * 2);
  expect(send).toHaveBeenCalledTimes(2);
  stop();
  vi.advanceTimersByTime(OWNER_ACTIVE_MS);
  expect(send).toHaveBeenCalledTimes(2);
});
