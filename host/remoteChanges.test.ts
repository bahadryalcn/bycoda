import { expect, it, vi } from "vitest";
import type { HostSessionSummary } from "../src/features/connections/model/protocol";
import { RemoteChanges } from "./remoteChanges";

it("reads unchanged metadata only once for a non-waiting request", async () => {
  const changes = new RemoteChanges();
  const project = vi.fn(async () => ({ etag: "p1", sessions: [] }));
  const tasks = vi.fn(async () => "t1");
  const git = vi.fn(async () => ({ etag: "1.1", watching: true }));
  await changes.read(
    {
      instanceId: changes.instanceId,
      sessions: [],
      projects: [{ projectId: "p", known: "p1" }],
      tasksKnown: "t1",
      git: [{ cwd: "/repo", known: "1.1" }],
      waitMs: 0,
    },
    () => undefined,
    project,
    undefined,
    tasks,
    git,
  );
  expect(project).toHaveBeenCalledTimes(1);
  expect(tasks).toHaveBeenCalledTimes(1);
  expect(git).toHaveBeenCalledTimes(1);
});

it("does not repeat metadata IO after a long poll reaches its deadline", async () => {
  vi.useFakeTimers();
  try {
    const changes = new RemoteChanges();
    const project = vi.fn(async () => ({ etag: "p1", sessions: [] }));
    const pending = changes.read(
      {
        instanceId: changes.instanceId,
        sessions: [],
        projects: [{ projectId: "p", known: "p1" }],
        waitMs: 100,
      },
      () => undefined,
      project,
    );
    await vi.advanceTimersByTimeAsync(100);
    expect((await pending).projects).toEqual([]);
    // Initial read and one deadline check; no third, identical read.
    expect(project).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("overlaps project IO with a bounded pool and preserves response order", async () => {
  const changes = new RemoteChanges();
  let active = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const project = vi.fn(async (id: string) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active--;
    return { etag: id, sessions: [] };
  });
  const ids = ["p0", "p1", "p2", "p3", "p4", "p5"];
  const pending = changes.read(
    { sessions: [], projects: ids.map((projectId) => ({ projectId })) },
    () => undefined,
    project,
  );
  expect(project).toHaveBeenCalledTimes(4);
  for (let i = 0; i < ids.length; i++) {
    await vi.waitFor(() => expect(releases[i]).toBeTypeOf("function"));
    releases[i]();
  }
  const result = await pending;
  expect(peak).toBe(4);
  expect(result.projects.map((entry) => entry.projectId)).toEqual(ids);
});

it("shares in-flight project reads across clients and retries failed reads", async () => {
  const changes = new RemoteChanges();
  const input = { sessions: [], projects: [{ projectId: "p" }] };
  let reject!: (error: Error) => void;
  const project = vi.fn(
    () =>
      new Promise<{ etag: string; sessions: HostSessionSummary[] }>((_, fail) => {
        reject = fail;
      }),
  );
  const first = changes.read(input, () => undefined, project);
  const second = changes.read(input, () => undefined, project);
  const results = Promise.allSettled([first, second]);
  expect(project).toHaveBeenCalledTimes(1);
  reject(new Error("read failed"));
  expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  project.mockResolvedValue({ etag: "recovered", sessions: [] });
  expect((await changes.read(input, () => undefined, project)).projects[0].etag).toBe("recovered");
  expect(project).toHaveBeenCalledTimes(2);
});

it("returns reset cursors on a new host instance and only changed cursors later", async () => {
  const changes = new RemoteChanges();
  const sessions = new Map([["s", 4]]);
  const summary = (id: string, title: string) =>
    ({
      id,
      title,
      projectId: "p",
      revision: 1,
      updatedAt: 1,
      status: "idle",
      harness: "codex",
    }) as HostSessionSummary;
  const projects = new Map<string, { etag: string; sessions: HostSessionSummary[] }>([
    ["p", { etag: "a", sessions: [summary("old", "summary")] }],
  ]);
  const read = (id: string) => sessions.get(id);
  const project = async (id: string) => projects.get(id)!;
  const initial = await changes.read(
    {
      sessions: [{ sessionId: "s", revision: 2 }],
      projects: [{ projectId: "p" }],
    },
    read,
    project,
  );
  expect(initial.reset).toBe(true);
  expect(initial.sessions).toEqual([{ sessionId: "s", revision: 4 }]);
  expect(initial.projects[0]?.sessions).toEqual([summary("old", "summary")]);
  const unchanged = await changes.read(
    {
      instanceId: initial.instanceId,
      sessions: [{ sessionId: "s", revision: 4 }],
      projects: [{ projectId: "p", known: "a" }],
    },
    read,
    project,
  );
  expect(unchanged).toMatchObject({ reset: false, sessions: [], projects: [] });
  sessions.set("s", 5);
  projects.set("p", { etag: "b", sessions: [summary("new", "changed")] });
  await new Promise((resolve) => setTimeout(resolve, 210));
  const updated = await changes.read(
    {
      instanceId: initial.instanceId,
      sessions: [{ sessionId: "s", revision: 4 }],
      projects: [{ projectId: "p", known: "a" }],
    },
    read,
    project,
  );
  expect(updated.sessions).toEqual([{ sessionId: "s", revision: 5 }]);
  expect(updated.projects[0]).toMatchObject({
    etag: "b",
    base: "a",
    upserts: [summary("new", "changed")],
    removed: ["old"],
  });
});

it("bounds subscriptions and waits, and releases polling when cancelled", async () => {
  const changes = new RemoteChanges();
  const input = { instanceId: changes.instanceId, sessions: [], projects: [] };
  await expect(
    changes.read(
      {
        ...input,
        sessions: Array.from({ length: 65 }, (_, i) => ({
          sessionId: String(i),
          revision: 0,
        })),
      },
      () => 0,
      async () => ({ etag: "", sessions: [] }),
    ),
  ).rejects.toThrow("64");
  await expect(
    changes.read(
      {
        ...input,
        projects: Array.from({ length: 33 }, (_, i) => ({
          projectId: String(i),
        })),
      },
      () => 0,
      async () => ({ etag: "", sessions: [] }),
    ),
  ).rejects.toThrow("32");
  const cancelled = vi.fn(() => true);
  const result = await changes.read(
    { ...input, waitMs: 10_000 },
    () => undefined,
    async () => ({ etag: "", sessions: [] }),
    cancelled,
  );
  expect(result.reset).toBe(false);
});

it("signals task-list invalidation by metadata etag only", async () => {
  const changes = new RemoteChanges();
  let taskEtag = "one";
  const result = await changes.read(
    {
      instanceId: changes.instanceId,
      sessions: [],
      projects: [],
      tasksKnown: "",
    },
    () => undefined,
    async () => ({ etag: "", sessions: [] }),
    undefined,
    async () => taskEtag,
  );
  expect(result.tasks).toEqual({ etag: "one" });
  const unchanged = await changes.read(
    {
      instanceId: changes.instanceId,
      sessions: [],
      projects: [],
      tasksKnown: "one",
    },
    () => undefined,
    async () => ({ etag: "", sessions: [] }),
    undefined,
    async () => taskEtag,
  );
  expect(unchanged.tasks).toBeUndefined();
  taskEtag = "two";
  const updated = await changes.read(
    {
      instanceId: changes.instanceId,
      sessions: [],
      projects: [],
      tasksKnown: "one",
    },
    () => undefined,
    async () => ({ etag: "", sessions: [] }),
    undefined,
    async () => taskEtag,
  );
  expect(updated.tasks).toEqual({ etag: "two" });
});

it("wakes a task-only long poll when the task etag changes", async () => {
  const changes = new RemoteChanges();
  let taskEtag = "one";
  const waiting = changes.read(
    {
      instanceId: changes.instanceId,
      sessions: [],
      projects: [],
      tasksKnown: "one",
      waitMs: 2_000,
    },
    () => undefined,
    async () => ({ etag: "", sessions: [] }),
    undefined,
    async () => taskEtag,
  );
  setTimeout(() => {
    taskEtag = "two";
  }, 150);
  await expect(waiting).resolves.toMatchObject({
    tasks: { etag: "two" },
    sessions: [],
    projects: [],
  });
});

const noSessions = async () => ({ etag: "", sessions: [] });

it("returns git cursors by comparing counters with the known etag", async () => {
  const changes = new RemoteChanges();
  let git: { etag: string; watching: boolean } = { etag: "2.3", watching: true };
  const readGit = async () => git;
  const read = (known?: string) =>
    changes.read(
      {
        instanceId: changes.instanceId,
        sessions: [],
        projects: [],
        git: [{ cwd: "/r", ...(known === undefined ? {} : { known }) }],
      },
      () => undefined,
      noSessions,
      undefined,
      undefined,
      readGit,
    );
  const entry = (extra: object) => ({
    cwd: "/r",
    etag: "2.3",
    index: false,
    refs: false,
    watching: true,
    ...extra,
  });
  expect((await read()).git).toEqual([entry({})]);
  expect((await read("garbage")).git).toEqual([entry({})]);
  expect((await read("2.3")).git).toBeUndefined();
  expect((await read("1.3")).git).toEqual([entry({ index: true })]);
  expect((await read("2.1")).git).toEqual([entry({ refs: true })]);
  expect((await read("0.0")).git).toEqual([entry({ index: true, refs: true })]);
  git = { etag: "", watching: false };
  const lost = { cwd: "/r", etag: "", index: false, refs: false, watching: false };
  expect((await read("2.3")).git).toEqual([lost]);
  expect((await read()).git).toEqual([lost]);
  expect((await read("")).git).toBeUndefined();
});

it("reports every git cursor after a host restart", async () => {
  const changes = new RemoteChanges();
  const result = await changes.read(
    { instanceId: "old", sessions: [], projects: [], git: [{ cwd: "/r", known: "0.0" }] },
    () => undefined,
    noSessions,
    undefined,
    undefined,
    async () => ({ etag: "0.0", watching: true }),
  );
  expect(result.reset).toBe(true);
  expect(result.git).toEqual([
    { cwd: "/r", etag: "0.0", index: false, refs: false, watching: true },
  ]);
});

it("validates git subscriptions", async () => {
  const changes = new RemoteChanges();
  const run = (git: unknown) =>
    changes.read(
      { instanceId: changes.instanceId, sessions: [], projects: [], git: git as never },
      () => undefined,
      noSessions,
      undefined,
      undefined,
      async () => ({ etag: "0.0", watching: true }),
    );
  await expect(run(Array.from({ length: 33 }, (_, i) => ({ cwd: `/r${i}` })))).rejects.toThrow(
    "32",
  );
  await expect(run([{ cwd: 4 }])).rejects.toThrow("Invalid git");
  await expect(run([{ cwd: "" }])).rejects.toThrow("Invalid git");
  await expect(run([{ cwd: "/r", known: 3 }])).rejects.toThrow("Invalid git");
  await expect(run("x")).rejects.toThrow("Invalid git");
  await expect(
    run(Array.from({ length: 32 }, (_, i) => ({ cwd: `/r${i}`, known: "0.0" }))),
  ).resolves.toBeTruthy();
});

it("wakes a long poll when a requested git etag changes", async () => {
  const changes = new RemoteChanges();
  let etag = "0.0";
  const started = Date.now();
  const polling = changes.read(
    {
      instanceId: changes.instanceId,
      sessions: [],
      projects: [],
      git: [{ cwd: "/r", known: "0.0" }],
      waitMs: 5000,
    },
    () => undefined,
    noSessions,
    undefined,
    undefined,
    async () => ({ etag, watching: true }),
  );
  setTimeout(() => (etag = "0.1"), 150);
  const result = await polling;
  expect(Date.now() - started).toBeLessThan(2000);
  expect(result.git).toEqual([
    { cwd: "/r", etag: "0.1", index: false, refs: true, watching: true },
  ]);
});
