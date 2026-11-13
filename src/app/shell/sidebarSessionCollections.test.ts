import { describe, expect, it } from "vitest";
import { mergeFolderSessionSummaries } from "../../features/sessions/model/sessionFolders";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import type { HostSessionSummary } from "../../features/connections/model/protocol";
import { filterAssistantManagedSessions } from "../../features/sessions/model/sessionFilters";
import { folderCandidates, projectSessionCollection } from "./sidebarSessionCollections";

const parent = { parentSessionId: "p", runId: "r", kind: "subagent", model: "m", startedAt: 1 };
const row = (id: string, child = false) =>
  ({ id, cwd: "/repo", ...(child ? { delegationParent: parent } : {}) }) as SessionSummary;

describe("sidebar session collections", () => {
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
