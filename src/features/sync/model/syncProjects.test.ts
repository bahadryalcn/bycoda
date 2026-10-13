import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyRemoteProjectRecords,
  dismissRemoteProject,
  captureLocalProjectChanges,
  locallyAdoptableProjects,
  localPathKeyForProjectId,
  localProjectIdsByPath,
  mergeRailLayout,
  projectIdForPath,
  remoteOnlyProjects,
  setKnownHostEnvironments,
  setLocalHostEnvironmentId,
} from "./syncProjects";
import { hostProjectId, machineProjectId } from "./syncProjectId";
import { pathKey } from "../../../shared/lib/paths";
import {
  loadProjectGroupAssignments,
  saveProjectGroupAssignments,
  saveProjectGroups,
} from "../../projects/model/projectGroups";
import { applyPushResult, markPullCompleted, markPulled, takeOutbox } from "./syncPeerState";
import { localMachineId } from "./syncMachineId";
import {
  archiveProject,
  forgetProject,
  loadProjectRailOrder,
  loadRecents,
  loadPinnedProjects,
  rememberProject,
  savePinnedProjects,
  saveProjectRailOrder,
} from "../../projects/model/recents";

function mockLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
    configurable: true,
  });
}

const MACHINE = "host-1";

/** The id of a folder on this desktop while it has no host of its own. */
const mine = (path: string) => machineProjectId(localMachineId(), path);

/** A folder's record as its holder pushes it: through its host, or (`m2`) without one. */
const record = (path: string, hostEnvironmentId?: string, archived = false) => {
  const projectId = hostEnvironmentId
    ? hostProjectId(hostEnvironmentId, path)
    : machineProjectId("m2", path);
  return {
    table: "projectPath",
    id: projectId,
    rev: 1,
    value: {
      projectId,
      path,
      archived,
      ...(hostEnvironmentId ? { hostEnvironmentId } : { machineId: "m2" }),
    },
  } as const;
};

const settle = () => {
  const sent = takeOutbox(MACHINE);
  applyPushResult(
    MACHINE,
    {
      rev: sent.length,
      applied: sent.map((op, i) => ({ table: op.table, id: op.id, rev: i + 1 })),
      rejected: [],
    },
    sent,
  );
};

