import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveProject,
  forgetProject,
  loadRecents,
  rememberProject,
} from "../../projects/model/recents";
import { remoteProjectFor } from "../../connections/model/remoteProjects";
import { pathKey } from "../../../shared/lib/paths";
import { loadCustomTabGroupLabels, loadTabGroupLabels } from "../../workspace/model/tabGroups";
import { captureLocalAppearanceChanges } from "./syncAppearance";
import { markPulled, takeOutbox } from "./syncPeerState";
import {
  applyRemoteProjectRecords,
  captureLocalProjectChanges,
  localProjectIdsByPath,
  projectIdForPath,
  remoteOnlyProjects,
  setLocalHostEnvironmentId,
  type RemoteOnlyProject,
} from "./syncProjects";
import { hostProjectId, machineProjectId } from "./syncProjectId";
import type { RemoteOpenTarget } from "./syncRemoteProjects";

const PEER = "host-1";

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

/** A folder's record: on a machine with a host, or on a desktop (`m-x`) without one. */
const idOf = (path: string, hostEnvironmentId?: string) =>
  hostEnvironmentId ? hostProjectId(hostEnvironmentId, path) : machineProjectId("m-x", path);

const pathRecord = (path: string, hostEnvironmentId?: string, archived = false) =>
  ({
    table: "projectPath",
    id: idOf(path, hostEnvironmentId),
    rev: 1,
    value: {
      projectId: idOf(path, hostEnvironmentId),
      path,
      archived,
      ...(hostEnvironmentId ? { hostEnvironmentId } : { machineId: "m-x" }),
    },
  }) as never;

function target(environmentId: string, name = "Windows PC") {
  const calls: { cwd: string; userInitiated: boolean }[] = [];
  let online = true;
  const value: RemoteOpenTarget = {
    environmentId,
    name,
    request: async (method, params, userInitiated) => {
      const { cwd } = params as { cwd: string };
      calls.push({ cwd, userInitiated });
      if (!online) throw new Error("offline");
      expect(method).toBe("projects.open");
      return { id: `id-${cwd}`, cwd, name: "x" };
    },
  };
  return { value, calls, setOnline: (next: boolean) => void (online = next) };
}

/** The module keeps its targets and retry state in memory, so each test gets its own copy. */
async function load() {
  vi.resetModules();
  return import("./syncRemoteProjects");
}

describe("remoteOpenMatch and remoteOnlyProjectHint", () => {
  const project: RemoteOnlyProject = {
    projectId: idOf("C:/code/app", "env-2"),
    name: "app",
    path: "C:/code/app",
    hostEnvironmentId: "env-2",
  };

  it("matches the machine whose host holds the folder", async () => {
    const { remoteOpenMatch, remoteOnlyProjectHint } = await load();
    const pc = target("env-2").value;
    const match = remoteOpenMatch(project, [target("env-9").value, pc]);
    expect(match).toEqual({ target: pc, path: "C:/code/app" });
    expect(remoteOnlyProjectHint(project, match)).toBe(
      "C:/code/app on Windows PC. Click to open it there.",
    );
  });

  it("has no match without a host id or without that machine", async () => {
    const { remoteOpenMatch, remoteOnlyProjectHint } = await load();
    expect(remoteOpenMatch(project, [target("env-9").value])).toBeUndefined();
    const { hostEnvironmentId: _host, ...hostless } = project;
    expect(remoteOpenMatch(hostless, [target("env-2").value])).toBeUndefined();
    expect(remoteOnlyProjectHint(project, undefined)).toBe(
      "C:/code/app is on a machine that is not connected to this one. Add that machine under Connections to open it.",
    );
  });
});

describe("autoAddRetryDelayMs", () => {
  it("doubles from one minute up to half an hour", async () => {
    const { autoAddRetryDelayMs } = await load();
    expect([1, 2, 3, 6, 20].map(autoAddRetryDelayMs)).toEqual([
      60_000, 120_000, 240_000, 1_800_000, 1_800_000,
    ]);
  });
});

