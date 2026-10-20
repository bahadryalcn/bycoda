import { describe, expect, it } from "vitest";
import { DesktopLive, DESKTOP_BEAT_STALE_MS } from "./desktopLive";
import { ChangeSignal } from "./changeSignal";
import { RemoteChanges } from "./remoteChanges";
import type {
  DesktopProjectDirectory,
  HostProject,
} from "../src/features/connections/model/protocol";

describe("desktop window ownership", () => {
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
  it("uses desktop visibility and order while carrying read-only session organization", () => {
    const live = new DesktopLive(() => 0);
    const sessionLayout = { folders: [{ id: "f", name: "Work", sessionIds: ["s"], collapsed: false }], order: { loose: ["s"] } };
    live.beat({ clientId: "desktop", sessions: [], projectDirectory: {
      version: 1, groups: [], excludedPaths: [], excludedGroupIds: [],
      projects: [{ cwd: "/second", name: "Second", sessionLayout }, { cwd: "/first", name: "First" }],
    } });
    const result = live.projectDirectory([
      { id: "a", cwd: "/first", name: "First" }, { id: "ghost", cwd: "/removed", name: "Removed" },
      { id: "b", cwd: "/second", name: "Second" },
    ], "host");
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
    live.beat({ clientId: "desktop", sessions: [], projectDirectory: {
      ...projection(), projects: [...projection().projects, ...registered.slice(2).map(({ cwd, name }) => ({ cwd, name }))],
    } });
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
