import { expect, it } from "vitest";
import { parseInboxApprovalDetails } from "./inboxApprovalDetails";

const review = {
  kind: "inbox",
  action: "review",
  project: "/repo",
  provider: "github",
  target: "acme/app #12",
  replyTo: null,
  thread: null,
  review: {
    event: "COMMENT",
    commitId: "a".repeat(40),
    body: "Looks good.",
    comments: [
      { path: "src/a.ts", line: 9, startLine: null, side: "RIGHT", body: "Nit" },
      { path: "src/b.ts", line: 7, startLine: 3, side: "LEFT", body: "Why?" },
    ],
  },
};

it("keeps the review verdict, summary and every line comment", () => {
  expect(parseInboxApprovalDetails(review)).toEqual({
    action: "review",
    project: "/repo",
    provider: "github",
    target: "acme/app #12",
    review: {
      event: "COMMENT",
      commitId: "a".repeat(40),
      body: "Looks good.",
      comments: [
        { path: "src/a.ts", line: 9, side: "RIGHT", body: "Nit" },
        { path: "src/b.ts", line: 7, startLine: 3, side: "LEFT", body: "Why?" },
      ],
    },
  });
});

it("drops the whole preview when any part is malformed, so the plain message is shown", () => {
  const broken = structuredClone(review);
  broken.review.comments[1]!.line = 0;
  expect(parseInboxApprovalDetails(broken)).toBeUndefined();
  expect(parseInboxApprovalDetails({ ...review, kind: "task" })).toBeUndefined();
  expect(parseInboxApprovalDetails({ ...review, action: "comment" })).toBeUndefined();
  expect(parseInboxApprovalDetails(undefined)).toBeUndefined();
});

it("reads comments and pull request changes", () => {
  expect(
    parseInboxApprovalDetails({ ...review, action: "comment", review: undefined, body: "Hi" }),
  ).toMatchObject({ action: "comment", body: "Hi" });
  expect(
    parseInboxApprovalDetails({
      ...review,
      action: "pr-action",
      review: undefined,
      prAction: "squash",
      headSha: "b".repeat(40),
    }),
  ).toMatchObject({ prAction: "squash", headSha: "b".repeat(40) });
});
