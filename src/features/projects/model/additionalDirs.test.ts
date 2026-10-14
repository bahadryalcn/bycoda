// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
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
