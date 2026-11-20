// @vitest-environment happy-dom
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGitlabCache,
  gitlabMrDiff,
  gitlabWorkItemComment,
  gitlabWorkItemDetails,
  gitlabWorkItemThread,
  peekGitlabMrDiff,
  peekGitlabWorkItemDetails,
  peekGitlabWorkItemThread,
} from "./gitlab";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  clearGitlabCache();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (_command, args) => ({ args }) as never);
});

describe("gitlab detail and diff caches", () => {
  it("caps work item details at 128 entries and refreshes on read", async () => {
    for (let i = 0; i < 128; i++) await gitlabWorkItemDetails("org/repo", "issue", i);
    expect(peekGitlabWorkItemDetails("org/repo", "issue", 0)).not.toBeNull();
    await gitlabWorkItemDetails("org/repo", "issue", 128);

    expect(peekGitlabWorkItemDetails("org/repo", "issue", 0)).not.toBeNull();
    expect(peekGitlabWorkItemDetails("org/repo", "issue", 1)).toBeNull();
    expect(peekGitlabWorkItemDetails("org/repo", "issue", 128)).not.toBeNull();
  });

  it("caps merge request diffs at 128 entries and refreshes on read", async () => {
    for (let n = 1; n <= 128; n++) await gitlabMrDiff("org/repo", n);
    expect(peekGitlabMrDiff("org/repo", 1)).not.toBeNull();
    await gitlabMrDiff("org/repo", 129);

    expect(peekGitlabMrDiff("org/repo", 1)).not.toBeNull();
    expect(peekGitlabMrDiff("org/repo", 2)).toBeNull();
    expect(peekGitlabMrDiff("org/repo", 129)).not.toBeNull();
  });

  it("caps work item threads at 128 entries and refreshes on read", async () => {
    for (let i = 0; i < 128; i++) await gitlabWorkItemThread("org/repo", "issue", i);
    expect(peekGitlabWorkItemThread("org/repo", "issue", 0)).not.toBeNull();
    await gitlabWorkItemThread("org/repo", "issue", 128);

    expect(peekGitlabWorkItemThread("org/repo", "issue", 0)).not.toBeNull();
    expect(peekGitlabWorkItemThread("org/repo", "issue", 1)).toBeNull();
    expect(peekGitlabWorkItemThread("org/repo", "issue", 128)).not.toBeNull();
  });
});

/** Holds each call of one command until the test settles it, so completions can arrive out of order. */
function holdCommand(command: string) {
  const held: ((value: unknown) => void)[] = [];
  vi.mocked(invoke).mockImplementation(((name: string, args: unknown) => {
    if (name !== command) return Promise.resolve({ args });
    return new Promise((resolve) => held.push(resolve));
  }) as never);
  return held;
}

describe("gitlab stale completions", () => {
  it("keeps the forced refresh result when the older thread request resolves last", async () => {
    const held = holdCommand("gitlab_work_item_thread");
    const stale = gitlabWorkItemThread("org/repo", "issue", 1);
    const fresh = gitlabWorkItemThread("org/repo", "issue", 1, { force: true });
    expect(held).toHaveLength(2);
    held[1]({ comments: ["fresh"] });
    await fresh;
    held[0]({ comments: ["stale"] });
    await stale;

    expect(peekGitlabWorkItemThread("org/repo", "issue", 1)).toEqual({ comments: ["fresh"] });
  });

  it("does not cache a thread that was in flight when a comment was posted", async () => {
    const held = holdCommand("gitlab_work_item_thread");
    const stale = gitlabWorkItemThread("org/repo", "issue", 2);
    await gitlabWorkItemComment("org/repo", "issue", 2, "hello");
    held[0]({ comments: ["before comment"] });
    await stale;

    expect(peekGitlabWorkItemThread("org/repo", "issue", 2)).toBeNull();
  });

  it("does not repopulate threads, details or diffs after a cache clear", async () => {
    const heldThread = holdCommand("gitlab_work_item_thread");
    const thread = gitlabWorkItemThread("org/repo", "issue", 3);
    clearGitlabCache();
    heldThread[0]({ comments: ["old account"] });
    await thread;
    expect(peekGitlabWorkItemThread("org/repo", "issue", 3)).toBeNull();

    const heldDetails = holdCommand("gitlab_work_item_details");
    const details = gitlabWorkItemDetails("org/repo", "issue", 3);
    clearGitlabCache();
    heldDetails[0]({ body: "old account" });
    await details;
    expect(peekGitlabWorkItemDetails("org/repo", "issue", 3)).toBeNull();

    const heldDiff = holdCommand("gitlab_mr_diff");
    const diff = gitlabMrDiff("org/repo", 3);
    clearGitlabCache();
    heldDiff[0]({ patch: "old account" });
    await diff;
    expect(peekGitlabMrDiff("org/repo", 3)).toBeNull();
  });
});