describe("autoAddRemoteProjects", () => {
  beforeEach(mockLocalStorage);

  it("adds projects of a connected machine once, without a path for unmatched ones", async () => {
    const sync = await load();
    const pc = target("env-a");
    sync.setRemoteOpenTargets([pc.value]);
    const added = vi.fn();
    sync.subscribeSyncedProjectsAdded(added);
    rememberProject("/home/me/code/mine");
    applyRemoteProjectRecords(PEER, [
      pathRecord("C:\\code\\app", "env-a"),
      pathRecord("C:/code/old", "env-a", true),
      pathRecord("/srv/far", "env-c"),
      pathRecord("/srv/plain"),
    ]);

    expect(await sync.autoAddRemoteProjects()).toEqual(["remote://env-a/C:/code/app"]);
    expect(added).toHaveBeenCalledTimes(1);
    expect(pc.calls).toEqual([{ cwd: "C:\\code\\app", userInitiated: false }]);
    expect(loadRecents().map((item) => item.path)).toEqual([
      "/home/me/code/mine",
      "remote://env-a/C:/code/app",
    ]);
    expect(remoteProjectFor("remote://env-a/C:/code/app")).toMatchObject({
      environmentId: "env-a",
      cwd: "C:\\code\\app",
    });
    expect(remoteOnlyProjects()).toEqual([
      {
        projectId: "loc:env-c:/srv/far",
        name: "far",
        path: "/srv/far",
        hostEnvironmentId: "env-c",
      },
      { projectId: "loc:machine:m-x:/srv/plain", name: "plain", path: "/srv/plain" },
    ]);

    expect(await sync.autoAddRemoteProjects()).toEqual([]);
    expect(pc.calls).toHaveLength(1);
    expect(added).toHaveBeenCalledTimes(1);
  });

  it("does not add again a project the user removed or archived", async () => {
    const sync = await load();
    const pc = target("env-a");
    sync.setRemoteOpenTargets([pc.value]);
    applyRemoteProjectRecords(PEER, [
      pathRecord("/code/app", "env-a"),
      pathRecord("/code/site", "env-a"),
    ]);
    await sync.autoAddRemoteProjects();
    expect(pc.calls).toHaveLength(2);

    forgetProject("remote://env-a/code/app");
    archiveProject("remote://env-a/code/site");
    // Hidden at once, before the next cycle writes the dismissal down.
    expect(remoteOnlyProjects()).toEqual([]);
    expect(await sync.autoAddRemoteProjects()).toEqual([]);
    expect(await sync.autoAddRemoteProjects()).toEqual([]);
    expect(pc.calls).toHaveLength(2);
    expect(loadRecents()).toEqual([]);
    expect(remoteOnlyProjects()).toEqual([]);

    // A fresh copy of the module (an app restart) still knows.
    const restarted = await load();
    restarted.setRemoteOpenTargets([pc.value]);
    expect(await restarted.autoAddRemoteProjects()).toEqual([]);
    expect(pc.calls).toHaveLength(2);
  });

  it("stays silent while the machine is offline and retries with backoff", async () => {
    const sync = await load();
    const pc = target("env-a");
    pc.setOnline(false);
    sync.setRemoteOpenTargets([pc.value]);
    applyRemoteProjectRecords(PEER, [
      pathRecord("/code/app", "env-a"),
      pathRecord("/code/site", "env-a"),
    ]);

    expect(await sync.autoAddRemoteProjects(0)).toEqual([]);
    // One request for the unreachable machine, not one per project.
    expect(pc.calls).toHaveLength(1);
    expect(await sync.autoAddRemoteProjects(59_999)).toEqual([]);
    expect(pc.calls).toHaveLength(1);
    expect(await sync.autoAddRemoteProjects(60_000)).toEqual([]);
    expect(pc.calls).toHaveLength(2);
    expect(await sync.autoAddRemoteProjects(60_000 + 119_999)).toEqual([]);
    expect(pc.calls).toHaveLength(2);
    expect(remoteOnlyProjects()).toHaveLength(2);

    pc.setOnline(true);
    expect((await sync.autoAddRemoteProjects(60_000 + 120_000)).sort()).toEqual([
      "remote://env-a/code/app",
      "remote://env-a/code/site",
    ]);
    expect(remoteOnlyProjects()).toEqual([]);
  });

  it("does not offer the announced folder again when the host reports it under another path", async () => {
    const sync = await load();
    let opens = 0;
    sync.setRemoteOpenTargets([
      {
        environmentId: "env-a",
        name: "Mac",
        request: async () => {
          opens += 1;
          return { id: "p1", cwd: "/private/code/real-name", name: "real-name" };
        },
      },
    ]);
    applyRemoteProjectRecords(PEER, [pathRecord("/code/app", "env-a")]);
    expect(await sync.autoAddRemoteProjects()).toEqual(["remote://env-a/private/code/real-name"]);
    expect(projectIdForPath("remote://env-a/private/code/real-name")).toBe(
      "loc:env-a:/private/code/real-name",
    );
    expect(remoteOnlyProjects()).toEqual([]);
    expect(await sync.autoAddRemoteProjects()).toEqual([]);
    expect(opens).toBe(1);
  });
});

