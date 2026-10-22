import { describe, expect, it } from "vitest";
import { createServerTerminalRestoreState } from "./serverTerminalRestoreState";

describe("saved server tab restore ownership", () => {
  it("does not turn an unknown or corrupt saved version into an implicit opt out", () => {
    for (const saved of [
      { version: 2, enabled: true, tabs: [] },
      { version: 1, enabled: true, tabs: [{ tabId: "ui-1", serverId: "bad\nreference" }] },
    ]) {
      const state = createServerTerminalRestoreState();
      state.initialize(saved);
      state.setEnabled(false);
      expect(state.getSnapshot()).toMatchObject({
        owner: true,
        initialized: false,
        loadFailed: true,
      });
      state.initialize({
        version: 1,
        enabled: true,
        tabs: [{ tabId: "ui-1", serverId: "server-1" }],
      });
      expect(state.getSnapshot()).toMatchObject({
        initialized: true,
        loadFailed: false,
        pending: ["ui-1"],
      });
    }
  });
  it("replaces one pending reference at capacity without restoring a process ID", () => {
    const state = createServerTerminalRestoreState();
    state.initialize({
      version: 1,
      enabled: true,
      tabs: Array.from({ length: 32 }, (_, i) => ({ tabId: `ui-${i}`, serverId: "server-1" })),
    });
    state.add({ tabId: "ui-fresh", serverId: "server-1" }, "ui-0");
    expect(state.getSnapshot().restore?.tabs).toHaveLength(32);
    expect(state.getSnapshot().restore?.tabs.some((tab) => tab.tabId === "ui-fresh")).toBe(true);
    expect(state.getSnapshot().pending).not.toContain("ui-0");
    expect(state.getSnapshot().pending).toHaveLength(31);
  });
  it("cannot write before the primary snapshot read succeeds", () => {
    const state = createServerTerminalRestoreState();
    state.setEnabled(true, [{ tabId: "ui-1", serverId: "server-1" }]);
    expect(state.getSnapshot().restore).toBeUndefined();
    state.beginLoad();
    state.loadFailed();
    expect(state.getSnapshot()).toMatchObject({
      owner: true,
      initialized: false,
      loadFailed: true,
    });
    state.setEnabled(true);
    expect(state.getSnapshot().initialized).toBe(false);
  });

  it("loads previews without creating live terminal IDs or replay data", () => {
    const state = createServerTerminalRestoreState();
    state.initialize({
      version: 1,
      enabled: true,
      tabs: [
        {
          tabId: "ui-1",
          serverId: "server-1",
          input: "must-not-persist",
          endpoint: "must-not-persist",
        },
      ],
    });
    expect(state.getSnapshot().pending).toEqual(["ui-1"]);
    expect(state.getSnapshot().restore?.tabs).toEqual([{ tabId: "ui-1", serverId: "server-1" }]);
    state.remove("ui-1");
    state.add({ tabId: "ui-new", serverId: "server-1" });
    expect(state.getSnapshot().pending).toEqual([]);
    expect(state.getSnapshot().restore?.activeTabId).toBe("ui-new");
  });

  it("opt out clears references while close removes only its own tab", () => {
    const state = createServerTerminalRestoreState();
    state.initialize(undefined);
    state.setEnabled(true, [
      { tabId: "ui-1", serverId: "same-server" },
      { tabId: "ui-2", serverId: "same-server" },
    ]);
    state.activate("ui-1");
    state.remove("ui-1");
    expect(state.getSnapshot().restore?.tabs).toEqual([{ tabId: "ui-2", serverId: "same-server" }]);
    expect(state.getSnapshot().restore?.activeTabId).toBeUndefined();
    state.setEnabled(false);
    expect(state.getSnapshot()).toMatchObject({ initialized: true, pending: [] });
    expect(state.getSnapshot().restore).toBeUndefined();
  });

  it("rejects malformed additions without losing existing references", () => {
    const state = createServerTerminalRestoreState();
    state.initialize({
      version: 1,
      enabled: true,
      tabs: [{ tabId: "ui-1", serverId: "server-1" }],
    });
    state.add({ tabId: "invalid\n", serverId: "server-2" });
    expect(state.getSnapshot().restore?.tabs).toHaveLength(1);
    state.activate("absent");
    expect(state.getSnapshot().restore?.activeTabId).toBeUndefined();
  });
});
