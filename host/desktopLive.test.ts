import { describe, expect, it, vi } from "vitest";
import {
  DesktopLive,
  DESKTOP_BEAT_STALE_MS,
  DESKTOP_COMMAND_RETAIN_MS,
  DESKTOP_WRITER_TRANSFER_MS,
  DESKTOP_STORED_RUNNING_MS,
} from "./desktopLive";
import { ChangeSignal } from "./changeSignal";
import { RemoteChanges } from "./remoteChanges";
import type {
  DesktopProjectDirectory,
  HostProject,
} from "../src/features/connections/model/protocol";

describe("desktop window ownership", () => {
  it("waits for the owning window to retire a warm writer and rejects foreign ACKs", async () => {
    const live = new DesktopLive();
    live.beat({ clientId: "owner", sessions: [], writers: { version: 1, sessionIds: ["warm"] } });
    let finished = false;
    const transfer = live.retireWriters("warm").then(() => {
      finished = true;
    });
    const job = live.beat({
      clientId: "owner",
      sessions: [],
      writers: { version: 1, sessionIds: ["warm"] },
    }).commands[0];
    expect(job).toMatchObject({ sessionId: "warm", type: "retire-writer" });
    live.beat({ clientId: "other", sessions: [], acked: [job.id] });
    await Promise.resolve();
    expect(finished).toBe(false);
    live.beat({
      clientId: "owner",
      sessions: [],
      writers: { version: 1, sessionIds: [] },
      acked: [job.id],
    });
    await transfer;
    expect(finished).toBe(true);
  });

  it("fails closed when an acknowledged writer remains owned or its desktop disappears", async () => {
    let now = 0;
    const live = new DesktopLive(() => now);
    const beat = { clientId: "owner", sessions: [], writers: { version: 1, sessionIds: ["warm"] } };
    live.beat(beat);
    const transfer = live.retireWriters("warm");
    const rejected = expect(transfer).rejects.toThrow("still owns");
    const [job] = live.beat(beat).commands;
    live.beat({ ...beat, acked: [job.id] });
    await rejected;
    now = DESKTOP_BEAT_STALE_MS + 1;
    await expect(live.retireWriters("warm")).rejects.toThrow("unreachable");
  });

  it("times out without an ACK and cancels requests when the Host closes", async () => {
    vi.useFakeTimers();
    try {
      const live = new DesktopLive();
      live.beat({ clientId: "owner", sessions: [], writers: { version: 1, sessionIds: ["warm"] } });
      const timed = expect(live.retireWriters("warm")).rejects.toThrow("did not confirm");
      await vi.advanceTimersByTimeAsync(DESKTOP_WRITER_TRANSFER_MS);
      await timed;
      expect(live.beat({ clientId: "owner", sessions: [] }).commands).toEqual([]);
      const closed = expect(live.retireWriters("warm")).rejects.toThrow("Host closed");
      live.closeWriterTransfers();
      await closed;
    } finally {
      vi.useRealTimers();
    }
  });

  it("reclaims old undeliverable commands while preserving a brief same-session reconnect", () => {
    let now = 0;
    const live = new DesktopLive(() => now);
    live.beat({
      clientId: "old",
      sessions: Array.from({ length: 100 }, (_, index) => ({ id: `old-${index}`, busy: true })),
    });
    for (let index = 0; index < 100; index++)
      live.enqueue({ type: "cancel", sessionId: `old-${index}` });
    now = DESKTOP_BEAT_STALE_MS + 1;
    expect(
      live.beat({ clientId: "new", sessions: [{ id: "current", busy: true }] }).commands,
    ).toHaveLength(0);
    expect(() => live.enqueue({ type: "cancel", sessionId: "current" })).toThrow(
      "Too many commands",
    );
    now = DESKTOP_COMMAND_RETAIN_MS + 1;
    live.beat({ clientId: "new", sessions: [{ id: "current", busy: true }] });
    live.enqueue({ type: "cancel", sessionId: "current" });
    expect(
      live.beat({ clientId: "new", sessions: [{ id: "current", busy: true }] }).commands,
    ).toEqual([expect.objectContaining({ type: "cancel", sessionId: "current" })]);

    const reconnect = new DesktopLive(() => now);
    reconnect.beat({ clientId: "a", sessions: [{ id: "same", busy: true }] });
    reconnect.enqueue({ type: "cancel", sessionId: "same" });
    now += DESKTOP_BEAT_STALE_MS + 1;
    expect(
      reconnect.beat({ clientId: "b", sessions: [{ id: "same", busy: true }] }).commands,
    ).toHaveLength(1);
  });
  it("delivers a new machine cursor when an idle desktop session starts again", async () => {
    const signal = new ChangeSignal();
    const changes = new RemoteChanges(signal);
    const live = new DesktopLive();
    live.onChange = () => signal.notify();
    live.beat({ clientId: "A", sessions: [{ id: "a", busy: true }] });
    live.beat({ clientId: "A", sessions: [] });
    const revision = live.overlay("a")!.changedAt;
    const waiting = changes.read(
      {
        instanceId: changes.instanceId,
        sessions: [{ sessionId: "a", revision }],
        projects: [],
        waitMs: 1000,
      },
      () => live.overlay("a")?.changedAt,
      async () => ({ etag: "", sessions: [] }),
    );
    live.beat({ clientId: "A", sessions: [{ id: "a", busy: true }] });
    const result = await waiting;
    expect(result.sessions).toEqual([{ sessionId: "a", revision: live.overlay("a")!.changedAt }]);
    expect(result.sessions[0]!.revision).toBeGreaterThan(revision);
  });

  it("publishes running transitions before notifying watchers, even without prompt changes", () => {
    const live = new DesktopLive(() => 100);
    const observed: { running: boolean; revision: number | undefined }[] = [];
    live.onChange = () =>
      observed.push({
        running: live.running("a", false),
        revision: live.overlay("a")?.changedAt,
      });
    live.beat({ clientId: "A", sessions: [{ id: "a", busy: false }] });
    const idleRevision = live.overlay("a")!.changedAt;
    live.beat({ clientId: "A", sessions: [{ id: "a", busy: true }] });
    const runningRevision = live.overlay("a")!.changedAt;
    expect(runningRevision).toBeGreaterThan(idleRevision);
    expect(observed.at(-1)).toEqual({ running: true, revision: runningRevision });
    live.beat({ clientId: "A", sessions: [{ id: "a", busy: true }] });
    expect(observed).toHaveLength(2);
    live.beat({ clientId: "A", sessions: [{ id: "a", busy: false }] });
    const stoppedRevision = live.overlay("a")!.changedAt;
    expect(stoppedRevision).toBeGreaterThan(runningRevision);
    expect(observed.at(-1)).toEqual({ running: false, revision: stoppedRevision });
    live.beat({ clientId: "A", sessions: [{ id: "a", busy: true }] });
    expect(live.overlay("a")!.changedAt).toBeGreaterThan(stoppedRevision);
    live.beat({ clientId: "A", sessions: [] });
    expect(observed.at(-1)?.running).toBe(false);
    const notifications = observed.length;
    live.beat({ clientId: "A", sessions: [] });
    expect(observed).toHaveLength(notifications);
  });

  it("keeps other windows alive and routes cancel, approve and answer to their owner", () => {
    const live = new DesktopLive();
    live.beat({ clientId: "A", sessions: [{ id: "a", busy: true }] });
    live.beat({ clientId: "B", sessions: [{ id: "b", busy: true }] });
    expect(live.running("a", false)).toBe(true);
    expect(live.running("b", false)).toBe(true);
    live.enqueue({ type: "cancel", sessionId: "a" });
    live.enqueue({
      type: "approve",
      sessionId: "a",
      requestId: 1,
      decision: "allow",
    });
    live.enqueue({
      type: "answer",
      sessionId: "a",
      requestId: 2,
      reply: { kind: "skipped" },
    });
    const a = live.beat({ clientId: "A", sessions: [{ id: "a", busy: true }] });
    expect(a.commands).toHaveLength(3);
    const acked = a.commands.map((command) => command.id);
    expect(
      live.beat({ clientId: "B", sessions: [{ id: "b", busy: true }], acked }).commands,
    ).toEqual([]);
    expect(live.beat({ clientId: "A", sessions: [{ id: "a", busy: true }] }).commands).toHaveLength(
      3,
    );
    expect(live.beat({ clientId: "A", sessions: [], acked }).commands).toEqual([]);
    expect(live.running("a", false)).toBe(false);
    expect(live.running("b", false)).toBe(true);
  });

  it("expires only the vanished owner and permits a replacement window", () => {
    let now = 0;
    const live = new DesktopLive(() => now);
    live.beat({ clientId: "A", sessions: [{ id: "a", busy: true }] });
    now = DESKTOP_BEAT_STALE_MS - 1;
    live.beat({ clientId: "B", sessions: [{ id: "b", busy: true }] });
    now += 2;
    expect(live.running("a", true)).toBe(false);
    expect(live.running("b", true)).toBe(true);
    live.beat({
      clientId: "B",
      sessions: [
        { id: "a", busy: true },
        { id: "b", busy: true },
      ],
    });
    expect(live.running("a", false)).toBe(true);
  });

  it("does not let an idle duplicate tab steal a live owner's prompts", () => {
    const live = new DesktopLive();
    live.beat({ clientId: "A", sessions: [{ id: "a", busy: true }] });
    live.enqueue({ type: "cancel", sessionId: "a" });
    expect(live.beat({ clientId: "B", sessions: [{ id: "a", busy: false }] }).commands).toEqual([]);
    expect(live.running("a", false)).toBe(true);
  });
});