describe("syncProjects", () => {
  beforeEach(mockLocalStorage);

  it("captures a new local project as a project + projectPath op, keyed by where the folder is", () => {
    rememberProject("/home/me/code/app");
    captureLocalProjectChanges(MACHINE);
    const ops = takeOutbox(MACHINE);
    const id = mine("/home/me/code/app");
    expect(id).toBe(`loc:machine:${localMachineId()}:/home/me/code/app`);
    expect(ops.find((op) => op.table === "projectPath")).toEqual({
      table: "projectPath",
      id,
      baseRev: 0,
      value: {
        projectId: id,
        machineId: localMachineId(),
        path: "/home/me/code/app",
        archived: false,
      },
    });
    expect(ops.some((op) => op.table === "project" && op.id === id)).toBe(true);
  });

  it("captures the rail order as a railLayout op", () => {
    rememberProject("/home/me/code/app");
    saveProjectRailOrder(["/home/me/code/app"]);
    captureLocalProjectChanges(MACHINE);
    // Not before the first pull: the host may hold a richer layout.
    expect(takeOutbox(MACHINE).some((op) => op.table === "railLayout")).toBe(false);
    markPullCompleted(MACHINE);
    captureLocalProjectChanges(MACHINE);
    const layout = takeOutbox(MACHINE).find((op) => op.table === "railLayout");
    expect(layout?.value).toEqual({ order: [mine("/home/me/code/app")], pinned: [] });
  });

  it("does not re-queue a project whose path is already captured", () => {
    rememberProject("/home/me/code/app");
    captureLocalProjectChanges(MACHINE);
    captureLocalProjectChanges(MACHINE);
    const pathOps = takeOutbox(MACHINE).filter((op) => op.table === "projectPath");
    expect(pathOps).toHaveLength(1);
  });

  it("applying a railLayout record from the peer updates the local rail order", () => {
    rememberProject("/home/me/code/app");
    captureLocalProjectChanges(MACHINE);
    const id = Object.values(localProjectIdsByPath())[0];
    applyRemoteProjectRecords(MACHINE, [
      { table: "railLayout", id: "rail", rev: 1, value: { order: ["unknown-id", id], pinned: [] } },
    ]);
    expect(loadProjectRailOrder()).toEqual(["/home/me/code/app"]);
  });

  it("resolves a projectId back to its local path key", () => {
    rememberProject("/home/me/code/app");
    captureLocalProjectChanges(MACHINE);
    const [[key, id]] = Object.entries(localProjectIdsByPath());
    expect(localPathKeyForProjectId(id)).toBe(key);
    expect(localPathKeyForProjectId("nope")).toBeUndefined();
  });

  it("keeps a project's createdAt stable across captures", () => {
    rememberProject("/home/me/code/app");
    captureLocalProjectChanges(MACHINE);
    const first = takeOutbox(MACHINE).find((op) => op.table === "project")!.value as {
      createdAt: number;
    };
    const spy = vi.spyOn(Date, "now").mockReturnValue(first.createdAt + 100000);
    captureLocalProjectChanges(MACHINE);
    spy.mockRestore();
    const second = takeOutbox(MACHINE).find((op) => op.table === "project")!.value as {
      createdAt: number;
    };
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("applying our own project/projectPath echo back does not duplicate local recents", () => {
    rememberProject("/home/me/code/app");
    captureLocalProjectChanges(MACHINE);
    const ops = takeOutbox(MACHINE);
    const projectOp = ops.find((op) => op.table === "project")!;
    const pathOp = ops.find((op) => op.table === "projectPath")!;
    applyRemoteProjectRecords(MACHINE, [
      { table: "project", id: projectOp.id, rev: 1, value: projectOp.value as any },
      { table: "projectPath", id: pathOp.id, rev: 2, value: pathOp.value as any },
    ]);
    expect(loadRecents()).toHaveLength(1);
    expect(remoteOnlyProjects()).toEqual([]);
    forgetProject("/home/me/code/app");
    expect(remoteOnlyProjects()).toEqual([]);
  });

  it("keeps other machines' ids from the last pulled layout, but not ids of the older name-based scheme", () => {
    rememberProject("/home/me/code/app");
    markPulled(MACHINE, [
      {
        table: "railLayout",
        id: "rail",
        rev: 1,
        value: { order: ["name:app", "loc:env-x:/a"], pinned: ["loc:env-x:/b", "name:old"] },
      },
    ]);
    captureLocalProjectChanges(MACHINE);
    const id = mine("/home/me/code/app");
    const layout = () => takeOutbox(MACHINE).find((op) => op.table === "railLayout")?.value;
    expect(layout()).toEqual({ order: ["loc:env-x:/a"], pinned: ["loc:env-x:/b"] });
    saveProjectRailOrder(["/home/me/code/app"]);
    savePinnedProjects(["/home/me/code/app"]);
    captureLocalProjectChanges(MACHINE);
    expect(layout()).toEqual({ order: ["loc:env-x:/a", id], pinned: ["loc:env-x:/b", id] });
  });

  it("keeps same-named folders in different places apart", () => {
    rememberProject("/home/me/code/App");
    rememberProject("/work/app");
    captureLocalProjectChanges(MACHINE);
    const pathOps = takeOutbox(MACHINE).filter((op) => op.table === "projectPath");
    expect(pathOps.map((op) => op.id).sort()).toEqual(
      [mine("/home/me/code/App"), mine("/work/app")].sort(),
    );
    expect(Object.values(localProjectIdsByPath()).sort()).toEqual(
      pathOps.map((op) => op.id).sort(),
    );
  });

  it("gives a Windows folder one id however its path is written", () => {
    expect(projectIdForPath("G:\\Projects\\My App\\")).toBe(projectIdForPath("g:/projects/my app"));
    expect(projectIdForPath("/home/me/App")).not.toBe(projectIdForPath("/home/me/app"));
  });

  it("keeps the pins a railLayout record does not cover", () => {
    rememberProject("/home/me/code/app");
    rememberProject("/home/me/code/new");
    captureLocalProjectChanges(MACHINE);
    savePinnedProjects(["remote://box/x", "/home/me/code/new"]);
    const id = mine("/home/me/code/app");
    applyRemoteProjectRecords(MACHINE, [
      { table: "railLayout", id: "rail", rev: 1, value: { order: [id], pinned: [id] } },
    ]);
    expect(loadPinnedProjects()).toEqual([
      "/home/me/code/app",
      "remote://box/x",
      "/home/me/code/new",
    ]);
    applyRemoteProjectRecords(MACHINE, [
      { table: "railLayout", id: "rail", rev: 2, value: { order: [id], pinned: [] } },
    ]);
    expect(loadPinnedProjects()).toEqual(["remote://box/x", "/home/me/code/new"]);
  });
});

describe("mergeRailLayout", () => {
  it("equals the host layout when nothing changed locally", () => {
    const host = { order: ["a", "x", "b"], pinned: ["x", "a"] };
    expect(mergeRailLayout(host, ["a", "b"], ["a"], new Set(["a", "b"]))).toEqual(host);
  });

  it("is a fixed point across two machines", () => {
    const aOwn = new Set(["a", "c"]);
    const bOwn = new Set(["b", "c"]);
    let host = { order: [] as string[], pinned: [] as string[] };
    host = mergeRailLayout(host, ["a", "c"], ["a"], aOwn);
    host = mergeRailLayout(host, ["c", "b"], ["b"], bOwn);
    const afterB = host;
    const afterA = mergeRailLayout(afterB, ["a", "c"], ["a"], aOwn);
    expect(afterA).toEqual(afterB);
    expect(mergeRailLayout(afterA, ["c", "b"], ["b"], bOwn)).toEqual(afterA);
  });
});

describe("projects that are only on another machine", () => {
  beforeEach(mockLocalStorage);

  it("filters previously synced plugin links from suggestions and local adoption", () => {
    setLocalHostEnvironmentId("env-own");
    applyRemoteProjectRecords(MACHINE, [
      record("plugin://gmail-plugin-gmail-openai-curated-remote", "env-other"),
      record("plugin://sites-plugin-sites-openai-bundled-bir", "env-own"),
    ]);
    expect(remoteOnlyProjects()).toEqual([]);
    expect(locallyAdoptableProjects()).toEqual([]);
  });

  it("keeps a dismissed suggestion hidden after sync offers it again", () => {
    setLocalHostEnvironmentId("env-own");
    const records = [record("/srv/app", "env-other"), record("/srv/keep", "env-other")];
    applyRemoteProjectRecords(MACHINE, records);
    dismissRemoteProject(hostProjectId("env-other", "/srv/app"));
    applyRemoteProjectRecords(MACHINE, records);
    expect(remoteOnlyProjects().map((project) => project.path)).toEqual(["/srv/keep"]);
  });

  it("lists them by folder, minus archived ones and ones on this rail", () => {
    setLocalHostEnvironmentId("env-own");
    rememberProject("/home/me/code/app");
    applyRemoteProjectRecords(MACHINE, [
      record("/home/me/code/app", "env-own"),
      record("C:/x/App", "env-2"),
      record("/y/site"),
      record("C:/x/old", "env-2", true),
    ]);
    expect(remoteOnlyProjects()).toEqual([
      {
        projectId: "loc:env-2:c:/x/app",
        name: "App",
        path: "C:/x/App",
        hostEnvironmentId: "env-2",
      },
      { projectId: "loc:machine:m2:/y/site", name: "site", path: "/y/site" },
    ]);
  });

  it("hides a previous host's copy of a folder its machine's current host has", () => {
    setLocalHostEnvironmentId("env-own");
    applyRemoteProjectRecords(MACHINE, [
      record("/Users/me/projects/clip", "env-mac-old"),
      record("/Users/me/projects/clip", "env-mac"),
      record("/Users/me/projects/notes", "env-mac-old"),
      record("/srv/app", "env-unadded"),
    ]);
    // Before the saved machines are known nothing is hidden.
    expect(remoteOnlyProjects()).toHaveLength(4);
    setKnownHostEnvironments(["env-mac"]);
    expect(remoteOnlyProjects().map((project) => project.projectId)).toEqual([
      // A folder only the old host knew is still offered; its machine may be gone.
      "loc:env-unadded:/srv/app",
      "loc:env-mac:/Users/me/projects/clip",
      "loc:env-mac-old:/Users/me/projects/notes",
    ]);
  });

  it("hides a previous host's copy of a remote project already on this rail", () => {
    setLocalHostEnvironmentId("env-own");
    rememberProject("remote://env-mac/Users/me/projects/clip");
    applyRemoteProjectRecords(MACHINE, [record("/Users/me/projects/clip", "env-mac-old")]);
    setKnownHostEnvironments(["env-mac"]);
    expect(remoteOnlyProjects()).toEqual([]);
  });

  it("lists a same-named folder of another machine next to the local one", () => {
    setLocalHostEnvironmentId("env-m");
    rememberProject("/Users/me/projects/bycoda");
    applyRemoteProjectRecords(MACHINE, [record("G:/Projects/app", "env-w")]);
    expect(remoteOnlyProjects().map((project) => project.projectId)).toEqual([
      "loc:env-w:g:/projects/app",
    ]);
  });

  it("ignores records of the older name-based scheme and ones stored under a foreign id", () => {
    applyRemoteProjectRecords(MACHINE, [
      {
        table: "projectPath",
        id: "name:site:m2",
        rev: 1,
        value: {
          projectId: "name:site",
          machineId: "m2",
          path: "C:/x/site",
          archived: false,
          hostEnvironmentId: "env-2",
        },
      },
      { ...record("C:/x/site", "env-2"), id: "loc:env-2:c:/x/other" },
    ]);
    expect(remoteOnlyProjects()).toEqual([]);
    expect(locallyAdoptableProjects()).toEqual([]);
  });

  it("forgets a folder whose record was deleted", () => {
    applyRemoteProjectRecords(MACHINE, [record("/y/site")]);
    expect(remoteOnlyProjects()).toHaveLength(1);
    applyRemoteProjectRecords(MACHINE, [
      { table: "projectPath", id: record("/y/site").id, rev: 2, value: null },
    ]);
    expect(remoteOnlyProjects()).toEqual([]);
  });

  it("a folder on this machine's own host is adoptable, not a placeholder", () => {
    setLocalHostEnvironmentId("env-own");
    applyRemoteProjectRecords(MACHINE, [
      record("/Users/me/projects/shop", "env-own"),
      record("/Users/me/projects/old", "env-own", true),
      record("/Users/me/projects/mine", "env-own"),
      record("/code/far", "env-a"),
    ]);
    rememberProject("/Users/me/projects/mine");
    expect(locallyAdoptableProjects()).toEqual([
      { projectId: "loc:env-own:/Users/me/projects/shop", path: "/Users/me/projects/shop" },
    ]);
    expect(remoteOnlyProjects().map((project) => project.projectId)).toEqual([
      "loc:env-a:/code/far",
    ]);
  });

  it("a project the user took off the rail is not offered or adopted again", () => {
    setLocalHostEnvironmentId("env-own");
    rememberProject("/Users/me/projects/shop");
    rememberProject("remote://env-a/code/far");
    captureLocalProjectChanges(MACHINE);
    applyRemoteProjectRecords(MACHINE, [
      record("/Users/me/projects/shop", "env-own"),
      record("/code/far", "env-a"),
    ]);
    forgetProject("/Users/me/projects/shop");
    forgetProject("remote://env-a/code/far");
    // At once, and after the next capture stored it.
    expect([locallyAdoptableProjects(), remoteOnlyProjects()]).toEqual([[], []]);
    captureLocalProjectChanges(MACHINE);
    captureLocalProjectChanges(MACHINE);
    expect([locallyAdoptableProjects(), remoteOnlyProjects()]).toEqual([[], []]);
  });
});

describe("the host in a local folder's id", () => {
  beforeEach(mockLocalStorage);

  const pathOps = () => takeOutbox(MACHINE).filter((op) => op.table === "projectPath");

  it("is this machine's own host once known; records pushed before that are deleted, once", () => {
    rememberProject("/home/me/code/app");
    saveProjectRailOrder(["/home/me/code/app"]);
    markPullCompleted(MACHINE);
    captureLocalProjectChanges(MACHINE);
    const before = mine("/home/me/code/app");
    expect(pathOps().map((op) => op.id)).toEqual([before]);
    settle();

    setLocalHostEnvironmentId("env-1");
    captureLocalProjectChanges(MACHINE);
    const after = "loc:env-1:/home/me/code/app";
    expect(pathOps()).toEqual([
      {
        table: "projectPath",
        id: after,
        baseRev: 0,
        value: {
          projectId: after,
          hostEnvironmentId: "env-1",
          path: "/home/me/code/app",
          archived: false,
        },
      },
      { table: "projectPath", id: before, baseRev: expect.any(Number), value: null },
    ]);
    expect(takeOutbox(MACHINE).find((op) => op.table === "railLayout")?.value).toEqual({
      order: [after],
      pinned: [],
    });
    expect(localProjectIdsByPath()).toEqual({ [pathKey("/home/me/code/app")]: after });
    settle();
    captureLocalProjectChanges(MACHINE);
    captureLocalProjectChanges(MACHINE);
    expect(takeOutbox(MACHINE)).toEqual([]);
    // The folder itself never left the rail.
    expect(loadRecents().map((item) => item.path)).toEqual(["/home/me/code/app"]);
  });

  it("carries the archived state of the machine that holds the folder", () => {
    setLocalHostEnvironmentId("env-1");
    rememberProject("/home/me/code/app");
    archiveProject("/home/me/code/app");
    captureLocalProjectChanges(MACHINE);
    expect(pathOps()[0].value).toMatchObject({ archived: true, hostEnvironmentId: "env-1" });
  });
});

describe("remote:// rail projects", () => {
  beforeEach(mockLocalStorage);

  const REMOTE = "remote://env-a/C:/Code/App";
  const APP = "loc:env-a:c:/code/app";

  it("get the id of their folder on its host and announce it under that id", () => {
    rememberProject(REMOTE);
    rememberProject("remote://env-a/home/me/Site");
    captureLocalProjectChanges(MACHINE);
    expect(localProjectIdsByPath()).toEqual({
      [pathKey(REMOTE)]: APP,
      [pathKey("remote://env-a/home/me/Site")]: "loc:env-a:/home/me/Site",
    });
    expect(localPathKeyForProjectId(APP)).toBe(pathKey(REMOTE));
    const paths = takeOutbox(MACHINE).filter((op) => op.table === "projectPath");
    expect(paths.map((op) => op.id).sort()).toEqual([APP, "loc:env-a:/home/me/Site"].sort());
    expect(paths.find((op) => op.id === APP)?.value).toEqual({
      projectId: APP,
      hostEnvironmentId: "env-a",
      path: "C:/Code/App",
      archived: false,
    });
    captureLocalProjectChanges(MACHINE);
    expect(takeOutbox(MACHINE).filter((op) => op.table === "projectPath")).toHaveLength(2);
  });

  it("are the same project as the folder itself on the machine that holds it", () => {
    const remoteId = projectIdForPath(REMOTE);
    setLocalHostEnvironmentId("env-a");
    expect(projectIdForPath("C:\\Code\\App")).toBe(remoteId);
    expect(remoteId).toBe(APP);
  });

  it("are not announced when on this machine's own host, archived here, or already recorded on the host", () => {
    setLocalHostEnvironmentId("env-own");
    rememberProject("remote://env-own/home/me/self");
    rememberProject("remote://env-b/code/shelved");
    archiveProject("remote://env-b/code/shelved");
    rememberProject(REMOTE);
    // The holder wrote the path its own way, and archived it: neither is touched from here.
    markPulled(MACHINE, [{ ...record("c:/code/app", "env-a", true), rev: 1 }]);
    captureLocalProjectChanges(MACHINE);
    expect(takeOutbox(MACHINE).filter((op) => op.table === "projectPath")).toEqual([]);
    expect(localPathKeyForProjectId(APP)).toBe(pathKey(REMOTE));
  });

  it("are not listed as missing here", () => {
    applyRemoteProjectRecords(MACHINE, [
      record("C:/Code/App", "env-a"),
      record("C:/Code/site", "env-a"),
    ]);
    rememberProject(REMOTE);
    expect(remoteOnlyProjects().map((project) => project.projectId)).toEqual([
      "loc:env-a:c:/code/site",
    ]);
  });

  it("take the rail slot and pin the host has for them, then sync later edits", () => {
    const MINE = mine("/home/me/code/mine");
    const OTHER = "loc:env-x:/other";
    rememberProject("/home/me/code/mine");
    saveProjectRailOrder(["/home/me/code/mine"]);
    markPulled(MACHINE, [
      { table: "railLayout", id: "rail", rev: 1, value: { order: [APP, OTHER], pinned: [APP] } },
    ]);
    captureLocalProjectChanges(MACHINE);
    takeOutbox(MACHINE);

    rememberProject(REMOTE);
    saveProjectRailOrder(["/home/me/code/mine", REMOTE]);
    captureLocalProjectChanges(MACHINE);
    const layout = () => takeOutbox(MACHINE).find((op) => op.table === "railLayout")?.value;
    expect(layout()).toEqual({ order: [APP, OTHER, MINE], pinned: [APP] });
    expect(loadProjectRailOrder()).toEqual([REMOTE, "/home/me/code/mine"]);
    expect(loadPinnedProjects()).toEqual([REMOTE]);

    // Nothing changed locally since: the same layout again.
    captureLocalProjectChanges(MACHINE);
    expect(layout()).toEqual({ order: [APP, OTHER, MINE], pinned: [APP] });

    savePinnedProjects([]);
    captureLocalProjectChanges(MACHINE);
    expect(layout()).toEqual({ order: [APP, OTHER, MINE], pinned: [] });
  });

  it("follow an incoming layout, while remote projects without an id keep their pin", () => {
    rememberProject(REMOTE);
    rememberProject("/home/me/code/mine");
    captureLocalProjectChanges(MACHINE);
    savePinnedProjects([REMOTE, "remote://box/unknown"]);
    const MINE = mine("/home/me/code/mine");
    applyRemoteProjectRecords(MACHINE, [
      { table: "railLayout", id: "rail", rev: 1, value: { order: [APP, MINE], pinned: [MINE] } },
    ]);
    expect(loadProjectRailOrder()).toEqual([REMOTE, "/home/me/code/mine"]);
    expect(loadPinnedProjects()).toEqual(["/home/me/code/mine", "remote://box/unknown"]);
  });

  it("hand their group to the local folder when both are on the rail of the machine that holds it", () => {
    setLocalHostEnvironmentId("env-own");
    const viaHost = "remote://env-own/home/me/code/app";
    saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    rememberProject(viaHost);
    saveProjectGroupAssignments({ [pathKey(viaHost)]: "g1" });
    captureLocalProjectChanges(MACHINE);
    expect(takeOutbox(MACHINE).filter((op) => op.table === "projectPath")).toEqual([]);
    rememberProject("/home/me/code/app");
    captureLocalProjectChanges(MACHINE);
    expect(localProjectIdsByPath()).toEqual({
      [pathKey("/home/me/code/app")]: "loc:env-own:/home/me/code/app",
    });
    expect(loadProjectGroupAssignments()[pathKey("/home/me/code/app")]).toBe("g1");
  });
});
