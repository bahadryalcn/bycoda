// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newSession } from "../../../features/sessions/model/session";
import { useSessionRename, type SessionRenameDeps } from "./useSessionRename";

const storage = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock("../../../features/sessions/data/sessionStore", () => ({
  getSession: storage.get,
  upsertSession: storage.save,
  shouldPersistSession: () => true,
  persistFingerprint: () => "saved-fingerprint",
}));
let root: Root;
let deps: SessionRenameDeps;
let actions: ReturnType<typeof useSessionRename>;
const session = { ...newSession("claude", "/repo"), id: "session", title: "Original" };
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  storage.get.mockReset().mockResolvedValue(session);
  storage.save.mockReset().mockResolvedValue({ id: session.id });
  deps = {
    sessionsRef: { current: [] },
    setSessions: (update) => {
      deps.sessionsRef.current =
        typeof update === "function" ? update(deps.sessionsRef.current) : update;
    },
    loadedSessionCache: { current: new Map() },
    lastPersisted: { current: new Map() },
    invalidateLoadedSession: vi.fn(),
    refreshHistory: vi.fn(async () => undefined),
    sidebarCwd: "/repo",
  };
  function Harness() {
    actions = useSessionRename(deps);
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it.each(["open", "history"])(
  "reports failed %s renames without publishing a false title and supports retry",
  async (kind) => {
    if (kind === "open") deps.sessionsRef.current = [session];
    storage.save.mockRejectedValueOnce(new Error("Disk unavailable"));
    await expect(actions.onRenameHistorySession(session.id, "New title")).rejects.toThrow(
      "Disk unavailable",
    );
    expect(deps.sessionsRef.current[0]?.title ?? session.title).toBe("Original");
    expect(deps.refreshHistory).not.toHaveBeenCalled();
    expect(deps.lastPersisted.current.size).toBe(0);
    await actions.onRenameHistorySession(session.id, "New title");
    expect(storage.save).toHaveBeenCalledTimes(2);
    expect(deps.refreshHistory).toHaveBeenCalledWith("/repo");
    expect(deps.lastPersisted.current.get(session.id)).toBe("saved-fingerprint");
  },
);

it("keeps concurrent open-session updates when rename persistence finishes", async () => {
  deps.sessionsRef.current = [session];
  let release!: (value: { id: string }) => void;
  storage.save.mockReturnValueOnce(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const pending = actions.onRenameHistorySession(session.id, "New title");
  deps.sessionsRef.current = [{ ...session, busy: true, activity: "New activity" }];
  release({ id: session.id });
  await pending;
  expect(deps.sessionsRef.current[0]).toMatchObject({ busy: true, activity: "New activity" });
  expect(deps.sessionsRef.current[0].title).toContain("New title");
});

it("reports missing history and null writes instead of accepting the rename", async () => {
  storage.get.mockResolvedValueOnce(null);
  await expect(actions.onRenameHistorySession(session.id, "New title")).rejects.toThrow(
    "Could not save changes",
  );
  storage.save.mockResolvedValueOnce(null);
  await expect(actions.onRenameHistorySession(session.id, "New title")).rejects.toThrow(
    "Could not save changes",
  );
  expect(deps.refreshHistory).not.toHaveBeenCalled();
});
