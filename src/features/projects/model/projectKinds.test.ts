// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { saveProjectGroupAssignments, saveProjectGroups } from "./projectGroups";
import {
  effectiveProjectKinds,
  inheritedProjectKind,
  projectKind,
  setProjectKind,
} from "./projectKinds";

beforeEach(() => localStorage.clear());

describe("project kinds", () => {
  it("stores and clears a project's own tag", () => {
    setProjectKind("G:/Work/App", "work");
    expect(projectKind("g:/work/app")).toBe("work");
    setProjectKind("G:/Work/App", undefined);
    expect(projectKind("G:/Work/App")).toBeUndefined();
  });

  it("ignores invalid stored values", () => {
    localStorage.setItem(
      "bycoda.projectKinds",
      JSON.stringify({ "g:/a": "other", "g:/b": "work" }),
    );
    expect(projectKind("G:/a")).toBeUndefined();
    expect(projectKind("G:/b")).toBe("work");
  });

  it("combines own tags over group tags, keyed for the Host", () => {
    saveProjectGroups([
      { id: "g1", name: "Job", collapsed: false, kind: "work" },
      { id: "g2", name: "Plain", collapsed: false },
    ]);
    saveProjectGroupAssignments({ "g:/a": "g1", "g:/b": "g1", "g:/c": "g2" });
    setProjectKind("G:/B", "personal");
    expect(inheritedProjectKind("G:/a")).toBe("work");
    expect(effectiveProjectKinds()).toEqual({ "g:/a": "work", "g:/b": "personal" });
  });
});
