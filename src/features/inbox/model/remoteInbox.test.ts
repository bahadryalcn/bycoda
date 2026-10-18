import { describe, expect, it } from "vitest";
import {
  inboxReplyTarget,
  inboxOperationWrites,
  nativeInboxCommand,
  parseRemoteInboxOperation,
  safeInboxError,
} from "./remoteInbox";

const projects = [
  { id: "project-1", cwd: "/project" },
  { id: "project-2", cwd: "/other" },
];
const item = {
  provider: "github",
  kind: "issue",
  number: 7,
  repo: "owner/repo",
  projectPath: "/project",
};
describe("pure remote provider inbox contract", () => {
  it.each(["merge", "squash", "rebase"])("binds %s to the exact reviewed SHA", (prAction) => {
    const input = { action: "pr-action", item: { ...item, kind: "pr" }, prAction };
    expect(() => parseRemoteInboxOperation(input, projects)).toThrow(/head|expectedHeadOid/);
    const reviewed = "a".repeat(40);
    const operation = parseRemoteInboxOperation({ ...input, expectedHeadOid: reviewed }, projects);
    if (operation.action !== "pr-action") throw new Error("Wrong fixture");
    expect(nativeInboxCommand(operation).args.expectedHeadOid).toBe(reviewed);
    expect(nativeInboxCommand(operation).args.expectedHeadOid).not.toBe("b".repeat(40));
    expect(() =>
      parseRemoteInboxOperation({ ...input, expectedHeadOid: "main" }, projects),
    ).toThrow();
  });
  const review = {
    action: "review",
    item: { ...item, kind: "pr" },
    commitId: "a".repeat(40),
    event: "REQUEST_CHANGES",
    body: "Şu noktaya bakalım.",
    comments: [
      { path: "src/auth.ts", line: 8, startLine: 6, side: "RIGHT", body: "Yetki kontrolü eksik." },
    ],
  };
  it("keeps inline review text and locations intact and routes it as one native write", () => {
    const operation = parseRemoteInboxOperation(review, projects);
    expect(inboxOperationWrites(operation)).toBe(true);
    const { action: _action, item: _item, ...payload } = review;
    expect(nativeInboxCommand(operation)).toEqual({
      command: "git_github_pr_review",
      args: {
        cwd: "/project",
        repo: "owner/repo",
        number: 7,
        review: payload,
      },
    });
    const context = parseRemoteInboxOperation(
      { action: "review-context", item: review.item },
      projects,
    );
    expect(inboxOperationWrites(context)).toBe(false);
    expect(nativeInboxCommand(context)).toEqual({
      command: "git_github_pr_review_context",
      args: { cwd: "/project", repo: "owner/repo", number: 7 },
    });
  });
  it("rejects unsupported targets, invalid commits, paths, ranges and oversized review payloads", () => {
    for (const patch of [
      { item },
      { item: { ...review.item, provider: "gitlab" } },
      { commitId: "HEAD" },
      { event: "PENDING" },
      { body: " " },
      { comments: Array(51).fill(review.comments[0]) },
      {
        body: "a".repeat(30000),
        comments: [{ ...review.comments[0], body: "a".repeat(30000) }, review.comments[0]],
      },
    ])
      expect(() => parseRemoteInboxOperation({ ...review, ...patch }, projects)).toThrow();
    for (const patch of [
      { path: "../secret" },
      { path: "/src/a.ts" },
      { path: "C:\\secret" },
      { line: 0 },
      { line: 1.5 },
      { side: "BOTH" },
      { startLine: 8 },
      { body: " " },
    ])
      expect(() =>
        parseRemoteInboxOperation(
          { ...review, comments: [{ ...review.comments[0], ...patch }] },
          projects,
        ),
      ).toThrow();
  });
  it("uses registered host paths and refuses another project rather than silently redirecting", () => {
    const operation = parseRemoteInboxOperation(
      { action: "details", item, projectId: "project-1", cwd: "/attacker" },
      projects,
    );
    expect(operation).toMatchObject({ cwd: "/project" });
    expect(() =>
      parseRemoteInboxOperation({ action: "details", item, projectId: "project-2" }, projects),
    ).toThrow("another project");
    expect(() =>
      parseRemoteInboxOperation(
        { action: "details", item: { ...item, projectPath: "/Project" } },
        projects,
      ),
    ).toThrow("another project");
  });
  it("only accepts finite inbox operations and matching provider item kinds", () => {
    for (const action of ["shell", "jira_set_config", "gitlab_set_config", "invoke"])
      expect(() => parseRemoteInboxOperation({ action }, projects)).toThrow("Unsupported");
    expect(() =>
      parseRemoteInboxOperation(
        { action: "details", item: { ...item, provider: "linear", id: "id-1" } },
        projects,
      ),
    ).toThrow("kind");
  });
  it("maps threaded comments only for providers with existing native support", () => {
    const operation = parseRemoteInboxOperation(
      {
        action: "comment",
        item: { ...item, kind: "pr" },
        body: "Reply",
        inReplyTo: "review-thread-1",
      },
      projects,
    );
    if (operation.action !== "comment") throw new Error("Wrong fixture");
    expect(nativeInboxCommand(operation)).toEqual({
      command: "git_github_work_item_comment",
      args: {
        cwd: "/project",
        repo: "owner/repo",
        kind: "pr",
        number: 7,
        body: "Reply",
        inReplyTo: "review-thread-1",
      },
    });
    expect(() =>
      parseRemoteInboxOperation(
        { action: "comment", item, body: "Reply", inReplyTo: "comment-1" },
        projects,
      ),
    ).toThrow("review thread");
    expect(() =>
      parseRemoteInboxOperation(
        {
          action: "comment",
          item: { ...item, provider: "gitlab" },
          body: "Reply",
          inReplyTo: "comment-1",
        },
        projects,
      ),
    ).toThrow("without threaded replies");
  });
  it("uses GitHub review thread IDs and Linear comment IDs, hiding unsupported reply targets", () => {
    const comment = { id: "comment-1", threadId: "review-thread-1" };
    expect(inboxReplyTarget("github", comment)).toBe("review-thread-1");
    expect(inboxReplyTarget("linear", comment)).toBe("comment-1");
    expect(inboxReplyTarget("github", { id: "issue-comment", threadId: "" })).toBeUndefined();
    expect(inboxReplyTarget("gitlab", comment)).toBeUndefined();
  });
  it("limits state operations to existing GitHub pull-request actions", () => {
    expect(() =>
      parseRemoteInboxOperation({ action: "pr-action", item, prAction: "close" }, projects),
    ).toThrow("Only GitHub");
    const operation = parseRemoteInboxOperation(
      { action: "pr-action", item: { ...item, kind: "pr" }, prAction: "ready" },
      projects,
    );
    if (operation.action !== "pr-action") throw new Error("Wrong fixture");
    expect(nativeInboxCommand(operation).command).toBe("git_github_pr_action");
    expect(() =>
      parseRemoteInboxOperation(
        { action: "pr-action", item: { ...item, kind: "pr" }, prAction: "delete" },
        projects,
      ),
    ).toThrow("Unsupported");
  });
  it("redacts bearer, key-value, query and userinfo credentials in provider errors", () => {
    expect(
      safeInboxError(
        "Bearer secret-token token=secret-token https://host?access_token=secret-token https://user:secret-token@host",
      ),
    ).not.toContain("secret-token");
  });
});
