// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { pathKey } from "../../../shared/lib/paths";
import {
  assignProjectsToNamedGroup,
  changeProjectGroupMembers,
  createProjectGroup,
  linkProjectGroup,
  loadProjectGroupAssignments,
  loadProjectGroups,
  moveProjectGroup,
  projectGroupWorkspaceRoot,
  nextProjectGroupName,
  reorderProjectGroups,
  saveProjectGroupAssignments,
  saveProjectGroups,
  setProjectGroupAssignment,
  unlinkProjectGroup,
} from "./projectGroups";

beforeEach(() => localStorage.clear());

describe("project groups", () => {
  it("uses the workspace file directory as the project root across path formats", () => {
    const group = { id: "wallet", name: "Wallet", collapsed: false };
    expect(projectGroupWorkspaceRoot(group)).toBeNull();
    expect(
      projectGroupWorkspaceRoot({ ...group, workspaceFile: "G:\\wallet\\wallet.code-workspace" }),
    ).toBe("G:/wallet");
    expect(
      projectGroupWorkspaceRoot({ ...group, workspaceFile: "/work/wallet/wallet.code-workspace" }),
    ).toBe("/work/wallet");
    expect(projectGroupWorkspaceRoot({ ...group, workspaceFile: "G:/wallet.code-workspace" })).toBe(
      "G:/",
    );
  });
  it("persists ordered appearance and collapsed state", () => {
    expect(
      saveProjectGroups([
        {
          id: "clients",
          name: "Clients",
          collapsed: true,
          customColor: "#AABBCC",
          mascot: "ghost",
        },
        {
          id: "personal",
          name: "Personal",
          collapsed: false,
          colorIndex: 4,
        },
      ]),
    ).toBe(true);

    expect(loadProjectGroups()).toEqual([
      {
        id: "clients",
        name: "Clients",
        collapsed: true,
        customColor: "#aabbcc",
        mascot: "orbit",
      },
      {
        id: "personal",
        name: "Personal",
        collapsed: false,
        colorIndex: 4,
      },
    ]);
  });

  it("keeps assignments only for groups that still exist", () => {
    saveProjectGroups([{ id: "clients", name: "Clients", collapsed: false }]);
    saveProjectGroupAssignments({
      [pathKey("/work/client")]: "clients",
      [pathKey("/work/stale")]: "missing",
    });

    expect(loadProjectGroupAssignments()).toEqual({
      [pathKey("/work/client")]: "clients",
    });
    expect(setProjectGroupAssignment("/work/client", null)).toEqual({});
  });

  it("creates stable unique default names", () => {
    const groups = [
      { id: "one", name: "New group", collapsed: false },
      { id: "two", name: "NEW GROUP 2", collapsed: false },
    ];
    expect(nextProjectGroupName(groups)).toBe("New group 3");
    expect(createProjectGroup(groups)).toMatchObject({
      name: "New group 3",
      collapsed: false,
    });
  });

  it("creates a named group and assigns projects to it", () => {
    const group = assignProjectsToNamedGroup(" Acme ", ["/work/web", "/work/api"]);

    expect(group).toMatchObject({ name: "Acme", collapsed: false });
    expect(loadProjectGroups()).toEqual([group]);
    expect(loadProjectGroupAssignments()).toEqual({
      [pathKey("/work/web")]: group?.id,
      [pathKey("/work/api")]: group?.id,
    });
  });

  it("reuses a group with the same name and moves projects into it", () => {
    saveProjectGroups([
      { id: "acme", name: "Acme", collapsed: true },
      { id: "other", name: "Other", collapsed: false },
    ]);
    saveProjectGroupAssignments({ [pathKey("/work/web")]: "other" });

    expect(assignProjectsToNamedGroup("ACME", ["/work/web"])?.id).toBe("acme");
    expect(loadProjectGroups()).toHaveLength(2);
    expect(loadProjectGroupAssignments()).toEqual({
      [pathKey("/work/web")]: "acme",
    });
  });

  it("does nothing without a name or projects", () => {
    expect(assignProjectsToNamedGroup("  ", ["/work/web"])).toBeNull();
    expect(assignProjectsToNamedGroup("Acme", [])).toBeNull();
    expect(loadProjectGroups()).toEqual([]);
  });
});