describe("adoptLocalProjects", () => {
  beforeEach(mockLocalStorage);

  const SHOP = "/Users/me/projects/shop";

  async function loadWithOwnHost() {
    const sync = await load();
    setLocalHostEnvironmentId("env-own");
    return sync;
  }

  it("adds a folder on this machine that another desktop opened remotely, once", async () => {
    const sync = await loadWithOwnHost();
    const pc = target("env-own");
    sync.setRemoteOpenTargets([pc.value]);
    let added = 0;
    sync.subscribeSyncedProjectsAdded(() => (added += 1));
    rememberProject("/home/me/mine");
    applyRemoteProjectRecords(PEER, [
      pathRecord(SHOP, "env-own"),
      pathRecord("G:/Projects/tool", "env-own"),
    ]);

    expect(await sync.adoptLocalProjects(async () => true)).toEqual([SHOP, "G:/Projects/tool"]);
    expect(loadRecents().map((item) => item.path)).toEqual([
      "/home/me/mine",
      SHOP,
      "G:/Projects/tool",
    ]);
    expect(projectIdForPath("G:\\Projects\\Tool")).toBe(idOf("G:/Projects/tool", "env-own"));
    expect(added).toBe(1);
    expect(await sync.adoptLocalProjects(async () => true)).toEqual([]);
    // Never as a remote project through its own host.
    expect(await sync.autoAddRemoteProjects()).toEqual([]);
    expect(pc.calls).toEqual([]);

    forgetProject(SHOP);
    expect(await sync.adoptLocalProjects(async () => true)).toEqual([]);
    expect(loadRecents().map((item) => item.path)).toEqual(["/home/me/mine", "G:/Projects/tool"]);
  });

  it("skips a folder that does not exist, an archived one, and one already here", async () => {
    const sync = await loadWithOwnHost();
    applyRemoteProjectRecords(PEER, [
      pathRecord(SHOP, "env-own"),
      pathRecord("/Users/me/projects/gone", "env-own"),
      pathRecord("/Users/me/projects/old", "env-own"),
      pathRecord("/code/far", "env-a"),
    ]);
    rememberProject("/Users/me/projects/old");
    archiveProject("/Users/me/projects/old");
    const asked: string[] = [];
    const exists = async (path: string) => {
      asked.push(path);
      return !path.endsWith("/gone");
    };
    expect(await sync.adoptLocalProjects(exists)).toEqual([SHOP]);
    expect(asked).toEqual([SHOP, "/Users/me/projects/gone"]);
    expect(loadRecents().map((item) => item.path)).toEqual([SHOP]);
  });

  it("does nothing until this machine knows its own host", async () => {
    const sync = await load();
    applyRemoteProjectRecords(PEER, [pathRecord(SHOP, "env-own")]);
    expect(await sync.adoptLocalProjects(async () => true)).toEqual([]);
  });
});

