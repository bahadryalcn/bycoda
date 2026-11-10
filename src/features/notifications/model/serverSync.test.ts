import {
  defaultNotificationSettings,
  type NotificationItem,
  type NotificationSettings,
} from "@bycoda/account-contracts";
import { describe, expect, it, vi } from "vitest";
import type { NotificationsServerPort } from "./serverPort";
import { setHostPushEvents } from "../../../shared/lib/hostPushEvents";
import { activateServerSync, reportAgentEvent } from "./serverRuntime";
import { createServerSync } from "./serverSync";
import type { ServerSyncDeps } from "./serverSyncSupport";

const NOW = Date.parse("2026-11-08T10:00:00Z");

function setup(
  options: { settings?: NotificationSettings; items?: NotificationItem[]; focused?: boolean } = {},
) {
  const settings = options.settings ?? defaultNotificationSettings();
  const port: NotificationsServerPort = {
    getSettings: vi.fn(async () => settings),
    putSettings: vi.fn(async (s) => s),
    listFeed: vi.fn(async () => ({ items: options.items ?? [], nextCursor: null })),
    markRead: vi.fn(async () => undefined),
    reportEvent: vi.fn(async () => undefined),
  };
  const shown = new Set<string>();
  let pending: string[] = [];
  const deps: ServerSyncDeps = {
    port,
    userId: "u1",
    now: () => NOW,
    isFocused: () => options.focused ?? false,
    localSummarySentAt: () => null,
    announce: vi.fn(async () => true),
    local: {
      read: () => ({
        dailySummaryTime: "18:00",
        "os:summary.daily": false,
        "os:agent.finished": true,
        "os:agent.failed": true,
        "os:approval.pending": true,
      }),
      write: vi.fn(),
    },
    store: {
      loadBase: () => null,
      saveBase: vi.fn(),
      loadShown: () => new Set(shown),
      rememberShown: (keys) => keys.forEach((k) => shown.add(k)),
      loadPendingRead: () => pending,
      savePendingRead: (ids) => void (pending = [...ids]),
    },
  };
  return { sync: createServerSync(deps), port, deps };
}

const announcement = (key: string): NotificationItem => ({
  id: `id-${key}`,
  event: "account.new_device_sign_in",
  title: "New device signed in",
  body: "Laptop signed in",
  createdAt: new Date(NOW - 1000).toISOString(),
  readAt: null,
  dedupeKey: key,
});

describe("server sync", () => {
  it("announces each feed item once across polls and marks it read after the user returns", async () => {
    const { sync, port, deps } = setup({ items: [announcement("d1")] });
    expect(await sync.poll()).toBe(1);
    expect(await sync.poll()).toBe(0);
    expect(deps.announce).toHaveBeenCalledTimes(1);
    await sync.flushRead();
    expect(port.markRead).not.toHaveBeenCalled(); // window not in front yet
  });

  it("syncs read state once the window is focused", async () => {
    const { sync, port } = setup({ items: [announcement("d2")], focused: true });
    await sync.poll();
    await sync.flushRead();
    expect(port.markRead).toHaveBeenCalledWith(["id-d2"]);
    await sync.flushRead();
    expect(port.markRead).toHaveBeenCalledTimes(1);
  });

  it("retries an item the OS refused at the next poll", async () => {
    const { sync, deps } = setup({ items: [announcement("d3")] });
    vi.mocked(deps.announce).mockResolvedValueOnce(false);
    expect(await sync.poll()).toBe(0);
    expect(await sync.poll()).toBe(1);
  });

  it("sends a local setting the account lacks and remembers what both sides now hold", async () => {
    const { sync, port, deps } = setup();
    await sync.syncSettings();
    // The account has no OS channel for the summary yet, so the local "off" is created there.
    expect(port.putSettings).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(port.putSettings).mock.calls[0]?.[0];
    expect(sent?.preferences).toContainEqual({
      scope: "user",
      event: "summary.daily",
      channel: "os",
      enabled: false,
    });
    expect(deps.local.write).not.toHaveBeenCalled();
    expect(deps.store.saveBase).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ dailySummaryTime: "18:00" }),
    );
  });
});

describe("reporting agent events", () => {
  it("reports only when push is on for that event", async () => {
    const on = setup();
    await on.sync.syncSettings();
    await on.sync.report("agent.finished", "key-0000001", NOW);
    expect(on.port.reportEvent).toHaveBeenCalledWith({
      event: "agent.finished",
      dedupeKey: "key-0000001",
      occurredAt: new Date(NOW).toISOString(),
    });

    const settings = defaultNotificationSettings();
    settings.preferences = settings.preferences.map((p) =>
      p.event === "agent.failed" && p.channel === "push" ? { ...p, enabled: false } : p,
    );
    const off = setup({ settings });
    await off.sync.syncSettings();
    await off.sync.report("agent.failed", "key-0000002", NOW);
    expect(off.port.reportEvent).not.toHaveBeenCalled();
  });

  it("reports nothing before the account settings are known", async () => {
    const { sync, port } = setup();
    await sync.report("agent.finished", "key-0000003", NOW);
    expect(port.reportEvent).not.toHaveBeenCalled();
  });

  it("is a synchronous no-op when signed out (nothing active)", () => {
    activateServerSync(null);
    const digest = vi.spyOn(crypto.subtle, "digest");
    reportAgentEvent("finished", ["session", "turn"]);
    expect(digest).not.toHaveBeenCalled();
    digest.mockRestore();
  });

  it("sends a hash, never the session identity, through the active sync", async () => {
    const { sync, port } = setup();
    await sync.syncSettings();
    activateServerSync(sync);
    reportAgentEvent("input", ["session-secret-id", "turn"], NOW);
    await vi.waitFor(() => expect(port.reportEvent).toHaveBeenCalled());
    const report = vi.mocked(port.reportEvent).mock.calls[0]?.[0];
    expect(report?.event).toBe("approval.pending");
    expect(report?.dedupeKey).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(report)).not.toContain("session-secret-id");
    activateServerSync(null);
  });

  it("leaves kinds the Host already pushes to the phone out of the account report", async () => {
    const { sync, port } = setup();
    await sync.syncSettings();
    activateServerSync(sync);
    setHostPushEvents(["finished"]);
    const digest = vi.spyOn(crypto.subtle, "digest");
    reportAgentEvent("finished", ["session", "turn"], NOW);
    expect(digest).not.toHaveBeenCalled();
    reportAgentEvent("input", ["session", "turn"], NOW);
    await vi.waitFor(() => expect(port.reportEvent).toHaveBeenCalledTimes(1));
    expect(vi.mocked(port.reportEvent).mock.calls[0]?.[0].event).toBe("approval.pending");
    digest.mockRestore();
    setHostPushEvents(undefined);
    activateServerSync(null);
  });
});
