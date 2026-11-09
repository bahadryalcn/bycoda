import { describe, expect, it } from "vitest";
import { mergeFolderSessionSummaries } from "../../features/sessions/model/sessionFolders";
import type { SessionSummary } from "../../features/sessions/data/sessionStore";
import { folderCandidates, projectSessionCollection } from "./sidebarSessionCollections";

const parent = { parentSessionId: "p", runId: "r", kind: "subagent", model: "m", startedAt: 1 };
const row = (id: string, child = false) =>
  ({ id, cwd: "/repo", ...(child ? { delegationParent: parent } : {}) }) as SessionSummary;

describe("sidebar session collections", () => {
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
