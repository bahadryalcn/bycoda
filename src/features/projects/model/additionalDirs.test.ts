// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  additionalDirCandidates,
  additionalDirsForSession,
  loadSessionAdditionalDirs,
  removeSessionAdditionalDirs,
  saveSessionAdditionalDirs,
  loadAdditionalDirs,
  rebaseAdditionalDirs,
  removeAdditionalDirs,
  saveAdditionalDirs,
} from "./additionalDirs";
import { saveProjectGroupAssignments, saveProjectGroups } from "./projectGroups";
import { pathKey } from "../../../shared/lib/paths";
import { rememberProject } from "./recents";

beforeEach(() => localStorage.clear());

describe("additional project folders", () => {
  it("reports a rejected permission write and retains the last persisted folders", () => {
    expect(saveAdditionalDirs("/work/web", ["/work/api"])).toBe(true);
    const write = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage quota exceeded");
    });
    try {
      expect(saveAdditionalDirs("/work/web", [])).toBe(false);
      expect(loadAdditionalDirs("/work/web")).toEqual(["/work/api"]);
    } finally {
      write.mockRestore();
    }
  });
  it("is empty by default", () => {
    expect(loadAdditionalDirs("/work/web")).toEqual([]);
  });

  it("stores folders per project without duplicates or the project itself", () => {
    saveAdditionalDirs("/work/web", ["/work/api", "/work/web", "/work/api/", "/work/ui"]);

    expect(loadAdditionalDirs("/work/web")).toEqual(["/work/api", "/work/ui"]);
    expect(loadAdditionalDirs("/work/api")).toEqual([]);
  });

  it("clears and rebases", () => {
    saveAdditionalDirs("/work/web", ["/work/api"]);
    rebaseAdditionalDirs("/work/web", "/work/site");
    expect(loadAdditionalDirs("/work/web")).toEqual([]);
    expect(loadAdditionalDirs("/work/site")).toEqual(["/work/api"]);

    removeAdditionalDirs("/work/site");
    expect(loadAdditionalDirs("/work/site")).toEqual([]);
  });

  it("offers the other projects of the same group", () => {
    for (const path of ["/work/web", "/work/api", "/work/other", "/work/loose"]) {
      rememberProject(path);
    }
    saveProjectGroups([
      { id: "acme", name: "Acme", collapsed: false },
      { id: "misc", name: "Misc", collapsed: false },
    ]);
    saveProjectGroupAssignments({
      [pathKey("/work/web")]: "acme",
      [pathKey("/work/api")]: "acme",
      [pathKey("/work/other")]: "misc",
    });

    expect(additionalDirCandidates("/work/web")).toEqual(["/work/api"]);
    expect(additionalDirCandidates("/work/loose")).toEqual([]);
  });
});

