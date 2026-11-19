import { expect, it, vi } from "vitest";
import type { HostStreamTarget } from "../transport/ws/subscriptions";
import { createSubscriptionsRuntime } from "./subscriptions";

it("does not refresh sibling session streams when another session of the project changes", () => {
  const versions = { project: 1, scope: 1, a: 1, b: 1 };
  let notify!: () => void;
  const store = {
    environmentId: "env",
    unattributedChangeVersion: 0,
    projectVersion: () => versions.project,
    versions: {
      scope: () => versions.scope,
      session: (id: string) => (id === "a" ? versions.a : versions.b),
    },
    subscribeChanges: (listener: () => void) => {
      notify = listener;
      return () => undefined;
    },
    subscribeAuthorityChanges: () => () => undefined,
    subscribeAuthorizationChanges: () => () => undefined,
  };
  const noop = { onDelete: undefined, onChange: undefined };
  const runtime = createSubscriptionsRuntime({
    engine: { store },
    tasks: noop,
    goals: noop,
    automations: noop,
    stewards: noop,
    hostNotes: noop,
    crews: { definitions: noop, agents: noop, runs: noop },
    desktop: { live: noop },
    signal: { notify: () => undefined },
    catalogs: noop,
  } as never);
  const invalidate = vi.spyOn(runtime.subscriptionHub, "invalidate");
  runtime.streamProjects.set("a", "p");
  runtime.streamProjects.set("b", "p");
  runtime.streamProjectVersions.set("p", 1);
  runtime.streamProjectScopes.set("p", 1);
  runtime.streamSessionVersions.set("a", 1);
  runtime.streamSessionVersions.set("b", 1);

  versions.a = 2; // "a" streams: its save moves its own version, nothing else
  notify();
  expect(invalidate).toHaveBeenCalledWith({ kind: "session", sessionId: "a" });
  expect(invalidate).not.toHaveBeenCalledWith({ kind: "session", sessionId: "b" });

  invalidate.mockClear();
  versions.project = 2; // list-visible change of "a"
  versions.a = 3;
  notify();
  expect(invalidate).toHaveBeenCalledWith({ kind: "project", projectId: "p" });
  expect(invalidate).not.toHaveBeenCalledWith({ kind: "session", sessionId: "b" });

  invalidate.mockClear();
  versions.project = 3; // unattributed change inside the project
  versions.scope = 2;
  notify();
  expect(invalidate).toHaveBeenCalledWith({ kind: "session", sessionId: "b" });
  runtime.unsubscribeChanges();
});

type DirectoryProject = { id: string; cwd: string; name: string; registered: boolean };
function environmentRuntime() {
  const state = {
    projects: [{ id: "a", cwd: "/a", name: "A", registered: true }] as DirectoryProject[],
    privacyReady: true,
    sessions: [] as { id: string; title: string }[],
  };
  const live: {
    onChange?: () => void;
    onSourceChange?: () => void;
    onDirectoryChange?: () => void;
    groupLock: { access: () => unknown };
    projectDirectory: () => unknown;
  } = {
    groupLock: { access: () => ({ groupIds: new Set<string>(), hiddenList: false }) },
    projectDirectory: () => ({
      version: 1,
      privacyReady: state.privacyReady,
      groups: [],
      projects: state.privacyReady ? [...state.projects] : [],
    }),
  };
  const store = {
    environmentId: "env",
    unattributedChangeVersion: 0,
    db: { outsideScope: async (run: () => unknown) => await run() },
    projects: async () => state.projects.map(({ registered: _registered, ...project }) => project),
    projectVersion: () => 1,
    versions: { scope: () => 1, session: () => 1 },
    subscribeChanges: () => () => undefined,
    subscribeAuthorityChanges: () => () => undefined,
    subscribeAuthorizationChanges: () => () => undefined,
  };
  const noop = { onDelete: undefined, onChange: undefined };
  const runtime = createSubscriptionsRuntime({
    engine: { store },
    tasks: noop,
    goals: noop,
    automations: noop,
    stewards: noop,
    hostNotes: noop,
    crews: { definitions: noop, agents: noop, runs: noop },
    projectsService: {
      list: async () => state.projects.map((p) => ({ id: p.id, cwd: p.cwd, name: p.name })),
    },
    projectSessionList: async () => ({
      etag: state.sessions.map((session) => session.title).join(),
      list: state.sessions,
    }),
    desktop: { live },
    signal: { notify: () => undefined },
    catalogs: noop,
  } as never);
  const events: {
    subscriptionId: string;
    kind: string;
    data?: any;
    revision?: number;
    baseRevision?: number;
    cursor: { epoch: string; sequence: number };
  }[] = [];
  const owner = {
    connectionId: "connection",
    principalId: "principal",
    authorized: async () => true,
    send: (event: { params: (typeof events)[number] }) => {
      events.push(event.params);
      return true;
    },
  };
  const open = (
    subscriptionId = "s",
    cursor?: { epoch: string; sequence: number },
    target: HostStreamTarget = { kind: "environment" },
  ) => {
    const opened = runtime.subscriptionHub.open(owner, {
      subscriptionId,
      target,
      ...(cursor ? { cursor } : {}),
    });
    opened.activate();
  };
  return { runtime, state, live, events, open };
}

