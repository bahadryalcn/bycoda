// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { projectKey } from "../../../shared/lib/paths";
import { saveTabGroupLabel, saveAutoTabGroupLabel } from "../../workspace/model/tabGroups";
import { projectMobileDirectory } from "./mobileProjectDirectory";
beforeEach(() => localStorage.clear());

describe("mobile desktop projection", () => {
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
    expect(projectMobileDirectory(input).projects[0]).toEqual({ cwd: path, name: "bycoda" });
    saveTabGroupLabel(projectKey(path), "");
    expect(projectMobileDirectory(input).projects[0]).toEqual({ cwd: path, name: "monocode" });
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