describe("linked workspace groups", () => {
  it("round-trips the link and keeps older groups unlinked", () => {
    saveProjectGroups([
      { id: "old", name: "Old", collapsed: false },
      { id: "acme", name: "Acme", collapsed: false },
    ]);
    linkProjectGroup("acme", "G:\\work\\acme.code-workspace", [
      "G:/work/web",
      "g:/WORK/web",
      "G:/work/api",
    ]);
    const [old, acme] = loadProjectGroups();
    expect(old).toEqual({ id: "old", name: "Old", collapsed: false });
    expect(acme).toMatchObject({
      workspaceFile: "G:/work/acme.code-workspace",
      workspaceFolders: ["G:/work/web", "G:/work/api"],
    });
  });

  it("drops folders without a file and invalid link fields", () => {
    localStorage.setItem(
      "bycoda.projectGroups",
      JSON.stringify([
        { id: "a", name: "A", collapsed: false, workspaceFolders: ["/x"] },
        { id: "b", name: "B", collapsed: false, workspaceFile: 4, workspaceFolders: 5 },
        {
          id: "c",
          name: "C",
          collapsed: false,
          workspaceFile: " /w.code-workspace ",
          workspaceFolders: [1, "", "/x"],
        },
      ]),
    );
    const [a, b, c] = loadProjectGroups();
    expect(a).not.toHaveProperty("workspaceFolders");
    expect(b).not.toHaveProperty("workspaceFile");
    expect(c).toMatchObject({ workspaceFile: "/w.code-workspace", workspaceFolders: ["/x"] });
  });

  it("unlinks without touching members", () => {
    saveProjectGroups([{ id: "acme", name: "Acme", collapsed: false }]);
    setProjectGroupAssignment("/work/web", "acme");
    linkProjectGroup("acme", "/w.code-workspace", ["/work/web"]);
    unlinkProjectGroup("acme");
    expect(loadProjectGroups()).toEqual([{ id: "acme", name: "Acme", collapsed: false }]);
    expect(loadProjectGroupAssignments()).toEqual({
      [pathKey("/work/web")]: "acme",
    });
  });

  it("changes members in one step and leaves projects moved elsewhere", () => {
    saveProjectGroups([
      { id: "acme", name: "Acme", collapsed: false },
      { id: "other", name: "Other", collapsed: false },
    ]);
    saveProjectGroupAssignments({
      [pathKey("/work/web")]: "acme",
      [pathKey("/work/api")]: "other",
    });
    changeProjectGroupMembers("acme", ["/work/docs"], ["/work/web", "/work/api"]);
    expect(loadProjectGroupAssignments()).toEqual({
      [pathKey("/work/api")]: "other",
      [pathKey("/work/docs")]: "acme",
    });
  });

  it("keeps the lockable flag only when it is set", () => {
    saveProjectGroups([
      { id: "a", name: "A", collapsed: false, lockable: true },
      { id: "b", name: "B", collapsed: false, lockable: false },
    ]);
    expect(loadProjectGroups().map((group) => group.lockable)).toEqual([true, undefined]);
  });
});

describe("group order", () => {
  const seed = () =>
    saveProjectGroups(
      ["a", "b", "c"].map((id) => ({
        id,
        name: id.toUpperCase(),
        collapsed: id === "b",
        lockable: id === "c" || undefined,
      })),
    );
  const ids = () => loadProjectGroups().map((group) => group.id);

  it("rewrites the saved array and keeps every group's own state", () => {
    seed();
    expect(reorderProjectGroups(["c", "a", "b"])).toBe(true);
    expect(ids()).toEqual(["c", "a", "b"]);
    const groups = loadProjectGroups();
    expect(groups.find((group) => group.id === "b")?.collapsed).toBe(true);
    expect(groups.find((group) => group.id === "c")?.lockable).toBe(true);
  });

  it("keeps groups a stale order leaves out, after the others", () => {
    seed();
    reorderProjectGroups(["b", "ghost"]);
    expect(ids()).toEqual(["b", "a", "c"]);
  });

  it("moves a group up, down or to the top", () => {
    seed();
    expect(moveProjectGroup("b", "up")).toBe(true);
    expect(ids()).toEqual(["b", "a", "c"]);
    moveProjectGroup("b", "down");
    moveProjectGroup("b", "down");
    expect(ids()).toEqual(["a", "c", "b"]);
    moveProjectGroup("b", "top");
    expect(ids()).toEqual(["b", "a", "c"]);
  });

  it("does nothing at the ends or for an unknown group", () => {
    seed();
    expect(moveProjectGroup("a", "up")).toBe(false);
    expect(moveProjectGroup("c", "down")).toBe(false);
    expect(moveProjectGroup("zzz", "top")).toBe(false);
    expect(ids()).toEqual(["a", "b", "c"]);
  });
});
