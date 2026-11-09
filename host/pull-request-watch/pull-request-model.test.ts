import { describe, expect, it } from "vitest";
import {
  diffPullRequest,
  mergeWakeReasons,
  parsePullRequestUrl,
  parsePullRequestView,
  pullRequestWakeText,
  summarizeChecks,
  type PullRequestSnapshot,
} from "./pull-request-model";

const base = (overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot => ({
  state: "OPEN",
  reviewDecision: "",
  checks: { overall: "pending", pending: 1, success: 0, failure: 0, failing: [] },
  headRefOid: "abc1234def",
  reviewCount: 0,
  commentCount: 0,
  mergeable: "MERGEABLE",
  ...overrides,
});
const failing = (names: string[]) => ({
  overall: "failing" as const,
  pending: 0,
  success: 1,
  failure: names.length,
  failing: names,
});
const passing = { overall: "passing" as const, pending: 0, success: 2, failure: 0, failing: [] };

describe("pull request URL parsing", () => {
  it("accepts a github.com pull request link and returns its canonical form", () => {
    expect(parsePullRequestUrl("https://github.com/acme/app/pull/12/files?x=1")).toEqual({
      url: "https://github.com/acme/app/pull/12",
      number: 12,
    });
  });

  it("rejects other hosts, other paths and zero numbers", () => {
    expect(parsePullRequestUrl("http://github.com/acme/app/pull/12")).toBeUndefined();
    expect(parsePullRequestUrl("https://example.com/acme/app/pull/12")).toBeUndefined();
    expect(parsePullRequestUrl("https://github.com/acme/app/issues/12")).toBeUndefined();
    expect(parsePullRequestUrl("https://github.com/acme/app/pull/0")).toBeUndefined();
  });
});

describe("check summary", () => {
  it("counts status contexts and check runs and names the failing ones", () => {
    const summary = summarizeChecks([
      { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "FAILURE" },
      { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SKIPPED" },
      { __typename: "CheckRun", name: "lint", status: "IN_PROGRESS", conclusion: "" },
      { __typename: "StatusContext", context: "ci/deploy", state: "ERROR" },
      { __typename: "StatusContext", context: "ci/preview", state: "PENDING" },
    ]);
    expect(summary).toEqual({
      overall: "failing",
      pending: 2,
      success: 1,
      failure: 2,
      failing: ["build", "ci/deploy"],
    });
  });

  it("is none without checks and passing when every check succeeded", () => {
    expect(summarizeChecks(null).overall).toBe("none");
    expect(
      summarizeChecks([
        { __typename: "CheckRun", name: "a", status: "COMPLETED", conclusion: "SUCCESS" },
      ]).overall,
    ).toBe("passing");
  });
});

describe("gh response parsing", () => {
  const raw = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      url: "https://github.com/acme/app/pull/12",
      state: "OPEN",
      reviewDecision: null,
      statusCheckRollup: [],
      mergeable: "MERGEABLE",
      headRefOid: "abc1234def",
      reviews: [{ state: "COMMENTED" }],
      comments: [],
      ...overrides,
    });

  it("builds the compact snapshot from a pull request", () => {
    const view = parsePullRequestView(raw());
    expect(view.url).toBe("https://github.com/acme/app/pull/12");
    expect(view.snapshot).toEqual({
      state: "OPEN",
      reviewDecision: "",
      checks: { overall: "none", pending: 0, success: 0, failure: 0, failing: [] },
      headRefOid: "abc1234def",
      reviewCount: 1,
      commentCount: 0,
      mergeable: "MERGEABLE",
    });
  });

  it("rejects a response that is not a github pull request", () => {
    expect(() => parsePullRequestView("[]")).toThrow("not an object");
    expect(() => parsePullRequestView(raw({ url: "https://example.com/x" }))).toThrow("URL");
    expect(() => parsePullRequestView(raw({ state: "" }))).toThrow("no state");
  });
});

