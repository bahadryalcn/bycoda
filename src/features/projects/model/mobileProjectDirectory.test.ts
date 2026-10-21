// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { projectKey } from "../../../shared/lib/paths";
import {
  saveTabGroupLabel,
  saveAutoTabGroupLabel,
  saveTabGroupCustomColor,
  saveTabGroupColor,
  saveTabGroupMascot,
  resolveTabGroupColor,
  TAB_GROUP_COLORS,
} from "../../workspace/model/tabGroups";
import { projectMascot } from "./projectMascots";
import { buildMobileProjectDirectory, projectMobileDirectory } from "./mobileProjectDirectory";
import { archiveProject, rememberProject, saveProjectRailOrder } from "./recents";
import { saveSessionFolders } from "../../sessions/model/sessionFolders";
import { saveSessionOrder } from "../../sessions/model/sessionOrder";
beforeEach(() => localStorage.clear());

describe("mobile desktop projection", () => {
  it("exports saved colors and symbols and follows edits without changing identity", () => {
    const cwd = "G:/Projects/bycoda";
    const key = projectKey(cwd);
    const input = {
      paths: [cwd],
      groups: [],
      assignments: {},
      lock: { lockedGroupIds: new Set<string>(), lockedProjectKeys: new Set<string>() },
    };
    saveTabGroupCustomColor(key, "#aabbcc");
    saveTabGroupMascot(key, "union");
    expect(projectMobileDirectory(input).projects[0]).toMatchObject({
      cwd,
      appearance: {
        color: "#aabbcc",
        icon: { path: projectMascot("bycoda", "union").restPath },
      },
    });
    saveTabGroupCustomColor(key, null);
    saveTabGroupColor(key, 2);
    expect(projectMobileDirectory(input).projects[0].appearance?.color).toBe(TAB_GROUP_COLORS[2]);
    saveTabGroupColor(key, null);
    expect(projectMobileDirectory(input).projects[0].appearance?.color).toBe(
      resolveTabGroupColor(key, {}, {}, "bycoda"),
    );
  });
  it("does not resurrect forgotten projects from stale group assignments", () => {
    const result = projectMobileDirectory({
      paths: ["/visible"],
      groups: [{ id: "work", name: "Work", collapsed: false }],
      assignments: { "/visible": "work", "/forgotten": "work" },
      lock: { lockedGroupIds: new Set(), lockedProjectKeys: new Set() },
    });
    expect(result.projects.map((project) => project.cwd)).toEqual(["/visible"]);
    expect(result.projects[0]?.groupId).toBe("work");
  });
  it("exports nested session folders and manual order only for visible projects", () => {
    const folders = [
      { id: "f", name: "Work", sessionIds: ["one"], collapsed: false },
      {
        id: "child",
        name: "Details",
        parentId: "f",
        sessionIds: ["two"],
        collapsed: true,
        ordered: true,
      },
    ];
    saveSessionFolders("/work", folders);
    saveSessionOrder("/work", { loose: ["three", "four"] });
    saveSessionFolders("/private", [
      { id: "secret", name: "Secret", sessionIds: ["private-session"], collapsed: false },
    ]);
    const result = projectMobileDirectory({
      paths: ["/work", "/private"],
      groups: [],
      assignments: {},
      lock: { lockedGroupIds: new Set(), lockedProjectKeys: new Set(["/private"]) },
    });
    expect(result.projects[0]?.sessionLayout).toMatchObject({
      folders,
      order: { loose: ["three", "four"] },
    });
    expect(JSON.stringify(result.projects)).not.toContain("Secret");
    expect(JSON.stringify(result.projects)).not.toContain("private-session");
  });
  it("matches saved desktop rail order and omits archives even when a session remains open", () => {
    rememberProject("/one");
    rememberProject("/two");
    rememberProject("/archived");
    archiveProject("/archived");
    saveProjectRailOrder(["/two", "/one"]);
    expect(
      buildMobileProjectDirectory(["/archived"]).projects.map((project) => project.cwd),
    ).toEqual(["/two", "/one"]);
  });
  it("exports current rail names and updates them without changing project identity", () => {
    const path = "G:/Projects/monocode";
    const input = {
      paths: [path],
      groups: [],
      assignments: {},
      lock: { lockedGroupIds: new Set<string>(), lockedProjectKeys: new Set<string>() },
    };
    saveAutoTabGroupLabel(projectKey(path), "monocode 2");
    expect(projectMobileDirectory(input).projects[0].name).toBe("monocode 2");
    saveTabGroupLabel(projectKey(path), "bycoda");
    expect(projectMobileDirectory(input).projects[0]).toMatchObject({ cwd: path, name: "bycoda" });
    saveTabGroupLabel(projectKey(path), "");
    expect(projectMobileDirectory(input).projects[0]).toMatchObject({
      cwd: path,
      name: "monocode",
    });
  });
  const groups = [
    { id: "work", name: "Work", collapsed: true },
    { id: "hidden", name: "Hidden client", collapsed: false },
    { id: "locked", name: "Locked client", collapsed: false, lockable: true },
  ];
  const assignments = { "/work": "work", "/hidden": "hidden", "/locked": "locked" };
  it("omits protected names, members and remote paths using the existing lock snapshot", () => {
    const result = projectMobileDirectory({
      groups,
      assignments,
      paths: ["/work", "/hidden", "/locked", "remote://other/private"],
      lock: {
        lockedGroupIds: new Set(["hidden", "locked"]),
        lockedProjectKeys: new Set(["/hidden", "/locked"]),
      },
    });
    expect(result.groups.map((group) => group.id)).toEqual(["work"]);
    expect(result.projects.map((project) => project.cwd)).toEqual(["/work"]);
    expect(result.excludedPaths).toEqual(["/hidden", "/locked"]);
    expect(result.excludedGroupIds).toEqual(["hidden", "locked"]);
  });
  it("honors a temporarily unlocked group without applying another lock policy", () => {
    const result = projectMobileDirectory({
      groups,
      assignments,
      paths: ["/work", "/locked"],
      lock: { lockedGroupIds: new Set(["hidden"]), lockedProjectKeys: new Set(["/hidden"]) },
    });
    expect(result.groups.map((group) => group.id)).toEqual(["work", "locked"]);
    expect(result.projects.find((project) => project.cwd === "/locked")?.groupId).toBe("locked");
  });
});