describe("per-session additional folders", () => {
  function groupWeb() {
    for (const path of ["/work/web", "/work/api", "/work/ui"]) rememberProject(path);
    saveProjectGroups([{ id: "acme", name: "Acme", collapsed: false }]);
    saveProjectGroupAssignments({
      [pathKey("/work/web")]: "acme",
      [pathKey("/work/api")]: "acme",
      [pathKey("/work/ui")]: "acme",
    });
  }

  it("follows the project setting until the session overrides it", () => {
    groupWeb();
    saveAdditionalDirs("/work/web", ["/work/api"]);
    expect(additionalDirsForSession("s1", "/work/web")).toEqual(["/work/api"]);

    saveSessionAdditionalDirs("s1", "/work/web", ["/work/ui"]);
    expect(loadSessionAdditionalDirs("s1")).toEqual(["/work/ui"]);
    expect(additionalDirsForSession("s1", "/work/web")).toEqual(["/work/ui"]);
    expect(additionalDirsForSession("s2", "/work/web")).toEqual(["/work/api"]);
  });

  it("lets a session opt out of every folder", () => {
    groupWeb();
    saveAdditionalDirs("/work/web", ["/work/api"]);
    saveSessionAdditionalDirs("s1", "/work/web", []);
    expect(loadSessionAdditionalDirs("s1")).toEqual([]);
    expect(additionalDirsForSession("s1", "/work/web")).toEqual([]);
  });

  it("drops the override when it matches the project or is reset", () => {
    groupWeb();
    saveAdditionalDirs("/work/web", ["/work/api"]);
    saveSessionAdditionalDirs("s1", "/work/web", ["/work/api"]);
    expect(loadSessionAdditionalDirs("s1")).toBeUndefined();

    saveSessionAdditionalDirs("s1", "/work/web", ["/work/ui"]);
    saveSessionAdditionalDirs("s1", "/work/web", null);
    expect(loadSessionAdditionalDirs("s1")).toBeUndefined();
  });

  it("keeps explicitly chosen folders outside the project's rail group", () => {
    groupWeb();
    saveSessionAdditionalDirs("s1", "/work/web", ["/work/ui", "/work/web", "/work/gone"]);
    expect(additionalDirsForSession("s1", "/work/web")).toEqual(["/work/ui", "/work/gone"]);

    saveProjectGroupAssignments({ [pathKey("/work/web")]: "acme" });
    expect(additionalDirsForSession("s1", "/work/web")).toEqual(["/work/ui", "/work/gone"]);
  });

  it("keeps custom folder choices local to the session and deduplicates Windows paths", () => {
    saveSessionAdditionalDirs("s1", "C:/work/web", [
      "C:/work/api",
      "c:\\work\\API\\",
      "C:/work/web",
      "remote://host/project",
      "~",
      "/",
    ]);
    expect(additionalDirsForSession("s1", "C:/work/web")).toEqual(["C:/work/api"]);
    expect(additionalDirsForSession("s2", "C:/work/web")).toEqual([]);
    expect(loadAdditionalDirs("C:/work/web")).toEqual([]);
  });

  it("is forgotten when the session is deleted", () => {
    groupWeb();
    saveSessionAdditionalDirs("s1", "/work/web", ["/work/ui"]);
    saveSessionAdditionalDirs("s2", "/work/web", ["/work/api"]);
    removeSessionAdditionalDirs("s1");
    expect(loadSessionAdditionalDirs("s1")).toBeUndefined();
    expect(loadSessionAdditionalDirs("s2")).toEqual(["/work/api"]);
  });
});

describe("unreadable stored folders", () => {
  const PROJECTS_KEY = "bycoda.projectAdditionalDirs";
  const SESSIONS_KEY = "bycoda.sessionAdditionalDirs";

  it("keeps the last valid folders and never overwrites unreadable stored text", () => {
    saveAdditionalDirs("/work/web", ["/work/api"]);
    saveAdditionalDirs("/work/site", ["/work/ui"]);
    const corrupt = '{"/work/web": "oops"';
    localStorage.setItem(PROJECTS_KEY, corrupt);

    expect(loadAdditionalDirs("/work/web")).toEqual(["/work/api"]);
    expect(loadAdditionalDirs("/work/site")).toEqual(["/work/ui"]);
    expect(saveAdditionalDirs("/work/site", [])).toBe(false);
    expect(saveAdditionalDirs("/work/web", ["/work/ui"])).toBe(false);
    expect(rebaseAdditionalDirs("/work/web", "/work/moved")).toBe(false);
    expect(removeAdditionalDirs("/work/site")).toBe(false);
    expect(localStorage.getItem(PROJECTS_KEY)).toBe(corrupt);
  });

  it("treats a non-object or non-array value as unreadable", () => {
    localStorage.setItem(PROJECTS_KEY, '["/work/api"]');
    expect(saveAdditionalDirs("/work/web", ["/work/api"])).toBe(false);
    localStorage.setItem(PROJECTS_KEY, '{"/work/web": "/work/api"}');
    expect(saveAdditionalDirs("/work/web", ["/work/api"])).toBe(false);
    expect(localStorage.getItem(PROJECTS_KEY)).toBe('{"/work/web": "/work/api"}');
  });

  it("writes again once the stored text is cleared", () => {
    localStorage.setItem(PROJECTS_KEY, "not json");
    expect(saveAdditionalDirs("/work/web", ["/work/api"])).toBe(false);

    localStorage.removeItem(PROJECTS_KEY);
    expect(saveAdditionalDirs("/work/web", ["/work/api"])).toBe(true);
    expect(loadAdditionalDirs("/work/web")).toEqual(["/work/api"]);
  });

  it("does not overwrite unreadable session overrides", () => {
    saveAdditionalDirs("/work/web", ["/work/api"]);
    localStorage.setItem(SESSIONS_KEY, "not json");

    expect(saveSessionAdditionalDirs("s1", "/work/web", ["/work/ui"])).toBe(false);
    removeSessionAdditionalDirs("s1");
    expect(localStorage.getItem(SESSIONS_KEY)).toBe("not json");
    expect(loadSessionAdditionalDirs("s1")).toBeUndefined();
    expect(additionalDirsForSession("s1", "/work/web")).toEqual(["/work/api"]);
  });
});