describe("nameAutoAddedProjects", () => {
  beforeEach(mockLocalStorage);

  const REMOTE_KEY = "remote://env-a/C:/code/app";

  async function addAppFromPc() {
    const sync = await load();
    sync.setRemoteOpenTargets([target("env-a").value]);
    rememberProject("/home/me/code/app");
    applyRemoteProjectRecords(PEER, [pathRecord("C:\\code\\app", "env-a")]);
    return { sync, added: await sync.autoAddRemoteProjects() };
  }

  it("allows matching folder names on distinct machines without renaming", async () => {
    const { sync, added } = await addAppFromPc();
    expect(added).toEqual([REMOTE_KEY]);
    sync.nameAutoAddedProjects(PEER, added);
    expect(loadTabGroupLabels()).toEqual({});
    expect(loadCustomTabGroupLabels()).toEqual({});

    captureLocalAppearanceChanges(PEER, localProjectIdsByPath());
    expect(takeOutbox(PEER).filter((op) => op.table === "appearance")).toEqual([]);
  });

  it("leaves the name to a label the host already holds for the project", async () => {
    const { sync, added } = await addAppFromPc();
    const id = projectIdForPath(REMOTE_KEY)!;
    markPulled(PEER, [
      { table: "appearance", id, rev: 2, value: { projectId: id, label: "PC app" } },
    ]);
    sync.nameAutoAddedProjects(PEER, added);
    expect(loadTabGroupLabels()).toEqual({});

    captureLocalProjectChanges(PEER);
    captureLocalAppearanceChanges(PEER, localProjectIdsByPath());
    expect(loadTabGroupLabels()).toEqual({ [pathKey(REMOTE_KEY)]: "PC app" });
  });

  it("does nothing when the name is free", async () => {
    const sync = await load();
    sync.setRemoteOpenTargets([target("env-a").value]);
    applyRemoteProjectRecords(PEER, [pathRecord("C:\\code\\app", "env-a")]);
    sync.nameAutoAddedProjects(PEER, await sync.autoAddRemoteProjects());
    expect(loadTabGroupLabels()).toEqual({});
  });
});

describe("openSyncedProjectRemotely", () => {
  beforeEach(mockLocalStorage);

  it("is unavailable when no connected machine has the project", async () => {
    const sync = await load();
    sync.setRemoteOpenTargets([target("env-a").value]);
    applyRemoteProjectRecords(PEER, [pathRecord("/srv/far", "env-c"), pathRecord("/srv/plain")]);
    expect(await sync.openSyncedProjectRemotely(idOf("/srv/far", "env-c"))).toEqual({
      status: "unavailable",
    });
    expect(await sync.openSyncedProjectRemotely(idOf("/srv/plain"))).toEqual({
      status: "unavailable",
    });
    expect(await sync.openSyncedProjectRemotely("loc:env-a:/nope")).toEqual({
      status: "unavailable",
    });
    expect(loadRecents()).toEqual([]);
  });

  it("retries a failed machine at once, as a user request, and reports a failure", async () => {
    const sync = await load();
    const pc = target("env-a");
    pc.setOnline(false);
    sync.setRemoteOpenTargets([pc.value]);
    applyRemoteProjectRecords(PEER, [pathRecord("/code/app", "env-a")]);
    await sync.autoAddRemoteProjects(0);

    const id = idOf("/code/app", "env-a");
    expect(await sync.openSyncedProjectRemotely(id)).toMatchObject({ status: "failed" });
    pc.setOnline(true);
    expect(await sync.openSyncedProjectRemotely(id)).toEqual({
      status: "opened",
      key: "remote://env-a/code/app",
    });
    expect(pc.calls.map((call) => call.userInitiated)).toEqual([false, true, true]);
    expect(loadRecents().map((item) => item.path)).toEqual(["remote://env-a/code/app"]);
  });
});