describe("privacy-filtered project directory", () => {
  it("renews only an acknowledged client's exact privacy revision and requires content after reset", () => {
    let now = 0;
    const live = new DesktopLive(() => now);
    const projection = {
      version: 1 as const,
      groups: [],
      excludedPaths: [],
      excludedGroupIds: [],
      projects: [{ cwd: "/work", name: "Work" }],
    };
    expect(
      live.beat({
        clientId: "a",
        sessions: [],
        projectDirectoryRevision: "1",
        projectDirectory: projection,
      }).projectDirectoryRevision,
    ).toBe("1");
    now = 15_000;
    expect(
      live.beat({ clientId: "a", sessions: [], projectDirectoryRevision: "1" })
        .projectDirectoryRevision,
    ).toBe("1");
    now = 25_000;
    expect(live.projectDirectory([], "host").privacyReady).toBe(true);
    expect(
      live.beat({ clientId: "a", sessions: [], projectDirectoryRevision: "wrong" })
        .projectDirectoryRevision,
    ).toBeUndefined();
    now = 35_001;
    expect(live.projectDirectory([], "host").privacyReady).toBe(false);
    const restarted = new DesktopLive(() => now);
    expect(
      restarted.beat({ clientId: "a", sessions: [], projectDirectoryRevision: "1" })
        .projectDirectoryRevision,
    ).toBeUndefined();
    expect(
      restarted.beat({ clientId: "b", sessions: [], projectDirectoryRevision: "1" })
        .projectDirectoryRevision,
    ).toBeUndefined();
    expect(
      restarted.beat({
        clientId: "a",
        sessions: [],
        projectDirectoryRevision: "2",
        projectDirectory: { ...projection, excludedPaths: undefined },
      }).projectDirectoryRevision,
    ).toBeUndefined();
  });

  it("carries saved identity through host IDs, replacements, and privacy exclusions", () => {
    const live = new DesktopLive(() => 0);
    const projection = {
      version: 1 as const,
      projects: [
        {
          cwd: "/work",
          name: "Work",
          appearance: {
            color: "hsl(120 100% 50%)",
            logo: "data:image/png;base64,iVBORw0KGgoAAA==",
            icon: { path: "M1 1h10v10z", highlight: "#aabbcc" },
          },
        },
      ],
      groups: [],
      excludedPaths: [],
      excludedGroupIds: [],
    };
    live.beat({ clientId: "desktop", sessions: [], projectDirectory: projection });
    expect(
      live.projectDirectory([{ id: "registered", cwd: "/work", name: "old" }], "host").projects[0],
    ).toMatchObject({
      id: "registered",
      name: "Work",
      appearance: { ...projection.projects[0].appearance, color: "#00ff00" },
    });
    live.beat({
      clientId: "desktop",
      sessions: [],
      projectDirectory: { ...projection, projects: [{ cwd: "/work", name: "Work" }] },
    });
    expect(live.projectDirectory([], "host").projects[0].appearance).toBeUndefined();
    live.beat({
      clientId: "desktop",
      sessions: [],
      projectDirectory: { ...projection, excludedPaths: ["/work"] },
    });
    expect(live.projectDirectory([], "host").projects).toEqual([]);
  });
  it("uses desktop visibility and order while carrying read-only session organization", () => {
    const live = new DesktopLive(() => 0);
    const sessionLayout = {
      folders: [{ id: "f", name: "Work", sessionIds: ["s"], collapsed: false }],
      order: { loose: ["s"] },
    };
    live.beat({
      clientId: "desktop",
      sessions: [],
      projectDirectory: {
        version: 1,
        groups: [],
        excludedPaths: [],
        excludedGroupIds: [],
        projects: [
          { cwd: "/second", name: "Second", sessionLayout },
          { cwd: "/first", name: "First" },
        ],
      },
    });
    const result = live.projectDirectory(
      [
        { id: "a", cwd: "/first", name: "First" },
        { id: "ghost", cwd: "/removed", name: "Removed" },
        { id: "b", cwd: "/second", name: "Second" },
      ],
      "host",
    );
    expect(result.projects.map((project) => project.id)).toEqual(["b", "a"]);
    expect(result.projects[0]?.sessionLayout).toEqual(sessionLayout);
    expect(JSON.stringify(result)).not.toContain("Removed");
  });
  const projection = (): DesktopProjectDirectory => ({
    version: 1,
    groups: [{ id: "work", name: "Work" }],
    projects: [
      { cwd: "G:/Projects/shared", name: "Shared", groupId: "work" },
      { cwd: "G:/New", name: "New", groupId: "work" },
    ],
    excludedPaths: ["G:/Private"],
    excludedGroupIds: ["private"],
  });
  it("preserves all host IDs and adds desktop-only folders without registering them", () => {
    const live = new DesktopLive(() => 0);
    const registered: HostProject[] = Array.from({ length: 80 }, (_, index) => ({
      id: `p${index}`,
      cwd: index < 2 ? "g:/projects/shared" : `G:/Projects/${index}`,
      name: `P${index}`,
    }));
    live.beat({
      clientId: "desktop",
      sessions: [],
      projectDirectory: {
        ...projection(),
        projects: [
          ...projection().projects,
          ...registered.slice(2).map(({ cwd, name }) => ({ cwd, name })),
        ],
      },
    });
    const result = live.projectDirectory(
      [...registered, { id: "private", cwd: "g:\\private", name: "Secret" }],
      "host",
    );
    expect(result.privacyReady).toBe(true);
    expect(result.projects.find((project) => project.id === "p0")?.name).toBe("Shared");
    expect(result.projects.find((project) => project.id === "p2")?.name).toBe("P2");
    expect(result.projects.filter((project) => project.registered)).toHaveLength(80);
    expect(
      result.projects
        .filter((project) => project.id === "p0" || project.id === "p1")
        .every((project) => project.groupId === "work"),
    ).toBe(true);
    expect(result.projects.find((project) => project.cwd === "G:/New")).toMatchObject({
      id: "loc:host:g:/new",
      registered: false,
    });
    expect(JSON.stringify(result)).not.toContain("Secret");
  });
  it("fails closed before a valid desktop snapshot and after it becomes stale", () => {
    let now = 0;
    const live = new DesktopLive(() => now);
    const registered = [{ id: "p", cwd: "/private", name: "Private" }];
    expect(live.projectDirectory(registered, "host")).toMatchObject({
      privacyReady: false,
      projects: [],
      groups: [],
    });
    live.beat({ clientId: "desktop", sessions: [], projectDirectory: projection() });
    now = DESKTOP_BEAT_STALE_MS + 1;
    expect(live.projectDirectory(registered, "host")).toMatchObject({
      privacyReady: false,
      projects: [],
      groups: [],
    });
  });
  it("retains the stricter privacy snapshot while other desktop windows are alive", () => {
    let now = 0;
    const live = new DesktopLive(() => now);
    live.beat({
      clientId: "A",
      sessions: [],
      projectDirectory: {
        ...projection(),
        groups: [],
        projects: [],
        excludedGroupIds: ["work"],
        excludedPaths: ["G:/Projects/shared"],
      },
    });
    now = 1;
    live.beat({ clientId: "B", sessions: [], projectDirectory: projection() });
    const result = live.projectDirectory(
      [
        { id: "shared", cwd: "g:/projects/shared", name: "Shared" },
        { id: "new", cwd: "G:/New", name: "New" },
      ],
      "host",
    );
    expect(result.groups).toEqual([]);
    expect(result.projects).toEqual([]);
  });
  it("rejects malformed protection metadata instead of treating it as no exclusions", () => {
    const live = new DesktopLive(() => 0);
    live.beat({ clientId: "other", sessions: [], projectDirectory: projection() });
    live.beat({
      clientId: "desktop",
      sessions: [],
      projectDirectory: { ...projection(), excludedPaths: undefined },
    });
    expect(live.projectDirectory([], "host").privacyReady).toBe(false);
  });
});

