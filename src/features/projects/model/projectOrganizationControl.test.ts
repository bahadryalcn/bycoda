// @vitest-environment happy-dom
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import {
  createProjectOrganizationControl,
  type ProjectOrganizationSnapshot,
  type ProjectOrganizationStatus,
} from "./projectOrganizationControl";
import {
  loadProjectGroups,
  saveProjectGroups,
  setProjectGroupAssignment,
  type ProjectGroup,
} from "./projectGroups";
import { rememberProject, saveProjectRailOrder, loadProjectRailOrder } from "./recents";
import { loadCustomTabGroupLabels } from "../../workspace/model/tabGroups";
import { projectKey, pathKey } from "../../../shared/lib/paths";
import { loadSessionFolders, saveSessionFolders } from "../../sessions/model/sessionFolders";
import { loadSessionOrder } from "../../sessions/model/sessionOrder";
import type { SessionSummary } from "../../sessions/data/sessionStore";
const privacy = vi.hoisted(() => ({
  groups: [] as ProjectGroup[],
  lockedGroups: new Set<string>(),
  lockedProjects: new Set<string>(),
}));
vi.mock("../../group-lock/model/groupLock", () => ({
  getGroupLockView: () => ({
    groups: privacy.groups,
    lock: { lockedGroupIds: privacy.lockedGroups, lockedProjectKeys: privacy.lockedProjects },
  }),
}));
const summaries = [
  { id: "s1", cwd: "/alpha", title: "First" },
  { id: "s2", cwd: "/alpha", title: "Second" },
  { id: "foreign", cwd: "/private", title: "Private title" },
] as SessionSummary[];
beforeEach(() => {
  localStorage.clear();
  privacy.groups = [];
  privacy.lockedGroups.clear();
  privacy.lockedProjects.clear();
  rememberProject("/alpha");
  rememberProject("/beta");
});
function fixture() {
  let valid = true;
  let operation = 0;
  const control = createProjectOrganizationControl({
    sessions: async () => summaries,
    salt: () => "private-window-salt",
    hash: async (value) => createHash("sha256").update(value).digest("hex"),
  });
  const context = {
    environmentId: "env",
    sourceSessionId: "s1",
    projectCwd: "/alpha",
    workingCwd: "/alpha-worktree",
    valid: () => valid,
  };
  const read = async () =>
    (await control(context, "organization.read", {})) as ProjectOrganizationSnapshot;
  const patch = async (change: Record<string, unknown>) => {
    const preview = await read();
    const result = (await control(context, "organization.patch", {
      expectedRevision: preview.revision,
      operationId: `op-${++operation}`,
      change,
    })) as ProjectOrganizationStatus;
    expect(result.state).toBe("applied");
    return result.snapshot!;
  };
  return {
    control,
    context,
    read,
    patch,
    revoke: () => {
      valid = false;
    },
  };
}
it("returns current-project canonical metadata and explicitly optimistic revisions without private membership", async () => {
  saveProjectGroups([
    { id: "public", name: "Public", collapsed: false },
    { id: "private", name: "Secret group", collapsed: false },
  ]);
  privacy.groups = loadProjectGroups();
  privacy.lockedGroups.add("private");
  saveSessionFolders("/alpha", [
    { id: "folder", name: "Own folder", sessionIds: ["s1", "foreign"], collapsed: true },
  ]);
  const f = fixture();
  const snapshot = await f.read();
  expect(snapshot.atomic).toBe(false);
  expect(snapshot.workingCwd).toBe("/alpha-worktree");
  expect(snapshot.groups.map((row) => row.id)).toEqual(["public"]);
  expect(snapshot.sessions.map((row) => row.id)).toEqual(["s1", "s2"]);
  expect(snapshot.folders[0].sessionIds).toEqual(["s1"]);
  expect(JSON.stringify(snapshot)).not.toContain("Secret group");
  expect(JSON.stringify(snapshot)).not.toContain("Private title");
});
it("reuses display labels and group assignment/names while preserving unrelated metadata", async () => {
  saveProjectGroups([{ id: "g", name: "Before", collapsed: true, customColor: "#123456" }]);
  privacy.groups = loadProjectGroups();
  const f = fixture();
  expect((await f.patch({ kind: "projectName", name: "Readable project" })).name).toBe(
    "Readable project",
  );
  expect(loadCustomTabGroupLabels()[projectKey("/alpha")]).toBe("Readable project");
  expect((await f.patch({ kind: "projectGroup", groupId: "g" })).groupId).toBe("g");
  await f.patch({ kind: "groupName", name: "Renamed" });
  expect(loadProjectGroups()[0]).toMatchObject({
    name: "Renamed",
    collapsed: true,
    customColor: "#123456",
  });
  expect((await f.patch({ kind: "projectGroup", groupId: null })).groupId).toBeNull();
});
it("moves project/group order in visible slots while private entries retain their positions", async () => {
  rememberProject("/private");
  saveProjectRailOrder(["/alpha", "/private", "/beta"]);
  privacy.lockedProjects.add(pathKey("/private"));
  const f = fixture();
  await f.patch({ kind: "projectMove", step: "down" });
  expect(loadProjectRailOrder()).toEqual(["/beta", "/private", "/alpha"]);
  saveProjectGroups([
    { id: "a", name: "A", collapsed: false },
    { id: "hidden", name: "Hidden", collapsed: true },
    { id: "c", name: "C", collapsed: false },
  ]);
  privacy.groups = loadProjectGroups();
  privacy.lockedGroups.add("hidden");
  setProjectGroupAssignment("/alpha", "c");
  await f.patch({ kind: "groupMove", step: "up" });
  expect(loadProjectGroups().map((row) => row.id)).toEqual(["c", "hidden", "a"]);
  expect(loadProjectGroups()[1].collapsed).toBe(true);
});
it("creates/renames/moves/orders actual session folders and own conversations without changing other projects", async () => {
  saveSessionFolders("/private", [
    { id: "private-folder", name: "Private", sessionIds: ["foreign"], collapsed: true },
  ]);
  const f = fixture();
  let snapshot = await f.patch({ kind: "folderCreate", name: "Notes", sessionIds: ["s1"] });
  const first = snapshot.folders[0].id;
  snapshot = await f.patch({ kind: "folderCreate", name: "Next", sessionIds: ["s2"] });
  const second = snapshot.folders.find((row) => row.id !== first)!.id;
  await f.patch({ kind: "folderName", folderId: first, name: "Reviewed" });
  await f.patch({ kind: "folderMove", folderId: second, target: { kind: "into", id: first } });
  expect(loadSessionFolders("/alpha").find((row) => row.id === second)?.parentId).toBe(first);
  await f.patch({ kind: "folderMove", folderId: second, target: { kind: "root" } });
  await f.patch({ kind: "folderOrder", folderIds: [first, second] });
  expect(loadSessionFolders("/alpha")[0].id).toBe(first);
  await f.patch({ kind: "sessionMove", sessionId: "s2", folderId: first });
  await f.patch({ kind: "folderSessions", folderId: first, sessionIds: ["s2", "s1"] });
  expect(loadSessionFolders("/alpha")[0].sessionIds).toEqual(["s2", "s1"]);
  await f.patch({ kind: "sessionMove", sessionId: "s2", folderId: null });
  await f.patch({ kind: "sessionOrder", list: "loose", sessionIds: ["s2", "s1"] });
  expect(loadSessionOrder("/alpha").loose).toEqual(["s2", "s1"]);
  expect(loadSessionFolders("/private")).toEqual([
    { id: "private-folder", name: "Private", sessionIds: ["foreign"], collapsed: true },
  ]);
});
it("rejects stale/private/foreign/cyclic edits before persistence and exact-operation collisions", async () => {
  const f = fixture();
  const snapshot = await f.read();
  localStorage.setItem("bycoda.projectRailPinned", JSON.stringify(["/beta"]));
  expect(
    await f.control(f.context, "organization.patch", {
      expectedRevision: snapshot.revision,
      operationId: "stale",
      change: { kind: "projectName", name: "Stale" },
    }),
  ).toMatchObject({ state: "failed" });
  expect(loadCustomTabGroupLabels()[projectKey("/alpha")]).toBeUndefined();
  const fresh = await f.read();
  expect(
    await f.control(f.context, "organization.patch", {
      expectedRevision: fresh.revision,
      operationId: "foreign",
      change: { kind: "folderCreate", name: "Bad", sessionIds: ["foreign"] },
    }),
  ).toMatchObject({ state: "failed" });
  const input = {
    expectedRevision: fresh.revision,
    operationId: "exact",
    change: { kind: "projectName", name: "One" },
  };
  expect(
    ((await f.control(f.context, "organization.patch", input)) as ProjectOrganizationStatus).state,
  ).toBe("applied");
  await expect(
    f.control(f.context, "organization.patch", {
      ...input,
      change: { kind: "projectName", name: "Two" },
    }),
  ).rejects.toThrow("already used");
  privacy.lockedProjects.add(pathKey("/alpha"));
  await expect(f.read()).rejects.toThrow("private");
  f.revoke();
  expect(
    await f
      .control({ ...f.context, valid: () => true }, "organization.status", {
        operationId: "missing",
      })
      .catch(() => ({ state: "unavailable" })),
  ).toEqual({ state: "unavailable" });
});
it("does not report a swallowed canonical storage failure as success or replay the operation", async () => {
  const f = fixture();
  const snapshot = await f.read();
  const original = localStorage;
  const spy = vi.fn((key: string, value: string) => {
    if (key === "bycoda:tab-group:labels") throw new Error("quota");
    original.setItem(key, value);
  });
  vi.stubGlobal("localStorage", {
    getItem: original.getItem.bind(original),
    setItem: spy,
    removeItem: original.removeItem.bind(original),
  });
  try {
    const input = {
      expectedRevision: snapshot.revision,
      operationId: "failed",
      change: { kind: "projectName", name: "Unavailable" },
    };
    expect(await f.control(f.context, "organization.patch", input)).toMatchObject({
      state: "failed",
    });
    const calls = spy.mock.calls.length;
    expect(await f.control(f.context, "organization.patch", input)).toMatchObject({
      state: "failed",
    });
    expect(spy.mock.calls).toHaveLength(calls);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("reprojects receipt snapshots after another group becomes private and refuses privacy changes during a read", async () => {
  saveProjectGroups([
    { id: "public", name: "Public", collapsed: false },
    { id: "later-private", name: "Later private", collapsed: false },
  ]);
  privacy.groups = loadProjectGroups();
  const f = fixture();
  const preview = await f.read();
  const input = {
    expectedRevision: preview.revision,
    operationId: "privacy-receipt",
    change: { kind: "projectName", name: "Updated" },
  };
  await f.control(f.context, "organization.patch", input);
  privacy.lockedGroups.add("later-private");
  const status = (await f.control(f.context, "organization.status", {
    operationId: "privacy-receipt",
  })) as ProjectOrganizationStatus;
  expect(status.snapshot?.groups.map((row) => row.id)).toEqual(["public"]);
  const reading = createProjectOrganizationControl({
    sessions: async () => summaries,
    salt: () => "salt",
    hash: async () => {
      privacy.lockedGroups.add("public");
      return "a".repeat(64);
    },
  });
  await expect(reading(f.context, "organization.read", {})).rejects.toThrow(
    "changed while reading",
  );
});
it("records refused cyclic moves and serializes exact operation identities before awaited reads", async () => {
 saveSessionFolders("/alpha", [{ id: "parent", name: "Parent", sessionIds: ["s1"], collapsed: false }, { id: "child", name: "Child", sessionIds: ["s2"], parentId: "parent", collapsed: false }]); const f = fixture(); const initial = await f.read();
 const cycle = { expectedRevision: initial.revision, operationId: "cycle", change: { kind: "folderMove", folderId: "parent", target: { kind: "into", id: "child" } } };
 expect(await f.control(f.context, "organization.patch", cycle)).toMatchObject({ state: "failed" }); expect(loadSessionFolders("/alpha").find((row) => row.id === "parent")?.parentId).toBeUndefined();
 const preview = await f.read(); const base = { expectedRevision: preview.revision, operationId: "concurrent" };
 const results = await Promise.allSettled([f.control(f.context, "organization.patch", { ...base, change: { kind: "projectName", name: "One" } }), f.control(f.context, "organization.patch", { ...base, change: { kind: "projectName", name: "Two" } })]);
 expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1); expect(results.filter((row) => row.status === "rejected")).toHaveLength(1); expect(loadCustomTabGroupLabels()[projectKey("/alpha")]).toBe("One");
});
