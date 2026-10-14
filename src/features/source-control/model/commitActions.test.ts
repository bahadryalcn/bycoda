import { describe, expect, it } from "vitest";
import type { GitHistoryCommit } from "../../../platform/tauri/fs";
import { commitMenuItems, filterHistory, operationLabel, githubCommitUrl } from "./commitActions";

function commit(partial: Partial<GitHistoryCommit>): GitHistoryCommit {
  return {
    sha: "a".repeat(40),
    shortSha: "aaaaaaa",
    parents: [],
    author: "Ada",
    timestamp: 0,
    subject: "Initial commit",
    refs: [],
    head: false,
    ...partial,
  };
}

function disabledIds(target: GitHistoryCommit): string[] {
  return commitMenuItems(target).flatMap((item) =>
    item.kind === "item" && item.disabled ? [item.id] : [],
  );
}

describe("commitMenuItems", () => {
  it("offers every action on an ordinary commit", () => {
    expect(disabledIds(commit({}))).toEqual([]);
    expect(
      commitMenuItems(commit({})).flatMap((item) => (item.kind === "item" ? [item.id] : [])),
    ).toEqual([
      "open-changes",
      "blame",
      "github",
      "checkout",
      "branch",
      "tag",
      "cherry-pick",
      "revert",
      "reset",
      "copy-sha",
      "copy-message",
    ]);
  });

  it("okuma aksiyonları işlem sürerken kullanılabilir", () => {
    const items = commitMenuItems(commit({}), true);
    expect(
      items.flatMap((item) => (item.kind === "item" && !item.disabled ? [item.id] : [])),
    ).toEqual(["open-changes", "blame", "github", "copy-sha", "copy-message"]);
  });

  it("disables actions that make no sense on HEAD", () => {
    expect(disabledIds(commit({ head: true }))).toEqual(["cherry-pick", "reset"]);
  });

  it("marks only the hard reset as dangerous", () => {
    const reset = commitMenuItems(commit({})).find(
      (item) => item.kind === "item" && item.id === "reset",
    );
    const submenu = reset?.kind === "item" ? (reset.submenu ?? []) : [];
    expect(submenu.map((item) => [item.id, item.danger === true])).toEqual([
      ["reset-soft", false],
      ["reset-mixed", false],
      ["reset-hard", true],
    ]);
  });
});

describe("GitHub commit bağlantısı", () => {
  const sha = "a".repeat(40);
  it.each([
    "git@github.com:team/app.git",
    "https://github.com/team/app.git",
    "ssh://git@github.com/team/app.git",
    "https://github.com/team/app/",
  ])("%s uzak adresini çözer", (url) => {
    expect(githubCommitUrl([{ name: "origin", url }], sha)).toBe(
      `https://github.com/team/app/commit/${sha}`,
    );
  });
  it("origin tercih eder ve sahte alan adlarını reddeder", () => {
    expect(
      githubCommitUrl(
        [
          { name: "fork", url: "git@github.com:other/fork.git" },
          { name: "origin", url: "git@github.com:team/app.git" },
        ],
        sha,
      ),
    ).toContain("/team/app/");
    for (const url of [
      "https://github.com.evil.test/team/app",
      "https://gitlab.com/team/app",
      "file:///team/app",
      "javascript:alert(1)",
      "git@github.com:../app",
    ])
      expect(githubCommitUrl([{ name: "origin", url }], sha)).toBeNull();
    expect(
      githubCommitUrl([{ name: "origin", url: "https://github.com/team/app" }], "--help"),
    ).toBeNull();
  });
});

describe("filterHistory", () => {
  const commits = [
    commit({
      sha: "abc123".padEnd(40, "0"),
      subject: "Fix login",
      author: "Ada",
    }),
    commit({
      sha: "def456".padEnd(40, "0"),
      subject: "Add graph",
      author: "Grace",
    }),
    commit({
      sha: "999999".padEnd(40, "0"),
      subject: "Release",
      author: "Linus",
      refs: [{ name: "v1.2.0", kind: "tag" }],
    }),
  ];

  it("returns everything for a blank query", () => {
    expect(filterHistory(commits, "  ")).toBe(commits);
  });

  it("matches subject, author, id prefix and ref name without case", () => {
    expect(filterHistory(commits, "LOGIN").map((c) => c.subject)).toEqual(["Fix login"]);
    expect(filterHistory(commits, "grace").map((c) => c.subject)).toEqual(["Add graph"]);
    expect(filterHistory(commits, "DEF4").map((c) => c.subject)).toEqual(["Add graph"]);
    expect(filterHistory(commits, "v1.2").map((c) => c.subject)).toEqual(["Release"]);
    expect(filterHistory(commits, "nope")).toEqual([]);
  });
});

describe("operationLabel", () => {
  it("names each operation", () => {
    expect(operationLabel("cherry-pick")).toBe("Cherry-pick");
    expect(operationLabel("rebase")).toBe("Rebase");
  });
});