describe("run leases and the in-flight mark", () => {
  it("lets a quiet window keep its run lease (its own expiry decides) and ends it when the window reports idle", () => {
    let now = 0;
    const live = new DesktopLive(() => now);
    const ended: Array<[string, string, string | undefined]> = [];
    live.onIdle = (id, clientId, reason) => void ended.push([id, clientId, reason]);
    live.beat({ clientId: "a", sessions: [{ id: "s", busy: true }] });
    // Another window's beat finds `a` quiet for longer than the stale limit.
    now = DESKTOP_BEAT_STALE_MS + 1;
    live.beat({ clientId: "b", sessions: [] });
    expect(ended).toEqual([["s", "a", "gone"]]);
    // A window that reports the conversation idle is a plain end.
    live.beat({ clientId: "c", sessions: [{ id: "t", busy: true }] });
    live.beat({ clientId: "c", sessions: [] });
    expect(ended.at(-1)).toEqual(["t", "c", undefined]);
  });

  it("stops believing the in-flight mark a crashed app left behind, after a while", () => {
    let now = 0;
    const live = new DesktopLive(() => now);
    // An app without a heartbeat: believed for a while, so a long turn is not a free-for-all.
    expect(live.running("s", true)).toBe(true);
    now += DESKTOP_STORED_RUNNING_MS - 1;
    expect(live.running("s", true)).toBe(true);
    now += 2;
    expect(live.running("s", true)).toBe(false);
    // The mark going away starts the clock again.
    expect(live.running("s", false)).toBe(false);
    expect(live.running("s", true)).toBe(true);
    // Once an app beats, its heartbeat decides and the stored mark is ignored.
    live.beat({ clientId: "a", sessions: [] });
    expect(live.running("s", true)).toBe(false);
  });
});

describe("in-flight marks believed without a heartbeat", () => {
  it("tells when the earliest mark stops counting, only while no app has beat", () => {
    let now = 1_000;
    const live = new DesktopLive(() => now);
    expect(live.nextStoredExpiry()).toBeUndefined();
    expect(live.running("chat", true)).toBe(true);
    expect(live.nextStoredExpiry()).toBe(1_000 + DESKTOP_STORED_RUNNING_MS);
    now += 10_000;
    expect(live.running("other", true)).toBe(true);
    expect(live.nextStoredExpiry()).toBe(1_000 + DESKTOP_STORED_RUNNING_MS);
    // Past it the mark no longer counts and no timer is wanted for it.
    now = 1_000 + DESKTOP_STORED_RUNNING_MS + 1;
    expect(live.running("chat", true)).toBe(false);
    expect(live.nextStoredExpiry()).toBe(11_000 + DESKTOP_STORED_RUNNING_MS);
    // An app that beats makes the marks irrelevant.
    live.beat({ clientId: "app", sessions: [] });
    expect(live.nextStoredExpiry()).toBeUndefined();
  });
});
