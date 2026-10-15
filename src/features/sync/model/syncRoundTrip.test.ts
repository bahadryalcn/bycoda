import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pathKey } from "../../../shared/lib/paths";

const HOST = "host-1";

/** What the desktop's Rust transport does to every JSON value passing
 * through it: object keys come out alphabetically sorted. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => [key, sortDeep(item)]),
  );
}

const throughTransport = (value: unknown): any => sortDeep(JSON.parse(JSON.stringify(value)));

type Row = { table: string; id: string; rev: number; value: unknown };

/** A deliberately naive host: every accepted op bumps the revision, even a
 * redundant one, so a stable revision proves the clients stopped pushing. */
function fakeHost(unknownTables: readonly string[] = []) {
  let rev = 0;
  const rows = new Map<string, Row>();
  const pushedOps: { table: string; id: string; value: unknown }[] = [];
  const request = async (method: string, rawParams: unknown): Promise<unknown> => {
    const params = throughTransport(rawParams);
    if (method === "sync.pull") {
      const records = [...rows.values()]
        .filter((row) => row.rev > params.sinceRev)
        .sort((a, b) => a.rev - b.rev);
      return throughTransport({ rev, records });
    }
    const applied: unknown[] = [];
    const rejected: unknown[] = [];
    for (const op of params.ops) {
      pushedOps.push(op);
      // An older host skips an op for a table it does not know.
      if (unknownTables.includes(op.table)) continue;
      const key = `${op.table}:${op.id}`;
      const existing = rows.get(key);
      if ((existing?.rev ?? 0) !== op.baseRev) {
        rejected.push({
          table: op.table,
          id: op.id,
          current: existing ?? { table: op.table, id: op.id, rev: 0, value: null },
        });
        continue;
      }
      rev += 1;
      rows.set(key, { table: op.table, id: op.id, rev, value: op.value });
      applied.push({ table: op.table, id: op.id, rev });
    }
    return throughTransport({ rev, applied, rejected });
  };
  return {
    request,
    rev: () => rev,
    /** Puts a record on the host as an earlier client left it. */
    seed: (table: string, id: string, value: unknown) => {
      rev += 1;
      rows.set(`${table}:${id}`, { table, id, rev, value });
      return rev;
    },
    ids: (table: string) =>
      [...rows.values()]
        .filter((row) => row.table === table)
        .map((row) => row.id)
        .sort(),
    pushedOps,
    value: (table: string, id: string) => rows.get(`${table}:${id}`)?.value,
    tables: () => new Set([...rows.values()].map((row) => row.table)),
  };
}

/** One desktop: its own localStorage and its own instances of every module
 * that keeps state in memory (machine id, lock settings). */
async function makeDesktop(machineId: string) {
  const data = new Map<string, string>([["bycoda.sync.machineId", machineId]]);
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
  const use = () =>
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  use();
  vi.resetModules();
  const client = await import("./syncClient");
  const groups = await import("../../projects/model/projectGroups");
  const recents = await import("../../projects/model/recents");
  const lock = await import("../../group-lock/model/groupLock");
  const projects = await import("./syncProjects");
  const remoteProjects = await import("./syncRemoteProjects");
  const appearance = await import("../../workspace/model/tabGroups");
  const peerState = await import("./syncPeerState");
  const cycle = async (host: ReturnType<typeof fakeHost>) => {
    use();
    await client.runSyncCycle(HOST, host.request);
  };
  const assignmentFor = (path: string) => {
    use();
    return groups.loadProjectGroupAssignments()[pathKey(path)];
  };
  const look = (path: string) => {
    use();
    const key = pathKey(path);
    return {
      label: appearance.resolveTabGroupLabel(key, appearance.loadTabGroupLabels(), "folder name"),
      colorIndex: appearance.resolveTabGroupColorIndex(
        key,
        appearance.loadTabGroupColors(),
        appearance.loadTabGroupCustomColors(),
      ),
      mascot: appearance.resolveTabGroupMascot(key, appearance.loadTabGroupMascots()),
    };
  };
  return {
    use,
    storage,
    cycle,
    assignmentFor,
    look,
    client,
    groups,
    recents,
    lock,
    projects,
    remoteProjects,
    appearance,
    peerState,
  };
}

