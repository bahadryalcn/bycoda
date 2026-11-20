import { describe, expect, it, vi } from "vitest";
import type { HostSessionSummary } from "../../src/features/connections/model/protocol";
import type { sendExpoPush } from "./expo-push";
import { createPushSessionInventory } from "./push-session-inventory";
import { DESKTOP_PRESENCE_MS, PushNotifications } from "./push-service";
import type { PushDeviceStore, PushRecipient } from "./push-store";

function session(id: string, projectId: string, patch: Partial<HostSessionSummary> = {}) {
  return {
    id,
    projectId,
    title: "t",
    harness: "claude",
    status: "idle",
    updatedAt: 1,
    ...patch,
  } as HostSessionSummary;
}

function inventory(projects: string[], options: { safetyMs?: number } = {}) {
  let clock = 0;
  let notify: (() => void) | undefined;
  const unwatch = vi.fn();
  const list = vi.fn(async (projectId: string) => [session(`s-${projectId}`, projectId)]);
  const watch = vi.fn((changed: () => void) => {
    notify = changed;
    return unwatch;
  });
  const subject = createPushSessionInventory({
    projectIds: async () => projects,
    list,
    watch,
    now: () => clock,
    safetyMs: options.safetyMs ?? 20_000,
  });
  return {
    subject,
    list,
    watch,
    unwatch,
    change: () => notify?.(),
    advance: (ms: number) => (clock += ms),
  };
}

describe("push session inventory", () => {
  it("lists every project once and reuses the result until something changes", async () => {
    const host = inventory(["a", "b", "c"]);
    const first = await host.subject.read();
    expect(first.map((row) => row.id)).toEqual(["s-a", "s-b", "s-c"]);
    expect(host.list).toHaveBeenCalledTimes(3);
    for (let tick = 0; tick < 4; tick++) await host.subject.read();
    expect(host.list).toHaveBeenCalledTimes(3);
  });

  it("re-reads after a store or desktop change", async () => {
    const host = inventory(["a", "b"]);
    await host.subject.read();
    host.change();
    await host.subject.read();
    expect(host.list).toHaveBeenCalledTimes(4);
  });

  it("re-reads after the safety interval even without a signal", async () => {
    const host = inventory(["a"], { safetyMs: 20_000 });
    await host.subject.read();
    host.advance(19_999);
    await host.subject.read();
    expect(host.list).toHaveBeenCalledTimes(1);
    host.advance(1);
    await host.subject.read();
    expect(host.list).toHaveBeenCalledTimes(2);
  });

  it("keeps a change that lands during a read for the next read", async () => {
    const host = inventory(["a"]);
    host.list.mockImplementationOnce(async (projectId) => {
      host.change();
      return [session("old", projectId)];
    });
    await host.subject.read();
    expect((await host.subject.read()).map((row) => row.id)).toEqual(["s-a"]);
  });

  it("does not cache a failed read", async () => {
    const host = inventory(["a"]);
    host.list.mockRejectedValueOnce(new Error("busy"));
    await expect(host.subject.read()).rejects.toThrow("busy");
    expect((await host.subject.read()).map((row) => row.id)).toEqual(["s-a"]);
    expect(host.list).toHaveBeenCalledTimes(2);
  });

  it("listens only once it is read and stops on close", async () => {
    const host = inventory(["a"]);
    expect(host.watch).not.toHaveBeenCalled();
    await host.subject.read();
    await host.subject.read();
    expect(host.watch).toHaveBeenCalledTimes(1);
    host.subject.close();
    expect(host.unwatch).toHaveBeenCalledTimes(1);
    await host.subject.read();
    expect(host.watch).toHaveBeenCalledTimes(2);
    expect(host.list).toHaveBeenCalledTimes(2);
  });
});

function recipient(patch: Partial<PushRecipient> = {}): PushRecipient {
  return {
    deviceHash: "phone",
    pushToken: "ExponentPushToken[abcdefghij123]",
    title: "bycoda",
    texts: { finished: "f", input: "i", failed: "x", assistant: "a", approvals: "p" },
    events: { finished: true, input: true, failed: true, assistant: false, approvals: false },
    widgetUpdates: false,
    ...patch,
  } as PushRecipient;
}

describe("push tick session read", () => {
  function service(recipients: PushRecipient[]) {
    let now = 0;
    const sessions = vi.fn(async () => [session("a", "p1", { status: "running" })]);
    const send = vi.fn(async () => ({ failed: 0, unregistered: [] as string[] }));
    const push = new PushNotifications({
      store: { recipients: async () => recipients } as unknown as PushDeviceStore,
      environmentId: "env",
      sessions,
      send: send as unknown as typeof sendExpoPush,
      now: () => now,
      wallNow: () => now,
    });
    return { push, sessions, send, advance: (ms: number) => (now += ms) };
  }

  it("skips the list read while the desktop is active and no widget needs an update", async () => {
    const host = service([recipient()]);
    host.push.desktopPresence("window", true);
    await host.push.tick();
    await host.push.tick();
    expect(host.sessions).not.toHaveBeenCalled();
    expect(host.send).not.toHaveBeenCalled();
  });

  it("still reads for a widget recipient while the desktop is active", async () => {
    const host = service([recipient({ widgetUpdates: true })]);
    host.push.desktopPresence("window", true);
    await host.push.tick();
    expect(host.sessions).toHaveBeenCalledTimes(1);
  });

  it("starts from a fresh baseline when the desktop leaves, so seen transitions are not owed", async () => {
    const host = service([recipient()]);
    await host.push.tick();
    expect(host.sessions).toHaveBeenCalledTimes(1);
    host.push.desktopPresence("window", true);
    // The session finished while the desktop's user was watching and nothing was read.
    host.sessions.mockResolvedValue([session("a", "p1", { status: "idle" })]);
    await host.push.tick();
    host.advance(DESKTOP_PRESENCE_MS + 1);
    await host.push.tick();
    expect(host.sessions).toHaveBeenCalledTimes(2);
    expect(host.send).not.toHaveBeenCalled();
  });

  it("reads again and notifies once the desktop is away", async () => {
    const host = service([recipient()]);
    await host.push.tick();
    host.sessions.mockResolvedValue([session("a", "p1", { status: "idle" })]);
    await host.push.tick();
    expect(host.send).toHaveBeenCalledTimes(1);
  });

  it("releases the session source on stop", () => {
    const onStop = vi.fn();
    const push = new PushNotifications({
      store: { recipients: async () => [] } as unknown as PushDeviceStore,
      environmentId: "env",
      sessions: async () => [],
      onStop,
    });
    push.stop();
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
