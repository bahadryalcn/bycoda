import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { createSessionListRuntime } from "./session-list";

const branch = vi.hoisted(() => ({ name: "main" }));
vi.mock("../git/git-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../git/git-actions")>()),
  branchCache: { get: async () => branch.name },
}));

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** A decorated row is reused only while its project and branch inputs are unchanged. */
it("rebuilds a decorated session row when its branch or project name changes, and reuses it otherwise", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-session-decoration-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  let project = await store.addProject("/decoration", "Decor");
  let runtime!: Awaited<ReturnType<typeof createSessionListRuntime>>;
  await createSessionListRuntime(
    {
      engine: { store },
      desktop: {
        listSnapshotAsync: async () => ({ sessions: [], fingerprint: "fixed" }),
        samePath: (a: string, b: string) => a === b,
        pathKey: (path: string) => path,
      },
      desktopWatch: async () => false,
      catchUp: async () => undefined,
      tasks: { changeEtag: async () => "tasks" },
      providers: [],
      pullRequestWatch: { wakeSources: () => new Map() },
    } as never,
    (value) => {
      runtime = value;
    },
  );
  const session = { id: "s1", status: "idle", updatedAt: 1, title: "S" } as never;
  const build = () => runtime.buildProjectSessionList(project, [session], "t", new Map());

  const first = await build();
  expect(first.list[0].branch).toBe("main");
  // Same inputs: the row object is reused, not decorated again.
  expect((await build()).list[0]).toBe(first.list[0]);

  branch.name = "feature";
  const branched = await build();
  expect(branched.list[0]).not.toBe(first.list[0]);
  expect(branched.list[0].branch).toBe("feature");

  project = { ...project, name: "Renamed" };
  const renamed = await build();
  expect(renamed.list[0]).not.toBe(branched.list[0]);
  expect(renamed.list[0].repo).toBe("Renamed");
});

/** The registered folders are read once per registry change, not once per list build. */
it("re-reads the registered folders only after a project is added", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-session-registry-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const project = await store.addProject("/registry", "Registry");
  let runtime!: Awaited<ReturnType<typeof createSessionListRuntime>>;
  await createSessionListRuntime(
    {
      engine: { store },
      desktop: {
        listSnapshotAsync: async () => ({ sessions: [], fingerprint: "fixed" }),
        samePath: (a: string, b: string) => a === b,
        pathKey: (path: string) => path,
      },
      desktopWatch: async () => false,
      catchUp: async () => undefined,
      tasks: { changeEtag: async () => "tasks" },
      providers: [],
      pullRequestWatch: { wakeSources: () => new Map() },
    } as never,
    (value) => {
      runtime = value;
    },
  );
  const registry = vi.spyOn(store, "projects");
  const build = () => runtime.buildProjectSessionList(project, [], "t", new Map());

  await build();
  await build();
  expect(registry).toHaveBeenCalledTimes(1);

  await store.addProject("/registry-other", "Other");
  registry.mockClear();
  await build();
  await build();
  expect(registry).toHaveBeenCalledTimes(1);
});

/** Legacy spellings of one folder list together; paths are keyed once, not per comparison. */
it("lists a folder's legacy duplicate ids without re-normalizing every registered path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-session-siblings-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const project = await store.addProject("/Same", "Same");
  // A legacy spelling of the same folder (the real normalizer resolves case and junctions).
  const legacy = await store.addProject("/legacy-spelling", "Legacy");
  await store.addProject("/other", "Other");
  const pathKey = vi.fn((path: string) =>
    path === "/legacy-spelling" ? "/same" : path.toLowerCase(),
  );
  let runtime!: Awaited<ReturnType<typeof createSessionListRuntime>>;
  await createSessionListRuntime(
    {
      engine: { store },
      desktop: {
        listSnapshotAsync: async () => ({ sessions: [], fingerprint: "fixed" }),
        samePath: (a: string, b: string) => pathKey(a) === pathKey(b),
        pathKey,
      },
      desktopWatch: async () => false,
      catchUp: async () => undefined,
      tasks: { changeEtag: async () => "tasks" },
      providers: [],
      pullRequestWatch: { wakeSources: () => new Map() },
    } as never,
    (value) => {
      runtime = value;
    },
  );
  const summaries = vi.spyOn(store, "summaries");
  await runtime.buildProjectSessionList(project, [], "t", new Map());
  expect(summaries.mock.calls.map(([id]) => id).sort()).toEqual([legacy.id, project.id].sort());
  pathKey.mockClear();
  for (let round = 0; round < 5; round++)
    await runtime.buildProjectSessionList(project, [], "t", new Map());
  // One key per build for the asking project; the registered rows stay keyed.
  expect(pathKey.mock.calls.filter(([path]) => path === "/other")).toHaveLength(0);
});