it("publishes the whole project directory on the environment stream and keeps the legacy projects field", async () => {
  vi.useFakeTimers();
  try {
    const { runtime, events, open } = environmentRuntime();
    open();
    await vi.advanceTimersByTimeAsync(500);
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe("snapshot");
    expect(events[0]!.data.projects).toEqual([{ id: "a", cwd: "/a", name: "A" }]);
    expect(events[0]!.data.directory).toEqual({
      version: 1,
      privacyReady: true,
      groups: [],
      projects: [{ id: "a", cwd: "/a", name: "A", registered: true }],
    });
    runtime.subscriptionHub.close();
    runtime.unsubscribeChanges();
  } finally {
    vi.useRealTimers();
  }
});

it("pushes desktop directory changes, removals and privacy loss without a session change", async () => {
  vi.useFakeTimers();
  try {
    const { runtime, state, live, events, open } = environmentRuntime();
    open();
    await vi.advanceTimersByTimeAsync(500);
    expect(typeof live.onDirectoryChange).toBe("function");
    state.projects = [];
    live.onDirectoryChange!();
    await vi.advanceTimersByTimeAsync(500);
    expect(events.at(-1)!.data.directory.projects).toEqual([]);
    state.projects = [{ id: "b", cwd: "/b", name: "B", registered: true }];
    state.privacyReady = false;
    live.onDirectoryChange!();
    await vi.advanceTimersByTimeAsync(500);
    expect(events.at(-1)!.data.directory).toMatchObject({ privacyReady: false, projects: [] });
    expect(events.map((event) => event.cursor.sequence)).toEqual([1, 2, 3]);
    runtime.subscriptionHub.close();
    runtime.unsubscribeChanges();
  } finally {
    vi.useRealTimers();
  }
});

it("re-reads an open environment stream when a desktop snapshot ages out", async () => {
  vi.useFakeTimers();
  try {
    const { runtime, state, events, open } = environmentRuntime();
    open();
    await vi.advanceTimersByTimeAsync(500);
    state.privacyReady = false; // the desktop heartbeat went stale; no commit announces it
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events.at(-1)!.data.directory.privacyReady).toBe(false);
    runtime.subscriptionHub.close();
    runtime.unsubscribeChanges();
  } finally {
    vi.useRealTimers();
  }
});

it("replays a missed directory change to a reconnecting cursor", async () => {
  vi.useFakeTimers();
  try {
    const { runtime, state, live, events, open } = environmentRuntime();
    open("first");
    await vi.advanceTimersByTimeAsync(500);
    const cursor = events[0]!.cursor;
    runtime.subscriptionHub.closeSubscription("connection", "first");
    state.projects = [];
    live.onDirectoryChange!();
    events.length = 0;
    open("second", cursor);
    await vi.advanceTimersByTimeAsync(500);
    expect(events.at(-1)!.data.directory.projects).toEqual([]);
    runtime.subscriptionHub.close();
    runtime.unsubscribeChanges();
  } finally {
    vi.useRealTimers();
  }
});

it("streams a delta project target as changed rows and keeps the plain target a full snapshot", async () => {
  vi.useFakeTimers();
  try {
    const { runtime, state, events, open } = environmentRuntime();
    state.sessions = [
      { id: "a", title: "a" },
      { id: "b", title: "b" },
      { id: "c", title: "c" },
    ];
    open("delta", undefined, { kind: "project", projectId: "p", delta: true });
    open("plain", undefined, { kind: "project", projectId: "p" });
    await vi.advanceTimersByTimeAsync(500);
    const delta = () => events.filter((event) => event.subscriptionId === "delta");
    const plain = () => events.filter((event) => event.subscriptionId === "plain");
    expect(delta()).toHaveLength(1);
    expect(delta()[0]).toMatchObject({ kind: "snapshot", data: { sessions: state.sessions } });
    expect(plain()[0]).toMatchObject({ kind: "snapshot", data: { sessions: state.sessions } });
    for (const [id, event] of [
      ["delta", delta()[0]!],
      ["plain", plain()[0]!],
    ] as const)
      runtime.subscriptionHub.acknowledge("connection", id, event.cursor);

    // "c" streams: it changes and moves to the front.
    state.sessions = [{ id: "c", title: "c streaming" }, state.sessions[0]!, state.sessions[1]!];
    runtime.subscriptionHub.invalidate({ kind: "project", projectId: "p" });
    await vi.advanceTimersByTimeAsync(500);
    expect(delta()).toHaveLength(2);
    expect(delta()[1]).toMatchObject({
      kind: "delta",
      baseRevision: delta()[0]!.revision,
      data: { etag: "c streaming,a,b", sessions: [{ id: "c", title: "c streaming" }], head: ["c"] },
    });
    expect(plain().at(-1)).toMatchObject({ kind: "snapshot", data: { sessions: state.sessions } });

    // A commit that leaves the list as it was sends nothing.
    runtime.subscriptionHub.acknowledge("connection", "delta", delta()[1]!.cursor);
    runtime.subscriptionHub.invalidate({ kind: "project", projectId: "p" });
    await vi.advanceTimersByTimeAsync(500);
    expect(delta()).toHaveLength(2);
    runtime.subscriptionHub.close();
    runtime.unsubscribeChanges();
  } finally {
    vi.useRealTimers();
  }
});
