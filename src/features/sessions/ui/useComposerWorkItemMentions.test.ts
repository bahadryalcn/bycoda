// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxItem, InboxProvider } from "../../inbox/public/workItemMentions";

const mocks = vi.hoisted(() => ({
  connectedWorkItemProviders: vi.fn(),
  workItemMentionCandidates: vi.fn(),
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
  mocks.workItemMentionCandidates.mockResolvedValue([item(90)]);
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
    expect(mocks.workItemMentionCandidates).not.toHaveBeenCalled();
    expect(result.rows.every((row) => row.workItem.kind === "hint")).toBe(true);
  });
  it("shows cache immediately, debounces rest text, and merges returned rows", async () => {
    await render("jira:9");
    expect(result.rows.map((row) => row.name)).toEqual(["PROJ-9 Login bug"]);
    await advance(224);
    expect(mocks.workItemMentionCandidates).not.toHaveBeenCalled();
    await render("jr:90");
    await advance();
    expect(mocks.workItemMentionCandidates).toHaveBeenCalledExactlyOnceWith(
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
    mocks.workItemMentionCandidates.mockImplementationOnce(
      () =>
        new Promise<InboxItem[]>((resolve) => {
          finish = resolve;
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
    mocks.workItemMentionCandidates.mockImplementationOnce(
      () =>
        new Promise<InboxItem[]>((resolve) => {
          finish = resolve;
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
    mocks.workItemMentionCandidates.mockRejectedValue(new Error("offline"));
    await render("jira:9");
    await advance();
    expect(result.rows).toHaveLength(1);
    await render("jira:90", "/repo", false);
    await advance(1000);
    expect(mocks.workItemMentionCandidates).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending debounce when the menu closes", async () => {
    await render("jira:9");
    await render("jira:9", "/repo", false);
    await advance(1000);
    expect(mocks.workItemMentionCandidates).not.toHaveBeenCalled();
  });

  it("retains searched rows when the same menu reopens", async () => {
    await render("jira:90");
    await advance();
    await render("jira:90", "/repo", false);
    await render("jira:90");
    expect(result.rows[0].name).toBe("PROJ-90 Login bug");
    expect(mocks.workItemMentionCandidates).toHaveBeenCalledTimes(1);
  });
});