describe("sync over a key-sorting transport", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => array.fill(7),
      subtle: {
        importKey: async () => "key",
        deriveBits: async () => new Uint8Array(32).fill(1),
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("one desktop pushes once and then stays silent", async () => {
    const host = fakeHost();
    const a = await makeDesktop("machine-a");
    a.recents.rememberProject("/home/a/code/app");
    a.recents.rememberProject("/home/a/code/site");
    a.recents.saveProjectRailOrder(["/home/a/code/site", "/home/a/code/app"]);
    a.recents.savePinnedProjects(["/home/a/code/app"]);
    a.groups.saveProjectGroups([
      { id: "g1", name: "Work", collapsed: true, colorIndex: 2, lockable: true },
      { id: "g2", name: "Home", collapsed: false },
    ]);
    a.groups.saveProjectGroupAssignments({ [pathKey("/home/a/code/app")]: "g1" });
    await a.lock.setLockPassword("correct horse battery staple");

    await a.cycle(host);
    const revAfterFirst = host.rev();
    const opsAfterFirst = host.pushedOps.length;
    expect(host.tables()).toEqual(
      new Set([
        "project",
        "projectPath",
        "group",
        "assignment",
        "railLayout",
        "groupOrder",
        "lock",
      ]),
    );

    await a.cycle(host);
    await a.cycle(host);
    await a.cycle(host);
    expect(host.pushedOps.length).toBe(opsAfterFirst);
    expect(host.rev()).toBe(revAfterFirst);
  });

  it("two desktops converge and then stop writing (no ping-pong)", async () => {
    const host = fakeHost();
    const a = await makeDesktop("machine-a");
    a.recents.rememberProject("/home/a/code/app");
    a.recents.rememberProject("/home/a/code/site");
    a.recents.saveProjectRailOrder(["/home/a/code/site", "/home/a/code/app"]);
    a.recents.savePinnedProjects(["/home/a/code/app"]);
    a.groups.saveProjectGroups([{ id: "g1", name: "Work", collapsed: true, colorIndex: 2 }]);
    a.groups.saveProjectGroupAssignments({ [pathKey("/home/a/code/app")]: "g1" });
    await a.lock.setLockPassword("correct horse battery staple");

    const b = await makeDesktop("machine-b");
    b.recents.rememberProject("C:/work/app");
    b.recents.rememberProject("C:/work/tool");
    b.recents.saveProjectRailOrder(["C:/work/tool", "C:/work/app"]);
    b.groups.saveProjectGroups([{ id: "g2", name: "Home", collapsed: false, mascot: undefined }]);
    b.groups.saveProjectGroupAssignments({ [pathKey("C:/work/tool")]: "g2" });

    for (let round = 0; round < 3; round += 1) {
      await a.cycle(host);
      await b.cycle(host);
    }
    const settledRev = host.rev();
    const settledOps = host.pushedOps.length;
    const layout = host.value("railLayout", "rail");
    const order = host.value("groupOrder", "groups");

    for (let round = 0; round < 3; round += 1) {
      await a.cycle(host);
      await b.cycle(host);
    }
    expect(host.pushedOps.slice(settledOps)).toEqual([]);
    expect(host.rev()).toBe(settledRev);
    expect(host.value("railLayout", "rail")).toEqual(layout);
    expect(host.value("groupOrder", "groups")).toEqual(order);

    // Both libraries hold the union, and neither machine's data was dropped.
    a.use();
    expect(
      a.groups
        .loadProjectGroups()
        .map((group) => group.id)
        .sort(),
    ).toEqual(["g1", "g2"]);
    expect(a.groups.loadProjectGroups().find((group) => group.id === "g1")?.collapsed).toBe(true);
    expect(a.lock.getGroupLockView().hasPassword).toBe(true);
    b.use();
    expect(
      b.groups
        .loadProjectGroups()
        .map((group) => group.id)
        .sort(),
    ).toEqual(["g1", "g2"]);
    expect(b.groups.loadProjectGroups().find((group) => group.id === "g1")?.collapsed).toBe(false);
    expect(b.lock.getGroupLockView().hasPassword).toBe(true);
    expect(a.assignmentFor("/home/a/code/app")).toBe("g1");
    // Same folder name, another machine: another project.
    expect(b.assignmentFor("C:/work/app")).toBeUndefined();
    expect(b.assignmentFor("C:/work/tool")).toBe("g2");
    expect(host.value("group", "g1")).not.toHaveProperty("collapsed");
    expect((host.value("railLayout", "rail") as { order: string[] }).order.sort()).toEqual([
      "loc:machine:machine-a:/home/a/code/app",
      "loc:machine:machine-a:/home/a/code/site",
      "loc:machine:machine-b:c:/work/app",
      "loc:machine:machine-b:c:/work/tool",
    ]);
    expect(host.ids("projectPath")).toHaveLength(4);
    expect((host.value("groupOrder", "groups") as { order: string[] }).order.sort()).toEqual([
      "g1",
      "g2",
    ]);
  });

  it("a machine without an assignment syncing first does not delete the other machine's membership", async () => {
    const host = fakeHost();
    const id = "loc:env-a:/home/a/code/app";
    const remote = "remote://env-a/home/a/code/app";
    const a = await makeDesktop("machine-a");
    a.projects.setLocalHostEnvironmentId("env-a");
    a.recents.rememberProject("/home/a/code/app");
    a.groups.saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    a.groups.saveProjectGroupAssignments({ [pathKey("/home/a/code/app")]: "g1" });
    const b = await makeDesktop("machine-b");
    b.recents.rememberProject(remote);

    await b.cycle(host);
    expect(host.pushedOps.some((op) => op.table === "assignment")).toBe(false);
    for (let round = 0; round < 3; round += 1) {
      await a.cycle(host);
      await b.cycle(host);
    }
    expect(host.value("assignment", id)).toEqual({ groupId: "g1", projectId: id });
    expect(a.assignmentFor("/home/a/code/app")).toBe("g1");
    expect(b.assignmentFor(remote)).toBe("g1");
    expect(host.ids("projectPath")).toEqual([id]);
  });

  it("an empty desktop joining later keeps the host's layout and group order", async () => {
    const host = fakeHost();
    const a = await makeDesktop("machine-a");
    a.recents.rememberProject("/home/a/code/app");
    a.recents.saveProjectRailOrder(["/home/a/code/app"]);
    a.recents.savePinnedProjects(["/home/a/code/app"]);
    a.groups.saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    await a.cycle(host);
    await a.cycle(host);
    const layout = host.value("railLayout", "rail");
    const order = host.value("groupOrder", "groups");
    const id = "loc:machine:machine-a:/home/a/code/app";
    expect(layout).toEqual({ order: [id], pinned: [id] });

    const b = await makeDesktop("machine-b");
    await b.cycle(host);
    await b.cycle(host);
    expect(host.value("railLayout", "rail")).toEqual(layout);
    expect(host.value("groupOrder", "groups")).toEqual(order);
  });

  it("a project on a connected machine arrives as a remote project in its group and rail slot", async () => {
    const host = fakeHost();
    const a = await makeDesktop("machine-a");
    a.projects.setLocalHostEnvironmentId("env-a");
    a.recents.rememberProject("/home/a/code/app");
    a.recents.rememberProject("/home/a/code/site");
    a.recents.saveProjectRailOrder(["/home/a/code/site", "/home/a/code/app"]);
    a.recents.savePinnedProjects(["/home/a/code/app"]);
    a.groups.saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    a.groups.saveProjectGroupAssignments({ [pathKey("/home/a/code/app")]: "g1" });

    const b = await makeDesktop("machine-b");
    b.recents.rememberProject("C:/work/tool");
    b.recents.saveProjectRailOrder(["C:/work/tool"]);
    const opened: string[] = [];
    b.remoteProjects.setRemoteOpenTargets([
      {
        environmentId: "env-a",
        name: "Windows PC",
        request: async (method, params) => {
          const { cwd } = params as { cwd: string };
          opened.push(`${method} ${cwd}`);
          return { id: `host-${cwd}`, cwd, name: cwd.split("/").pop() };
        },
      },
    ]);

    for (let round = 0; round < 3; round += 1) {
      await a.cycle(host);
      await b.cycle(host);
    }
    const settledRev = host.rev();
    const settledOps = host.pushedOps.length;
    for (let round = 0; round < 3; round += 1) {
      await a.cycle(host);
      await b.cycle(host);
    }
    expect(host.pushedOps.slice(settledOps)).toEqual([]);
    expect(host.rev()).toBe(settledRev);

    const app = "remote://env-a/home/a/code/app";
    const site = "remote://env-a/home/a/code/site";
    b.use();
    expect(
      b.recents
        .loadRecents()
        .map((item) => item.path)
        .sort(),
    ).toEqual(["C:/work/tool", app, site]);
    expect(opened.sort()).toEqual([
      "projects.open /home/a/code/app",
      "projects.open /home/a/code/site",
    ]);
    expect(b.assignmentFor(app)).toBe("g1");
    expect(b.assignmentFor(site)).toBeUndefined();
    expect(b.recents.loadPinnedProjects()).toEqual([app]);
    const order = b.recents.loadProjectRailOrder();
    expect(order.indexOf(site)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(site)).toBeLessThan(order.indexOf(app));
    expect(b.projects.remoteOnlyProjects()).toEqual([]);

    // The folder is only on A: one record describes it, and A's data is intact.
    const APP = "loc:env-a:/home/a/code/app";
    const SITE = "loc:env-a:/home/a/code/site";
    const TOOL = "loc:machine:machine-b:c:/work/tool";
    expect(host.value("projectPath", APP)).toEqual({
      archived: false,
      hostEnvironmentId: "env-a",
      path: "/home/a/code/app",
      projectId: APP,
    });
    expect(host.ids("projectPath")).toEqual([APP, SITE, TOOL].sort());
    expect(host.value("assignment", APP)).toEqual({ groupId: "g1", projectId: APP });
    expect(host.value("railLayout", "rail")).toEqual({ order: [SITE, APP, TOOL], pinned: [APP] });
    expect(a.assignmentFor("/home/a/code/app")).toBe("g1");

    // An edit made on B's remote project reaches the machine where it is local.
    b.use();
    b.groups.saveProjectGroups([
      ...b.groups.loadProjectGroups(),
      { id: "g2", name: "Side", collapsed: false },
    ]);
    b.groups.setProjectGroupAssignment(app, "g2");
    for (let round = 0; round < 2; round += 1) {
      await b.cycle(host);
      await a.cycle(host);
    }
    expect(a.assignmentFor("/home/a/code/app")).toBe("g2");

    // Removing it on B is remembered: it is not added again, and A keeps its group.
    b.use();
    b.recents.forgetProject(app);
    const revBeforeRemoval = host.rev();
    for (let round = 0; round < 3; round += 1) {
      await b.cycle(host);
      await a.cycle(host);
    }
    b.use();
    expect(b.recents.loadRecents().map((item) => item.path)).not.toContain(app);
    expect(b.projects.remoteOnlyProjects()).toEqual([]);
    expect(opened).toHaveLength(2);
    expect(a.assignmentFor("/home/a/code/app")).toBe("g2");
    expect(host.value("assignment", APP)).toEqual({ groupId: "g2", projectId: APP });
    const revAfterRemoval = host.rev();
    await b.cycle(host);
    await a.cycle(host);
    expect(host.rev()).toBe(revAfterRemoval);
    expect(revAfterRemoval - revBeforeRemoval).toBeLessThanOrEqual(1);
  });

  it("a folder one desktop opened remotely becomes a local project on the machine that holds it", async () => {
    const host = fakeHost();
    const remote = "remote://env-m/Users/me/projects/shop";
    const local = "/Users/me/projects/shop";
    const opened: string[] = [];
    const target = (environmentId: string) => ({
      environmentId,
      name: environmentId,
      request: async (method: string, params: unknown) => {
        const { cwd } = params as { cwd: string };
        opened.push(`${environmentId} ${method} ${cwd}`);
        return { id: `host-${cwd}`, cwd, name: "shop" };
      },
    });

    const w = await makeDesktop("machine-w");
    w.projects.setLocalHostEnvironmentId("env-w");
    w.remoteProjects.setRemoteOpenTargets([target("env-m")]);
    w.recents.rememberProject(remote);
    w.recents.rememberProject("C:/work/tool");
    w.recents.saveProjectRailOrder([remote, "C:/work/tool"]);
    w.groups.saveProjectGroups([{ id: "g", name: "Clients", collapsed: false }]);
    w.groups.saveProjectGroupAssignments({ [pathKey(remote)]: "g" });

    const m = await makeDesktop("machine-m");
    m.projects.setLocalHostEnvironmentId("env-m");
    m.remoteProjects.setRemoteOpenTargets([target("env-w")]);

    for (let round = 0; round < 4; round += 1) {
      await w.cycle(host);
      await m.cycle(host);
    }
    const settledRev = host.rev();
    const settledOps = host.pushedOps.length;
    for (let round = 0; round < 3; round += 1) {
      await w.cycle(host);
      await m.cycle(host);
    }
    expect(host.pushedOps.slice(settledOps)).toEqual([]);
    expect(host.rev()).toBe(settledRev);

    // W announced the folder; M, which holds it, describes it with the same record.
    const SHOP = "loc:env-m:/Users/me/projects/shop";
    expect(host.value("projectPath", SHOP)).toEqual({
      archived: false,
      hostEnvironmentId: "env-m",
      path: local,
      projectId: SHOP,
    });
    expect(host.ids("projectPath")).toEqual([SHOP, "loc:env-w:c:/work/tool"]);

    // M holds the folder, so it gets a local project in W's group; W's tool is opened remotely.
    m.use();
    expect(
      m.recents
        .loadRecents()
        .map((item) => item.path)
        .sort(),
    ).toEqual([local, "remote://env-w/C:/work/tool"]);
    expect(m.assignmentFor(local)).toBe("g");
    expect(m.projects.remoteOnlyProjects()).toEqual([]);
    const order = m.recents.loadProjectRailOrder();
    expect(order.indexOf(local)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(local)).toBeLessThan(order.indexOf("remote://env-w/C:/work/tool"));
    expect(opened).toEqual(["env-w projects.open C:/work/tool"]);

    w.use();
    expect(
      w.recents
        .loadRecents()
        .map((item) => item.path)
        .sort(),
    ).toEqual(["C:/work/tool", remote]);
    expect(w.projects.remoteOnlyProjects()).toEqual([]);
    expect(w.assignmentFor(remote)).toBe("g");

    // Removing it on M is remembered: it is not adopted again, and W keeps its project.
    m.use();
    m.recents.forgetProject(local);
    for (let round = 0; round < 3; round += 1) {
      await m.cycle(host);
      await w.cycle(host);
    }
    m.use();
    expect(m.recents.loadRecents().map((item) => item.path)).toEqual([
      "remote://env-w/C:/work/tool",
    ]);
    expect(m.projects.remoteOnlyProjects()).toEqual([]);
    expect(m.projects.locallyAdoptableProjects()).toEqual([]);
    w.use();
    expect(
      w.recents
        .loadRecents()
        .map((item) => item.path)
        .sort(),
    ).toEqual(["C:/work/tool", remote]);
    expect(w.assignmentFor(remote)).toBe("g");
    expect(opened).toHaveLength(1);
    const revAfterRemoval = host.rev();
    await m.cycle(host);
    await w.cycle(host);
    expect(host.rev()).toBe(revAfterRemoval);
  });

  it("a project renamed on one desktop shows that name on the other, both ways", async () => {
    const host = fakeHost();
    const local = "C:/work/web-portal";
    const remote = "remote://env-w/C:/work/web-portal";
    const id = "loc:env-w:c:/work/web-portal";

    const w = await makeDesktop("machine-w");
    w.projects.setLocalHostEnvironmentId("env-w");
    w.recents.rememberProject(local);
    w.appearance.saveTabGroupLabel(pathKey(local), "ai ui-portal");
    w.appearance.saveTabGroupColor(pathKey(local), 4);
    w.appearance.saveTabGroupMascot(pathKey(local), "cat");
    w.appearance.saveTabGroupLogo(pathKey(local), "C:/logos/portal.png");

    const m = await makeDesktop("machine-m");
    m.remoteProjects.setRemoteOpenTargets([
      {
        environmentId: "env-w",
        name: "Windows PC",
        request: async (_method, params) => {
          const { cwd } = params as { cwd: string };
          return { id: `host-${cwd}`, cwd, name: cwd.split("/").pop() };
        },
      },
    ]);

    // M syncs first with nothing to show: it must not wipe what W is about to push.
    await m.cycle(host);
    expect(host.pushedOps.some((op) => op.table === "appearance")).toBe(false);
    for (let round = 0; round < 3; round += 1) {
      await w.cycle(host);
      await m.cycle(host);
    }
    m.use();
    expect(m.recents.loadRecents().map((item) => item.path)).toEqual([remote]);
    expect(m.look(remote)).toEqual({ label: "ai ui-portal", colorIndex: 4, mascot: "cat" });
    expect(m.appearance.loadTabGroupLogos()).toEqual({});
    expect(host.value("appearance", id)).toEqual({
      colorIndex: 4,
      label: "ai ui-portal",
      mascot: "cat",
      projectId: id,
    });

    const settledRev = host.rev();
    const settledOps = host.pushedOps.length;
    for (let round = 0; round < 3; round += 1) {
      await w.cycle(host);
      await m.cycle(host);
    }
    expect(host.pushedOps.slice(settledOps)).toEqual([]);
    expect(host.rev()).toBe(settledRev);

    m.use();
    m.appearance.saveTabGroupLabel(pathKey(remote), "portal");
    m.appearance.saveTabGroupCustomColor(pathKey(remote), "#AABBCC");
    await m.cycle(host);
    await w.cycle(host);
    expect(w.look(local)).toEqual({ label: "portal", colorIndex: null, mascot: "cat" });
    w.use();
    expect(w.appearance.loadTabGroupCustomColors()[pathKey(local)]).toBe("#aabbcc");
    expect(w.appearance.loadTabGroupLogos()[pathKey(local)]).toBe("C:/logos/portal.png");

    w.use();
    w.appearance.saveTabGroupLabel(pathKey(local), "");
    await w.cycle(host);
    await m.cycle(host);
    expect(m.look(remote).label).toBe("folder name");
    m.use();
    expect(m.appearance.loadTabGroupCustomColors()[pathKey(remote)]).toBe("#aabbcc");

    // Resetting everything is a tombstone, and it clears the other side too.
    w.use();
    w.appearance.saveTabGroupColor(pathKey(local), null);
    w.appearance.saveTabGroupMascot(pathKey(local), null);
    await w.cycle(host);
    await m.cycle(host);
    expect(host.value("appearance", id)).toBeNull();
    expect(m.look(remote)).toEqual({ label: "folder name", colorIndex: null, mascot: null });
    m.use();
    expect(m.appearance.loadTabGroupCustomColors()).toEqual({});

    const finalRev = host.rev();
    for (let round = 0; round < 2; round += 1) {
      await w.cycle(host);
      await m.cycle(host);
    }
    expect(host.rev()).toBe(finalRev);
  });

  it("a host that does not know the appearance table leaves the rename pending", async () => {
    const host = fakeHost(["appearance"]);
    const a = await makeDesktop("machine-a");
    a.recents.rememberProject("/home/a/code/app");
    a.appearance.saveTabGroupLabel(pathKey("/home/a/code/app"), "My app");
    const id = "loc:machine:machine-a:/home/a/code/app";

    await a.cycle(host);
    await a.cycle(host);
    a.use();
    expect(a.client.getSyncStatus(HOST)).toMatchObject({ state: "ok", pendingOps: 1 });
    expect(a.peerState.takeOutbox(HOST)).toEqual([
      { table: "appearance", id, baseRev: 0, value: { projectId: id, label: "My app" } },
    ]);
    expect(a.peerState.knownRecordValue(HOST, "appearance", id)).toBeUndefined();
    // One attempt per cycle, and the rest of the library still syncs.
    expect(host.pushedOps.filter((op) => op.table === "appearance")).toHaveLength(2);
    expect(host.tables().has("project")).toBe(true);
    expect(a.look("/home/a/code/app").label).toBe("My app");
  });

  /** A machine saved on a desktop, whose host opens any folder asked for. */
  const openTarget = (environmentId: string) => ({
    environmentId,
    name: environmentId,
    request: async (_method: string, params: unknown) => {
      const { cwd } = params as { cwd: string };
      return { id: `host-${cwd}`, cwd, name: cwd.split("/").pop() };
    },
  });

  const settles = async (
    host: ReturnType<typeof fakeHost>,
    desktops: { cycle: (h: typeof host) => Promise<void> }[],
  ) => {
    for (let round = 0; round < 4; round += 1)
      for (const desktop of desktops) await desktop.cycle(host);
    const rev = host.rev();
    const ops = host.pushedOps.length;
    for (let round = 0; round < 3; round += 1)
      for (const desktop of desktops) await desktop.cycle(host);
    expect(host.pushedOps.slice(ops)).toEqual([]);
    expect(host.rev()).toBe(rev);
  };

  it("same-named folders on two machines are two projects, each with its own group and name", async () => {
    const host = fakeHost();
    const onW = "G:/Projects/x/bycoda";
    const onM = "/Users/me/projects/bycoda";
    const wOnM = "remote://E_W/G:/Projects/x/bycoda";
    const mOnW = "remote://E_M/Users/me/projects/bycoda";

    const w = await makeDesktop("machine-w");
    w.projects.setLocalHostEnvironmentId("E_W");
    w.remoteProjects.setRemoteOpenTargets([openTarget("E_M")]);
    w.recents.rememberProject(onW);
    w.groups.saveProjectGroups([{ id: "g-win", name: "Windows work", collapsed: false }]);
    w.groups.saveProjectGroupAssignments({ [pathKey(onW)]: "g-win" });
    w.appearance.saveTabGroupLabel(pathKey(onW), "mono (pc)");

    const m = await makeDesktop("machine-m");
    m.projects.setLocalHostEnvironmentId("E_M");
    m.remoteProjects.setRemoteOpenTargets([openTarget("E_W")]);
    m.recents.rememberProject(onM);
    m.groups.saveProjectGroups([{ id: "g-mac", name: "Mac work", collapsed: false }]);
    m.groups.saveProjectGroupAssignments({ [pathKey(onM)]: "g-mac" });
    m.appearance.saveTabGroupLabel(pathKey(onM), "mono (mac)");

    await settles(host, [w, m]);

    expect(host.ids("projectPath")).toEqual([
      "loc:E_M:/Users/me/projects/bycoda",
      "loc:E_W:g:/projects/x/bycoda",
    ]);
    m.use();
    expect(
      m.recents
        .loadRecents()
        .map((item) => item.path)
        .sort(),
    ).toEqual([onM, wOnM].sort());
    expect(m.assignmentFor(onM)).toBe("g-mac");
    expect(m.assignmentFor(wOnM)).toBe("g-win");
    expect(m.look(onM).label).toBe("mono (mac)");
    expect(m.look(wOnM).label).toBe("mono (pc)");
    expect(m.projects.remoteOnlyProjects()).toEqual([]);
    w.use();
    expect(
      w.recents
        .loadRecents()
        .map((item) => item.path)
        .sort(),
    ).toEqual([onW, mOnW].sort());
    expect(w.assignmentFor(onW)).toBe("g-win");
    expect(w.assignmentFor(mOnW)).toBe("g-mac");
    expect(w.look(onW).label).toBe("mono (pc)");
    expect(w.look(mOnW).label).toBe("mono (mac)");
  });

  it("a Windows folder and its remote:// entry on another desktop are one project, whoever syncs first", async () => {
    for (const windowsFirst of [true, false]) {
      const host = fakeHost();
      const onW = "G:\\Projects\\Acme\\WEB APPS\\web-portal";
      const onM = "remote://E_W/G:/Projects/Acme/WEB APPS/web-portal";
      const id = "loc:E_W:g:/projects/acme/web apps/web-portal";

      const w = await makeDesktop("machine-w");
      w.projects.setLocalHostEnvironmentId("E_W");
      w.recents.rememberProject(onW);
      w.groups.saveProjectGroups([{ id: "g-ui", name: "UI", collapsed: false }]);
      w.groups.saveProjectGroupAssignments({ [pathKey(onW)]: "g-ui" });
      w.appearance.saveTabGroupLabel(pathKey(onW), "ai ui-portal");

      const m = await makeDesktop("machine-m");
      m.projects.setLocalHostEnvironmentId("E_M");
      m.remoteProjects.setRemoteOpenTargets([openTarget("E_W")]);
      m.recents.rememberProject(onM);

      await settles(host, windowsFirst ? [w, m] : [m, w]);

      expect(host.ids("projectPath")).toEqual([id]);
      expect(host.value("projectPath", id)).toEqual({
        archived: false,
        hostEnvironmentId: "E_W",
        path: "G:/Projects/Acme/WEB APPS/web-portal",
        projectId: id,
      });
      expect(host.value("assignment", id)).toEqual({ groupId: "g-ui", projectId: id });
      expect(host.value("appearance", id)).toEqual({ label: "ai ui-portal", projectId: id });
      m.use();
      expect(m.recents.loadRecents().map((item) => item.path)).toEqual([onM]);
      expect(m.assignmentFor(onM)).toBe("g-ui");
      expect(m.look(onM).label).toBe("ai ui-portal");
      expect(m.projects.remoteOnlyProjects()).toEqual([]);
      w.use();
      expect(w.recents.loadRecents().map((item) => item.path)).toEqual([
        "G:/Projects/Acme/WEB APPS/web-portal",
      ]);
      expect(w.assignmentFor(onW)).toBe("g-ui");
      expect(w.look(onW).label).toBe("ai ui-portal");
      expect(w.projects.locallyAdoptableProjects()).toEqual([]);
    }
  });

  it("a desktop and a host left by the name-based build move to location ids without losing the local library", async () => {
    const host = fakeHost();
    const app = "C:/work/app";
    const site = "C:/work/site";
    host.seed("project", "name:app", { id: "name:app", createdAt: 0 });
    host.seed("projectPath", "name:app:machine-w", {
      projectId: "name:app",
      machineId: "machine-w",
      path: app,
      archived: false,
      hostEnvironmentId: "env-w",
    });
    host.seed("projectPath", "name:far:m2", {
      projectId: "name:far",
      machineId: "m2",
      path: "/srv/far",
      archived: false,
      hostEnvironmentId: "env-far",
    });
    const groupRev = host.seed("group", "g1", { id: "g1", name: "Work" });
    const assignmentRev = host.seed("assignment", "name:app", {
      projectId: "name:app",
      groupId: "g1",
    });
    host.seed("appearance", "name:app", { projectId: "name:app", label: "Old label" });
    host.seed("railLayout", "rail", {
      order: ["name:far", "name:app", "name:site"],
      pinned: ["name:far"],
    });
    host.seed("groupOrder", "groups", { order: ["g1"] });
    const seeded = host.rev();

    const w = await makeDesktop("machine-w");
    w.projects.setLocalHostEnvironmentId("env-w");
    w.remoteProjects.setRemoteOpenTargets([openTarget("env-far")]);
    w.recents.rememberProject(app);
    w.recents.rememberProject(site);
    w.recents.saveProjectRailOrder([site, app]);
    w.recents.savePinnedProjects([app]);
    w.groups.saveProjectGroups([{ id: "g1", name: "Work", collapsed: true }]);
    w.groups.saveProjectGroupAssignments({ [pathKey(app)]: "g1" });
    w.appearance.saveTabGroupLabel(pathKey(app), "My app");
    // What the older build left behind, including ops that would now do harm.
    w.storage.setItem(
      "bycoda.sync.localProjectIds.v2",
      JSON.stringify({ [pathKey(app)]: "name:app", [pathKey(site)]: "name:site" }),
    );
    w.storage.setItem(
      "bycoda.sync.peer:host-1",
      JSON.stringify({
        rev: seeded,
        pulled: true,
        recordRevs: { "group:g1": groupRev, "assignment:name:app": assignmentRev },
        recordValues: {
          "group:g1": '{"id":"g1","name":"Work"}',
          "assignment:name:app": '{"groupId":"g1","projectId":"name:app"}',
        },
        outbox: [
          { table: "group", id: "g1", baseRev: groupRev, value: null },
          { table: "assignment", id: "name:app", baseRev: assignmentRev, value: null },
        ],
      }),
    );
    w.storage.setItem("bycoda.sync.seenGroups:host-1", JSON.stringify(["g1"]));
    w.storage.setItem(
      "bycoda.sync.seenAssignments:host-1",
      JSON.stringify(["name:app", "name:site"]),
    );
    w.storage.setItem("bycoda.sync.railOwned:host-1", JSON.stringify(["name:app", "name:site"]));
    w.storage.setItem("bycoda.sync.manualLinks", JSON.stringify({ [pathKey(site)]: "name:far" }));
    w.storage.setItem(
      "bycoda.sync.remoteProjectPaths",
      JSON.stringify({
        "name:far": { m2: { path: "/srv/far", archived: false, hostEnvironmentId: "env-far" } },
      }),
    );
    w.storage.setItem(
      "bycoda.sync.autoAddedRemoteProjects",
      JSON.stringify({ "name:far": "remote://env-far/srv/far" }),
    );

    await settles(host, [w]);

    const APP = "loc:env-w:c:/work/app";
    const SITE = "loc:env-w:c:/work/site";
    expect(
      host.pushedOps.filter((op) => !op.id.startsWith("loc:")).map((op) => `${op.table}:${op.id}`),
    ).toEqual(["railLayout:rail"]);
    expect(host.value("projectPath", APP)).toEqual({
      archived: false,
      hostEnvironmentId: "env-w",
      path: app,
      projectId: APP,
    });
    expect(host.ids("projectPath")).toEqual([APP, SITE, "name:app:machine-w", "name:far:m2"]);
    expect(host.value("assignment", APP)).toEqual({ groupId: "g1", projectId: APP });
    expect(host.value("appearance", APP)).toEqual({ label: "My app", projectId: APP });
    expect(host.value("railLayout", "rail")).toEqual({ order: [SITE, APP], pinned: [APP] });
    // The older records are left alone, and nothing here resolves them.
    expect(host.value("group", "g1")).toEqual({ id: "g1", name: "Work" });
    expect(host.value("assignment", "name:app")).toEqual({ groupId: "g1", projectId: "name:app" });
    expect(host.value("appearance", "name:app")).toEqual({
      label: "Old label",
      projectId: "name:app",
    });

    w.use();
    expect(
      w.recents
        .loadRecents()
        .map((item) => item.path)
        .sort(),
    ).toEqual([app, site]);
    expect(w.recents.loadProjectRailOrder()).toEqual([site, app]);
    expect(w.recents.loadPinnedProjects()).toEqual([app]);
    expect(w.groups.loadProjectGroups()).toEqual([{ id: "g1", name: "Work", collapsed: true }]);
    expect(w.groups.loadProjectGroupAssignments()).toEqual({ [pathKey(app)]: "g1" });
    expect(w.look(app).label).toBe("My app");
    expect(w.look(site).label).toBe("folder name");
    expect(w.projects.remoteOnlyProjects()).toEqual([]);
    expect(w.projects.projectIdForPath(site)).toBe(SITE);
  });

  it("a desktop that gets a host later re-identifies its folders once and deletes its earlier records", async () => {
    const host = fakeHost();
    const a = await makeDesktop("machine-a");
    a.recents.rememberProject("/home/a/code/app");
    a.recents.saveProjectRailOrder(["/home/a/code/app"]);
    a.groups.saveProjectGroups([{ id: "g1", name: "Work", collapsed: false }]);
    a.groups.saveProjectGroupAssignments({ [pathKey("/home/a/code/app")]: "g1" });
    await settles(host, [a]);
    const before = "loc:machine:machine-a:/home/a/code/app";
    expect(host.value("railLayout", "rail")).toEqual({ order: [before], pinned: [] });

    a.use();
    a.projects.setLocalHostEnvironmentId("env-a");
    await settles(host, [a]);
    const after = "loc:env-a:/home/a/code/app";
    expect(host.value("projectPath", before)).toBeNull();
    expect(host.value("projectPath", after)).toMatchObject({ hostEnvironmentId: "env-a" });
    expect(host.value("assignment", after)).toEqual({ groupId: "g1", projectId: after });
    expect(host.value("railLayout", "rail")).toEqual({ order: [after], pinned: [] });
    a.use();
    expect(a.recents.loadRecents().map((item) => item.path)).toEqual(["/home/a/code/app"]);
    expect(a.assignmentFor("/home/a/code/app")).toBe("g1");
  });
});
