// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createVoiceToolSessionOwner, registerVoiceToolSessionSource } from "./useVoiceAppBridge";
import { useVoiceAppBridge } from "./useVoiceAppBridge";
import { voiceRailProjects } from "./useVoiceAppBridge";
import { NOTHING_LOCKED } from "../../../features/group-lock/model/lockState";
import { pathKey } from "../../../shared/lib/paths";
import type { Session } from "../../../features/sessions/model/session";
import { saveTabGroupLabel } from "../../../features/workspace/model/tabGroups";
import { projectKey } from "../../../shared/lib/paths";
import {
  getSessions,
  resetSessionsStore,
  sessionsRef,
} from "../../../features/sessions/model/sessionsStore";

const session = (id: string, cwd = "/project") =>
  ({ id, cwd, harness: "codex", model: "test", title: "Voice", blocks: [] }) as Session;

describe("voice management source ownership", () => {
  it("matches the visible rail directory including the current unremembered folder without exposing locked projects", () => {
    const recents = [{ path: "/project", openedAt: 1 }];
    expect(voiceRailProjects(recents, "/current", NOTHING_LOCKED).map((item) => item.path)).toEqual(
      ["/project", "/current"],
    );
    const locked = {
      lockedGroupIds: new Set(["private"]),
      lockedProjectKeys: new Set([pathKey("/current")]),
    };
    expect(voiceRailProjects(recents, "/current", locked).map((item) => item.path)).toEqual([
      "/project",
    ]);
    expect(voiceRailProjects(recents, "~", NOTHING_LOCKED)).toEqual(recents);
    expect(recents).toEqual([{ path: "/project", openedAt: 1 }]);
  });
  it("keeps an unremembered folder listed after navigating away, until it is remembered, forgotten or locked", () => {
    const recents = [{ path: "/project", openedAt: 1 }];
    const visited = new Map();
    const paths = (list: typeof recents, current: string, locks = NOTHING_LOCKED) =>
      voiceRailProjects(list, current, locks, visited).map((item) => item.path);
    expect(paths(recents, "/worktree")).toEqual(["/project", "/worktree"]);
    // Navigation alone: voice would read a missing project as scope loss and close capture.
    expect(paths(recents, "/project")).toEqual(["/project", "/worktree"]);
    const locked = {
      lockedGroupIds: new Set(["private"]),
      lockedProjectKeys: new Set([pathKey("/worktree")]),
    };
    expect(paths(recents, "/project", locked)).toEqual(["/project"]);
    // Once remembered, the recents own it: forgetting it removes it from voice too.
    const remembered = [...recents, { path: "/worktree", openedAt: 2 }];
    expect(paths(remembered, "/project")).toEqual(["/project", "/worktree"]);
    expect(paths(recents, "/project")).toEqual(["/project"]);
  });
  it("publishes renamed display metadata to live context and workspace listing without creating a session", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    const path = "G:/Projects/work/upstream",
      launch = vi.fn(async () => {}),
      appendEmpty = vi.fn();
    let bridge: ReturnType<typeof useVoiceAppBridge> | undefined;
    function Probe() {
      bridge = useVoiceAppBridge({
        projects: [{ path }],
        sessions: [],
        projectPath: path,
        launch,
        appendEmpty,
      });
      return null;
    }
    const element = document.createElement("div"),
      root = createRoot(element);
    try {
      await act(async () => root.render(createElement(Probe)));
      await act(async () => saveTabGroupLabel(projectKey(path), "bycoda"));
      expect(bridge!.projects).toEqual([
        { path, name: "bycoda", folderName: "upstream", aliases: ["bycoda", "upstream"] },
      ]);
      expect(
        await bridge!.workspace.execute("workspace.projects.resolve", { query: "bycoda" }),
      ).toMatchObject({ ambiguous: false, projects: [{ path, name: "bycoda" }] });
      expect(await bridge!.workspace.execute("workspace.projects.list", {})).toMatchObject({
        projects: bridge!.projects,
      });
      expect(launch).not.toHaveBeenCalled();
      expect(appendEmpty).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      localStorage.clear();
    }
  });
  it("the active app bridge lists projects without creating a management session", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const coding = session("coding");
    resetSessionsStore([coding]);
    const launch = vi.fn(async () => {});
    const appendEmpty = vi.fn();
    let bridge: ReturnType<typeof useVoiceAppBridge> | undefined;
    function Probe() {
      bridge = useVoiceAppBridge({
        projects: [{ path: "/project", name: "Project" }],
        sessions: [coding],
        projectPath: "/project",
        launch,
        appendEmpty,
      });
      return null;
    }
    const element = document.createElement("div");
    document.body.append(element);
    const root = createRoot(element);
    try {
      await act(async () => root.render(createElement(Probe)));
      expect(bridge).not.toHaveProperty("ensureToolSession");
      await bridge!.workspace.execute("workspace.projects.list", {});
      expect(getSessions()).toEqual([coding]);
      expect(launch).not.toHaveBeenCalled();
      expect(appendEmpty).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      element.remove();
      resetSessionsStore([]);
    }
  });
  it("registers the persisted management source in the actual desktop relay session store", async () => {
    const coding = session("coding");
    resetSessionsStore([coding]);
    const source = session("management");
    const ensure = createVoiceToolSessionOwner({
      visible: () => true,
      id: () => source.id,
      create: async () => source,
      created: registerVoiceToolSessionSource,
    });
    expect(await ensure("/project")).toBe(source.id);
    expect(getSessions()).toEqual([coding, source]);
    expect(sessionsRef.current.find((entry) => entry.id === source.id)).toBe(source);
    registerVoiceToolSessionSource(source);
    expect(getSessions()).toHaveLength(2);
    expect(source.blocks).toEqual([]);
    expect(source.busy).not.toBe(true);
    resetSessionsStore([]);
  });
  it("does not replace a loaded source whose identity differs", () => {
    const existing = session("management", "/private");
    resetSessionsStore([existing]);
    expect(() => registerVoiceToolSessionSource(session("management", "/other"))).toThrow(
      "identity changed",
    );
    expect(getSessions()).toEqual([existing]);
    resetSessionsStore([]);
  });
  it("joins concurrent requests and retains a separate source for each project", async () => {
    const create = vi.fn(async (path: string, id: string) => session(id, path));
    const created = vi.fn();
    const id = vi.fn().mockReturnValueOnce("source-1").mockReturnValueOnce("source-2");
    const ensure = createVoiceToolSessionOwner({ visible: () => true, create, created, id });
    const first = ensure("/project");
    expect(ensure("/project")).toBe(first);
    expect(await first).toBe("source-1");
    expect(await ensure("/other")).toBe("source-2");
    expect(await ensure("/project")).toBe("source-1");
    expect(create).toHaveBeenCalledTimes(2);
    expect(created).toHaveBeenCalledTimes(2);
  });
  it("refuses a locked project before creating or reading a source", async () => {
    const create = vi.fn();
    const ensure = createVoiceToolSessionOwner({ visible: () => false, create, created: vi.fn() });
    await expect(ensure("/locked")).rejects.toThrow("locked");
    expect(create).not.toHaveBeenCalled();
  });
  it("does not publish a source when the project locks during persistence", async () => {
    let unlocked = true;
    const created = vi.fn();
    const ensure = createVoiceToolSessionOwner({
      visible: () => unlocked,
      created,
      create: async (path, id) => {
        unlocked = false;
        return session(id, path);
      },
    });
    await expect(ensure("/project")).rejects.toThrow("became locked");
    expect(created).not.toHaveBeenCalled();
  });
  it("retries an uncertain creation with the original identity", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error("disconnected"))
      .mockImplementationOnce(async (path: string, id: string) => session(id, path));
    const id = vi.fn(() => "original-source");
    const ensure = createVoiceToolSessionOwner({
      visible: () => true,
      create,
      created: vi.fn(),
      id,
    });
    await expect(ensure("/project")).rejects.toThrow("disconnected");
    expect(await ensure("/project")).toBe("original-source");
    expect(id).toHaveBeenCalledTimes(1);
    expect(create.mock.calls.map((call) => call[1])).toEqual([
      "original-source",
      "original-source",
    ]);
  });
  it("does not release a retained source after the project is locked", async () => {
    let visible = true;
    const create = vi.fn(async (path: string, id: string) => session(id, path));
    const ensure = createVoiceToolSessionOwner({
      visible: () => visible,
      create,
      created: vi.fn(),
    });
    await ensure("/project");
    visible = false;
    await expect(ensure("/project")).rejects.toThrow("locked");
    expect(create).toHaveBeenCalledTimes(1);
  });
});