describe("diffPullRequest", () => {
  it("never wakes on the first observation", () => {
    expect(diffPullRequest(undefined, base({ checks: passing }))).toEqual([]);
  });

  it("produces no reason when nothing meaningful changed", () => {
    expect(diffPullRequest(base(), base())).toEqual([]);
  });

  it("wakes when pending checks finish passing or failing", () => {
    expect(diffPullRequest(base(), base({ checks: passing }))).toEqual([
      { kind: "checks", overall: "passing" },
    ]);
    expect(diffPullRequest(base(), base({ checks: failing(["build"]) }))).toEqual([
      { kind: "checks", overall: "failing" },
    ]);
  });

  it("wakes on failing to passing and passing to failing", () => {
    expect(diffPullRequest(base({ checks: failing(["a"]) }), base({ checks: passing }))).toEqual([
      { kind: "checks", overall: "passing" },
    ]);
    expect(diffPullRequest(base({ checks: passing }), base({ checks: failing(["a"]) }))).toEqual([
      { kind: "checks", overall: "failing" },
    ]);
  });

  it("does not wake when checks merely start re-running", () => {
    expect(diffPullRequest(base({ checks: passing }), base({ checks: base().checks }))).toEqual([]);
  });
  it("wakes when checks register and finish between two polls", () => {
    expect(
      diffPullRequest(
        base({ checks: { ...base().checks, overall: "none" } }),
        base({ checks: passing }),
      ),
    ).toEqual([{ kind: "checks", overall: "passing" }]);
  });

  it("wakes when the review decision changes", () => {
    expect(diffPullRequest(base(), base({ reviewDecision: "CHANGES_REQUESTED" }))).toEqual([
      { kind: "review", decision: "CHANGES_REQUESTED" },
    ]);
  });

  it("wakes on new reviews and new comments, not on fewer", () => {
    expect(diffPullRequest(base(), base({ reviewCount: 2, commentCount: 1 }))).toEqual([
      { kind: "reviews", count: 2 },
      { kind: "comments", count: 1 },
    ]);
    expect(diffPullRequest(base({ reviewCount: 3 }), base({ reviewCount: 2 }))).toEqual([]);
  });

  it("wakes on a new head only once its checks have a result", () => {
    const pushed = base({ headRefOid: "def5678" });
    expect(diffPullRequest(base(), pushed)).toEqual([]);
    expect(
      diffPullRequest(base({ checks: passing }), base({ ...pushed, checks: passing })),
    ).toEqual([{ kind: "head", sha: "def5678" }]);
  });

  it("wakes when the PR is merged or closed, not when it is reopened", () => {
    expect(diffPullRequest(base(), base({ state: "MERGED" }))).toEqual([
      { kind: "state", state: "MERGED" },
    ]);
    expect(diffPullRequest(base(), base({ state: "CLOSED" }))).toEqual([
      { kind: "state", state: "CLOSED" },
    ]);
    expect(diffPullRequest(base({ state: "CLOSED" }), base({ state: "OPEN" }))).toEqual([]);
  });
});

describe("pending reasons and wake text", () => {
  it("merges counts per kind and keeps the latest result for the others", () => {
    expect(
      mergeWakeReasons(
        [
          { kind: "reviews", count: 1 },
          { kind: "checks", overall: "failing" },
        ],
        [
          { kind: "reviews", count: 2 },
          { kind: "checks", overall: "passing" },
        ],
      ),
    ).toEqual([
      { kind: "reviews", count: 3 },
      { kind: "checks", overall: "passing" },
    ]);
  });

  it("describes a failing check run with its names, review and new review", () => {
    const text = pullRequestWakeText({
      number: 12,
      url: "https://github.com/acme/app/pull/12",
      snapshot: base({
        checks: failing(["build", "lint"]),
        reviewDecision: "CHANGES_REQUESTED",
      }),
      reasons: [
        { kind: "checks", overall: "failing" },
        { kind: "review", decision: "CHANGES_REQUESTED" },
        { kind: "reviews", count: 1 },
      ],
    });
    expect(text).toBe(
      "PR #12 (https://github.com/acme/app/pull/12): checks failing (2 failed: build, lint). Review: CHANGES_REQUESTED. 1 new review.\nYou are watching this PR; call pullRequests.unwatch when done.",
    );
  });

  it("ends the watch in its final line for a merged PR", () => {
    const text = pullRequestWakeText({
      number: 7,
      url: "https://github.com/acme/app/pull/7",
      snapshot: base({ state: "MERGED" }),
      reasons: [{ kind: "state", state: "MERGED" }],
    });
    expect(text).toContain("The PR was merged.");
    expect(text.endsWith("This PR is no longer open, so its watch has ended.")).toBe(true);
  });
});
