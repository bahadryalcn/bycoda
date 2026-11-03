import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearInboxCache,
  inboxReadReachedLimit,
  listInboxItems,
  peekInboxList,
} from "./githubTasks";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const query = { assignedToMe: false, state: "open", search: "", githubKinds: ["issue"] } as const;
const projects = [{ path: "/tmp/repo" }];

function githubRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    kind: "issue",
    number: index + 1,
    title: `Issue ${index + 1}`,
    url: `https://example.com/o/r/issues/${index + 1}`,
    state: "open",
    updatedAt: "2026-09-16T08:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
    repo: "o/r",
  }));
}

describe("inbox list completeness", () => {
  let rows = 0;

  beforeEach(() => {
    clearInboxCache();
    rows = 0;
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "git_github_repositories") return ["o/r"];
      if (command === "git_github_work_items") return githubRows(rows);
      if (command === "jira_status") return { connected: false };
      if (command.endsWith("_status")) return { connected: false };
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it("names the native page size per state", () => {
    expect(inboxReadReachedLimit(39, { state: "open" })).toBe(false);
    expect(inboxReadReachedLimit(40, { state: "open" })).toBe(true);
    expect(inboxReadReachedLimit(99, { state: "all" })).toBe(false);
    expect(inboxReadReachedLimit(100, { state: "all" })).toBe(true);
  });

  it("flags GitHub as limited only when a read came back full", async () => {
    rows = 40;
    const full = await listInboxItems(projects, query);
    expect(full.limited).toEqual(["github"]);
    expect(peekInboxList(projects, query)?.limited).toEqual(["github"]);

    clearInboxCache();
    rows = 3;
    const short = await listInboxItems(projects, query);
    expect(short.limited).toBeUndefined();
  });
});
