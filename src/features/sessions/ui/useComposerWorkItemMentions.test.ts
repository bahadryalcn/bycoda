// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxItem, InboxProvider } from "../../inbox/public/workItemMentions";

const mocks = vi.hoisted(() => ({
  connectedWorkItemProviders: vi.fn(),
  searchWorkItemMentionCandidates: vi.fn(),
  peekWorkItemMentionCandidates: vi.fn(),
}));
vi.mock("../../inbox/public/workItemMentions", async (original) => ({
  ...(await original<object>()),
  ...mocks,
}));
import { useComposerWorkItemMentions } from "./useComposerWorkItemMentions";

const item = (number: number, provider: InboxProvider = "jira"): InboxItem => ({
  provider,
  kind: "jira",
  identifier: `PROJ-${number}`,
  number,
  repo: "PROJ",
  title: "Login bug",
  state: "Open",
  projectPath: "/repo",
  url: "",
  updatedAt: "",
  labels: [],
  assignees: [],
  draft: false,
});
let root: Root;
let host: HTMLDivElement;
let result: ReturnType<typeof useComposerWorkItemMentions>;
function Probe(props: { active: boolean; cwd: string; query: string }) {
  result = useComposerWorkItemMentions(props);
  return null;
}
async function render(query: string, cwd = "/repo", active = true) {
  await act(async () => {
    root.render(createElement(Probe, { query, cwd, active }));
  });
}
async function advance(ms = 225) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.connectedWorkItemProviders.mockResolvedValue(["jira", "github"]);
  mocks.peekWorkItemMentionCandidates.mockReturnValue([item(9)]);
  mocks.searchWorkItemMentionCandidates.mockResolvedValue({ items: [item(90)] });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("composer tracker search", () => {
  it("keeps an empty unscoped menu to alias hints without item reads", async () => {
    await render("");
    await advance(1000);
    expect(mocks.searchWorkItemMentionCandidates).not.toHaveBeenCalled();
    expect(result.rows.every((row) => row.workItem.kind === "hint")).toBe(true);
  });
  it("shows cache immediately, debounces rest text, and merges returned rows", async () => {
    await render("jira:9");
    expect(result.rows.map((row) => row.name)).toEqual(["PROJ-9 Login bug"]);
    await advance(224);
    expect(mocks.searchWorkItemMentionCandidates).not.toHaveBeenCalled();
    await render("jr:90");
    await advance();
    expect(mocks.searchWorkItemMentionCandidates).toHaveBeenCalledExactlyOnceWith(
      "/repo",
      "jira",
      "90",
      ["jira", "github"],
      expect.any(AbortSignal),
    );
    expect(result.rows[0].name).toBe("PROJ-90 Login bug");
    await render("jira:9");
    expect(result.rows).toHaveLength(2);
  });

  it("rejects an older query reply even when it completes last", async () => {
    let finish!: (items: InboxItem[]) => void;
    mocks.searchWorkItemMentionCandidates.mockImplementationOnce(
      () =>
        new Promise<{ items: InboxItem[] }>((resolve) => {
          finish = (items) => resolve({ items });
        }),
    );
    await render("jira:9");
    await advance();
    await render("jira:90");
    await advance();
    await act(async () => {
      finish([item(900)]);
    });
    expect(result.rows.map((row) => row.name)).toEqual(["PROJ-90 Login bug"]);
  });

  it.each(["cwd", "provider", "closed"])("rejects a reply after %s changes", async (change) => {
    let finish!: (items: InboxItem[]) => void;
    mocks.searchWorkItemMentionCandidates.mockImplementationOnce(
      () =>
        new Promise<{ items: InboxItem[] }>((resolve) => {
          finish = (items) => resolve({ items });
        }),
    );
    await render("jira:9");
    await advance();
    mocks.peekWorkItemMentionCandidates.mockReturnValue([]);
    await render(
      change === "provider" ? "gh:9" : "jira:9",
      change === "cwd" ? "/other" : "/repo",
      change !== "closed",
    );
    await act(async () => {
      finish([item(99)]);
    });
    expect(result.rows).toEqual([]);
  });

  it("keeps cached rows after failure and makes no requests while closed", async () => {
    mocks.searchWorkItemMentionCandidates.mockRejectedValue(new Error("offline"));
    await render("jira:9");
    await advance();
    expect(result.rows).toHaveLength(1);
    await render("jira:90", "/repo", false);
    await advance(1000);
    expect(mocks.searchWorkItemMentionCandidates).toHaveBeenCalledTimes(1);
  });

  it("exposes the typed search failure only for the query that failed", async () => {
    const failure = { failure: "unauthenticated", provider: "github" };
    mocks.searchWorkItemMentionCandidates.mockResolvedValueOnce({
      items: [],
      failure,
      machine: "Box",
    });
    await render("gh:77");
    expect(result.failure).toBeUndefined();
    await advance();
    expect(result.failure).toEqual({ error: failure, machine: "Box", search: "77" });
    await render("gh:78");
    expect(result.failure).toBeUndefined();
    await advance();
    expect(result.failure).toBeUndefined();
  });

  it("cancels a pending debounce when the menu closes", async () => {
    await render("jira:9");
    await render("jira:9", "/repo", false);
    await advance(1000);
    expect(mocks.searchWorkItemMentionCandidates).not.toHaveBeenCalled();
  });

  it("retains searched rows when the same menu reopens", async () => {
    await render("jira:90");
    await advance();
    await render("jira:90", "/repo", false);
    await render("jira:90");
    expect(result.rows[0].name).toBe("PROJ-90 Login bug");
    expect(mocks.searchWorkItemMentionCandidates).toHaveBeenCalledTimes(1);
  });
});
