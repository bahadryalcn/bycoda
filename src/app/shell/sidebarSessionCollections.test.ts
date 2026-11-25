import { describe, expect, it, vi } from "vitest";
import { mergeFolderSessionSummaries } from "../../features/sessions/model/sessionFolders";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { HostSessionSummary } from "../../features/connections/model/protocol";
import { filterAssistantManagedSessions } from "../../features/sessions/model/sessionFilters";
import {
  folderCandidates,
  freshRemoteProjects,
  projectSessionCollection,
  sessionsForActionIds,
  workingAgentIdsByProject,
} from "./sidebarSessionCollections";
import { pathKey } from "../../shared/lib/paths";

const parent = { parentSessionId: "p", runId: "r", kind: "subagent", model: "m", startedAt: 1 };
const row = (id: string, child = false) =>
  ({ id, cwd: "/repo", ...(child ? { delegationParent: parent } : {}) }) as SessionSummary;

const remoteHost = (id: string): HostSessionSummary => ({
  id,
  title: id,
  projectId: "project",
  revision: 1,
  status: "idle",
  updatedAt: 2,
  harness: "codex",
});

describe("sidebar session collections", () => {
  it("checks each freshly listed project once, even after a stale row for that project", () => {
    const rows = [
      { project: "a", fresh: false },
      { project: "b", fresh: true },
      { project: "a", fresh: true },
      { project: "b", fresh: true },
      { project: "c" },
    ];
    expect([...freshRemoteProjects(rows)]).toEqual(["b", "a"]);
  });

  it("indexes each active agent and its Host alias within its project", () => {
    const agent = { cwd: "C:/Repo/", id: "shell", done: false, needsApproval: false };
    const alias = vi.fn((id: string) => (id === "shell" ? "host" : undefined));
    const index = workingAgentIdsByProject(
      [
        agent,
        { ...agent, id: "local", cwd: "c:/repo" },
        { ...agent, id: "stopped", done: true },
        { ...agent, id: "approval", needsApproval: true },
        { ...agent, id: "other", cwd: "/other" },
      ],
      alias,
    );
    expect(index.get(pathKey("c:/repo"))).toEqual(new Set(["shell", "host", "local"]));
    expect(index.get(pathKey("/other"))).toEqual(new Set(["other"]));
    expect(alias.mock.calls.flat()).toEqual(["shell", "local", "other"]);
  });

  it("resolves batch actions in selection order using the first listed row for each ID", () => {
    const first = row("a");
    const other = row("b");
    const duplicate = { ...first, cwd: "/another" };
    expect(sessionsForActionIds([first, other, duplicate], ["b", "missing", "a"])).toEqual([
      other,
      first,
    ]);
  });

  it("preserves remote Assistant management for the sidebar filter", () => {
    const managedBy = { assistant: true, jobId: "job", managedAt: 1 } as const;
    const remote = (id: string, managed: boolean): HostSessionSummary => ({
      id,
      title: id,
      projectId: "project",
      revision: 1,
      status: "idle",
      updatedAt: 2,
      harness: "codex",
      ...(managed ? { managedBy } : {}),
    });
    const sessions = projectSessionCollection(
      true,
      [remote("managed", true), remote("manual", false)],
      [],
      "/repo",
    );

    expect(filterAssistantManagedSessions(sessions, true).map((session) => session.id)).toEqual([
      "managed",
    ]);
    expect(sessions[0].managedBy).toEqual(managedBy);
    expect(sessions[1].managedBy).toBeUndefined();
  });

  it("hides background sessions unless pinned or shown, and keeps legacy ones", () => {
    const owner = { kind: "task", id: "t", role: "reviewer" } as const;
    const background = (id: string, extra = {}) =>
      ({ id, cwd: "/repo", backgroundOwner: owner, ...extra }) as SessionSummary;
    const rows = [row("chat"), background("bg"), background("pinned", { pinned: true })];
    expect(projectSessionCollection(false, [], rows, "/repo").map((s) => s.id)).toEqual([
      "chat",
      "pinned",
    ]);
    expect(projectSessionCollection(false, [], rows, "/repo", true).map((s) => s.id)).toEqual([
      "chat",
      "bg",
      "pinned",
    ]);
    const hosted = { ...remoteHost("bg"), backgroundOwner: owner } as HostSessionSummary;
    expect(projectSessionCollection(true, [hosted, remoteHost("chat")], [], "/repo")).toHaveLength(
      1,
    );
    const shown = projectSessionCollection(true, [hosted], [], "/repo", true);
    expect(shown[0]?.backgroundOwner).toEqual(owner);
    expect(folderCandidates(false, rows)).toHaveLength(2);
  });

  it("keeps delegated children out of project rows and saved folders", () => {
    expect(projectSessionCollection(false, [], [row("a"), row("c", true)], "/repo")).toEqual([
      row("a"),
    ]);
    const folder = { id: "f", name: "f", sessionIds: ["c"], collapsed: false };
    expect(
      mergeFolderSessionSummaries([], folderCandidates(false, [row("c", true)]), [folder]),
    ).toEqual([]);
  });
});
