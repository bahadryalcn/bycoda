import { describe, expect, it } from "vitest";
import type { SessionContentSession } from "../../sessions/data/sessionStore";
import {
  chatEntries,
  groupChatSessions,
  highlightRuns,
  hitsFromContentSessions,
  scopeCwds,
  sinceFor,
  type ProjectGrouping,
} from "./chatSearch";

function session(
  id: string,
  cwd: string,
  overrides: Partial<SessionContentSession> = {},
): SessionContentSession {
  return {
    sessionId: id,
    cwd,
    harness: "claude",
    title: `Chat ${id}`,
    titleRanges: [],
    createdAt: 1,
    updatedAt: 1_000,
    archived: false,
    hitCount: 1,
    hits: [{ blockId: `${id}-b1`, role: "user", snippet: "a needle here", ranges: [[2, 8]] }],
    ...overrides,
  };
}

const grouping: ProjectGrouping = {
  groups: [
    { id: "g1", name: "Clients", collapsed: false },
    { id: "g2", name: "Other", collapsed: false },
  ],
  assignments: { "/work/a": "g1", "/work/b": "g1", "/work/z": "g2" },
};

describe("scopeCwds", () => {
  const recents = ["/work/a", "/work/b", "/work/z", "/work/free"].map((path) => ({
    path,
    openedAt: 0,
  }));

  it("searches everywhere, this project, or this project's rail group", () => {
    expect(scopeCwds("everywhere", "/work/a", recents, grouping)).toBeUndefined();
    expect(scopeCwds("project", "/work/a", recents, grouping)).toEqual(["/work/a"]);
    expect(scopeCwds("group", "/work/a", recents, grouping)).toEqual(["/work/a", "/work/b"]);
  });

  it("falls back to the project when it is not in a group", () => {
    expect(scopeCwds("group", "/work/free", recents, grouping)).toEqual(["/work/free"]);
  });
});

describe("sinceFor", () => {
  it("turns a range into a lower bound", () => {
    expect(sinceFor("any", 10_000_000_000)).toBeUndefined();
    expect(sinceFor("week", 10_000_000_000)).toBe(10_000_000_000 - 7 * 86_400_000);
  });
});

describe("groupChatSessions", () => {
  it("groups by project in result order and names the rail group", () => {
    const groups = groupChatSessions(
      [session("s1", "/work/a"), session("s2", "/work/free"), session("s3", "/work/a")],
      grouping,
    );
    expect(groups.map((group) => [group.name, group.groupName])).toEqual([
      ["a", "Clients"],
      ["free", undefined],
    ]);
    expect(groups[0].sessions.map((row) => row.sessionId)).toEqual(["s1", "s3"]);
  });

  it("lists at most three hits and keeps the total count", () => {
    const hits = Array.from({ length: 5 }, (_, index) => ({
      blockId: `b${index}`,
      role: "assistant",
      snippet: "x",
      ranges: [] as [number, number][],
    }));
    const [group] = groupChatSessions([session("s1", "/work/a", { hitCount: 9, hits })], grouping);
    expect(group.sessions[0].hitCount).toBe(9);
    expect(group.sessions[0].hits).toHaveLength(3);
  });

  it("drops title highlights when the shown title differs from the stored one", () => {
    const [group] = groupChatSessions(
      [session("s1", "/work/a", { title: "Claude Code", titleRanges: [[0, 6]] })],
      grouping,
    );
    expect(group.sessions[0].title).toBe("New session");
    expect(group.sessions[0].titleRanges).toEqual([]);
  });
});

describe("chatEntries", () => {
  it("steps through each session and then its hits, opening the first hit", () => {
    const groups = groupChatSessions(
      [
        session("s1", "/work/a", {
          hits: [
            { blockId: "x", role: "user", snippet: "", ranges: [] },
            { blockId: "y", role: "user", snippet: "", ranges: [] },
          ],
        }),
        session("s2", "/work/a", { hitCount: 0, hits: [], titleRanges: [[0, 4]] }),
      ],
      grouping,
    );
    expect(chatEntries(groups).map((entry) => [entry.id, entry.blockId])).toEqual([
      ["session:s1", "x"],
      ["hit:s1:x", "x"],
      ["hit:s1:y", "y"],
      ["session:s2", undefined],
    ]);
  });
});

describe("highlightRuns", () => {
  it("splits text around UTF-16 ranges", () => {
    expect(highlightRuns("a needle here", [[2, 8]])).toEqual([
      { text: "a ", match: false },
      { text: "needle", match: true },
      { text: " here", match: false },
    ]);
  });

  it("ignores ranges that do not fit the text", () => {
    expect(
      highlightRuns("abc", [
        [2, 9],
        [1, 1],
      ]),
    ).toEqual([{ text: "abc", match: false }]);
  });
});

describe("hitsFromContentSessions", () => {
  it("makes a conversation row for title matches and message rows for hits", () => {
    const hits = hitsFromContentSessions([session("s1", "/work/a", { titleRanges: [[0, 4]] })]);
    expect(hits.map((hit) => hit.id)).toEqual(["conversation:s1", "message:s1:s1-b1"]);
  });
});
