import { expect, it } from "vitest";
import { buildRecentSessions } from "../../sessions/model/recentSessions";
import { pathKey } from "../../../shared/lib/paths";
import { workingProjectPaths } from "../../sessions/model/liveAgents";
import type { HostSessionSummary } from "./protocol";
import {
  nextRemoteUnseenFinished,
  remoteLiveAgents,
  remoteLiveSessionInfos,
  unopenedRemoteSessions,
  type RemoteRailSession,
} from "./remoteRailSessions";

const project = "remote://env/home/me/repo";
const listed = (session: Partial<HostSessionSummary> & { id: string }): RemoteRailSession => ({
  project,
  session: {
    projectId: "project",
    revision: 1,
    status: "idle",
    updatedAt: 10,
    title: session.id,
    harness: "claude",
    ...session,
  },
});

it("leaves out sessions an open tab has loaded, archived ones and drafts", () => {
  const sessions = [
    listed({ id: "open" }),
    listed({ id: "archived", archived: true }),
    listed({ id: "draft", draft: true }),
    listed({ id: "unopened" }),
  ];
  expect(
    unopenedRemoteSessions(sessions, new Set(["open"])).map(({ session }) => session.id),
  ).toEqual(["unopened"]);
});

it("shows only running host sessions and ones waiting for input as working", () => {
  const agents = remoteLiveAgents([
    listed({ id: "idle" }),
    listed({ id: "running", status: "running", title: "Roadmap" }),
    listed({ id: "asking", status: "running", needsInput: true }),
  ]);
  expect(agents).toMatchObject([
    { id: "running", cwd: project, title: "Roadmap", activity: "Working", needsApproval: false },
    { id: "asking", activity: "Needs input", needsApproval: true },
  ]);
});

it("marks unopened remote projects working until the host finishes or needs input", () => {
  const paths = (session: Partial<HostSessionSummary> & { id: string }) =>
    workingProjectPaths(remoteLiveAgents(unopenedRemoteSessions([listed(session)], new Set())));
  expect(paths({ id: "background", status: "running" })).toEqual([project]);
  expect(paths({ id: "background", status: "running", needsInput: true })).toEqual([]);
  expect(paths({ id: "background", status: "idle" })).toEqual([]);
});

it("lists a host session that was never opened here in Last sessions", () => {
  const live = remoteLiveSessionInfos([
    listed({ id: "idle", updatedAt: 50 }),
    listed({ id: "running", status: "running" }),
  ]);
  const rows = buildRecentSessions({
    stored: [],
    live,
    projectKeys: new Set([pathKey(project)]),
    limit: 10,
    now: 1_000,
  });
  expect(rows).toMatchObject([
    { id: "running", status: "working", remote: true, updatedAt: 1_000 },
    { id: "idle", status: undefined, remote: true, updatedAt: 50 },
  ]);
});

const fresh = (session: Partial<HostSessionSummary> & { id: string }) => ({
  ...listed(session),
  fresh: true,
});

it("marks a host session done once it stops running, until it is opened", () => {
  const first = nextRemoteUnseenFinished({
    listed: [fresh({ id: "a", status: "running" })],
    previousRunningIds: new Set(),
    previousUnseenIds: new Set(),
    loadedHostIds: new Set(),
  });
  expect([...first.unseenIds]).toEqual([]);
  const finished = nextRemoteUnseenFinished({
    listed: [fresh({ id: "a" })],
    previousRunningIds: first.runningIds,
    previousUnseenIds: first.unseenIds,
    loadedHostIds: new Set(),
  });
  expect([...finished.unseenIds]).toEqual(["a"]);
  const kept = nextRemoteUnseenFinished({
    listed: [fresh({ id: "a" })],
    previousRunningIds: finished.runningIds,
    previousUnseenIds: finished.unseenIds,
    loadedHostIds: new Set(),
  });
  expect([...kept.unseenIds]).toEqual(["a"]);
  const opened = nextRemoteUnseenFinished({
    listed: [fresh({ id: "a" })],
    previousRunningIds: kept.runningIds,
    previousUnseenIds: kept.unseenIds,
    loadedHostIds: new Set(["a"]),
  });
  expect([...opened.unseenIds]).toEqual([]);
});

it("does not read a cached list as a finished turn", () => {
  const next = nextRemoteUnseenFinished({
    listed: [listed({ id: "a" })],
    previousRunningIds: new Set(["a"]),
    previousUnseenIds: new Set(),
    loadedHostIds: new Set(),
  });
  expect([...next.unseenIds]).toEqual([]);
  expect([...next.runningIds]).toEqual(["a"]);
});

it("does not mark the focused session or one that left the list", () => {
  const next = nextRemoteUnseenFinished({
    listed: [fresh({ id: "a" })],
    previousRunningIds: new Set(["a", "gone"]),
    previousUnseenIds: new Set(["old"]),
    loadedHostIds: new Set(),
    focusedHostId: "a",
  });
  expect([...next.unseenIds]).toEqual([]);
});

it("shows a finished host session as done on the working card", () => {
  const agents = remoteLiveAgents([listed({ id: "a" }), listed({ id: "b" })], new Set(["a"]));
  expect(agents).toMatchObject([{ id: "a", done: true, activity: "Done" }]);
});

it("keeps unopened host retry and failure states distinct from working and done", () => {
  const rows = [
    listed({ id: "retry", status: "running", issue: "retrying" }),
    listed({ id: "failed", issue: "failed" }),
  ];
  expect(remoteLiveSessionInfos(rows).map((row) => row.status)).toEqual(["retrying", "failed"]);
  expect(remoteLiveAgents(rows).map((agent) => [agent.issue, agent.activity, agent.done])).toEqual([
    ["retrying", "Retrying", false],
    ["failed", "Failed", true],
  ]);
});
