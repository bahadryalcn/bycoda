import { describe, expect, it, vi } from "vitest";
import type { BrowserSession } from "../social-browser";
import { BrowserSupervisor } from "./supervisor";
import { fakeSession } from "./test-support";

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("BrowserSupervisor", () => {
  it("restarts a crashed browser for the same account, reports the interrupted task, and keeps supervising", async () => {
    const first = fakeSession();
    const second = fakeSession();
    const third = fakeSession();
    // Each relaunch yields a fresh browser; reusing a crashed session would count as an extra restart.
    const launch = vi
      .fn<(accountId: string) => Promise<BrowserSession>>()
      .mockResolvedValueOnce(second.session)
      .mockResolvedValueOnce(third.session);
    const onInterrupted = vi.fn();
    const supervisor = new BrowserSupervisor({
      launch,
      wait: async () => undefined,
      onInterrupted,
      now: () => 0,
    });
    supervisor.supervise("acc", first.session);
    first.crash();
    await vi.waitFor(() => expect(launch).toHaveBeenCalledWith("acc"));
    expect(onInterrupted).toHaveBeenCalledWith("acc");
    second.crash();
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
    await flush();
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("gives up after the hourly restart budget and launches no more", async () => {
    const sessions = [fakeSession(), fakeSession(), fakeSession(), fakeSession()];
    let index = 0;
    const launch = vi.fn(async () => sessions[++index]!.session);
    const onGaveUp = vi.fn();
    const supervisor = new BrowserSupervisor({
      launch,
      wait: async () => undefined,
      now: () => 0,
      maxRestartsPerHour: 3,
      onGaveUp,
    });
    supervisor.supervise("acc", sessions[0]!.session);
    for (let attempt = 0; attempt < 3; attempt++) {
      sessions[attempt]!.crash();
      await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(attempt + 1));
      await flush();
    }
    sessions[3]!.crash();
    await vi.waitFor(() => expect(onGaveUp).toHaveBeenCalledWith("acc"));
    expect(launch).toHaveBeenCalledTimes(3);
  });

  it("never restarts an account the owner stopped on purpose", async () => {
    const session = fakeSession();
    const launch = vi.fn(async () => fakeSession().session);
    const onInterrupted = vi.fn();
    const supervisor = new BrowserSupervisor({
      launch,
      wait: async () => undefined,
      onInterrupted,
    });
    supervisor.supervise("acc", session.session);
    supervisor.stop("acc");
    session.crash();
    await flush();
    expect(launch).not.toHaveBeenCalled();
    expect(onInterrupted).not.toHaveBeenCalled();
  });

  it("counts failed relaunches against the same budget instead of looping forever", async () => {
    const session = fakeSession();
    const launch = vi.fn(async () => {
      throw new Error("launch failed");
    });
    const onGaveUp = vi.fn();
    const supervisor = new BrowserSupervisor({
      launch,
      wait: async () => undefined,
      maxRestartsPerHour: 2,
      onGaveUp,
      now: () => 0,
    });
    supervisor.supervise("acc", session.session);
    session.crash();
    await vi.waitFor(() => expect(onGaveUp).toHaveBeenCalledWith("acc"));
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it("bounds a wedged relaunch, counts it against the budget, and closes the browser if it lands late", async () => {
    const first = fakeSession();
    const late = fakeSession();
    const next = fakeSession();
    let landLate!: (session: BrowserSession) => void;
    const launch = vi
      .fn<(accountId: string) => Promise<BrowserSession>>()
      .mockImplementationOnce(
        () =>
          new Promise<BrowserSession>((resolve) => {
            landLate = resolve;
          }),
      )
      .mockResolvedValueOnce(next.session);
    const onGaveUp = vi.fn();
    const supervisor = new BrowserSupervisor({
      launch,
      wait: async () => undefined,
      now: () => 0,
      launchTimeoutMs: 1,
      onGaveUp,
    });
    supervisor.supervise("acc", first.session);
    first.crash();
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
    landLate(late.session);
    await vi.waitFor(() => expect(late.session.close).toHaveBeenCalledTimes(1));
    expect(onGaveUp).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledTimes(2);
    expect(next.session.close).not.toHaveBeenCalled();
  });

  it("closes a browser that finishes launching after the owner stopped the account", async () => {
    const first = fakeSession();
    const launched = fakeSession();
    let finish!: (session: BrowserSession) => void;
    const launch = vi.fn(
      () =>
        new Promise<BrowserSession>((resolve) => {
          finish = resolve;
        }),
    );
    const supervisor = new BrowserSupervisor({
      launch,
      wait: async () => undefined,
      now: () => 0,
      launchTimeoutMs: 60_000,
    });
    supervisor.supervise("acc", first.session);
    first.crash();
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    supervisor.stop("acc");
    finish(launched.session);
    await vi.waitFor(() => expect(launched.session.close).toHaveBeenCalledTimes(1));
    launched.crash();
    await flush();
    expect(launch).toHaveBeenCalledTimes(1);
  });
});
