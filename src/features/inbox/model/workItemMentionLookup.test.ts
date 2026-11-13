import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxItem } from "./githubTasks";

const mocks = vi.hoisted(() => ({
  peekWorkItemMentionCandidates: vi.fn(),
  workItemMentionCandidates: vi.fn(),
}));
vi.mock("./workItemMentions", async (load) => ({
  ...(await load<typeof import("./workItemMentions")>()),
  peekWorkItemMentionCandidates: mocks.peekWorkItemMentionCandidates,
  workItemMentionCandidates: mocks.workItemMentionCandidates,
}));

import {
  lookupWorkItemMention,
  parseWorkItemMentionToken,
  peekWorkItemMention,
  rememberWorkItemMention,
  workItemMatchesMention,
} from "./workItemMentionLookup";
import {
  requestInboxItem,
  subscribeInboxItemRequests,
  takeInboxItemRequest,
} from "./inboxItemRequest";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    provider: "github",
    kind: "issue",
    number: 142,
    repo: "owner/repo",
    title: "Fix auth crash",
    state: "open",
    url: "https://example.test/142",
    updatedAt: "",
    labels: [],
    assignees: [],
    draft: false,
    projectPath: "/repo",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.peekWorkItemMentionCandidates.mockReturnValue([]);
  mocks.workItemMentionCandidates.mockResolvedValue([]);
});

describe("workItemMatchesMention", () => {
  it("matches tracker keys case-insensitively and code-host refs by repo, number and kind", () => {
    const jira = item({ provider: "jira", identifier: "PFDEV-834", repo: "" });
    expect(workItemMatchesMention(jira, parseWorkItemMentionToken("@jr:pfdev-834")!)).toBe(true);
    expect(workItemMatchesMention(jira, parseWorkItemMentionToken("@jira:PFDEV-83")!)).toBe(false);

    const github = item();
    expect(workItemMatchesMention(github, parseWorkItemMentionToken("@gh:owner/repo#142")!)).toBe(
      true,
    );
    expect(workItemMatchesMention(github, parseWorkItemMentionToken("@gh:#142")!)).toBe(true);
    expect(workItemMatchesMention(github, parseWorkItemMentionToken("@gh:other/repo#142")!)).toBe(
      false,
    );

    const mergeRequest = item({ provider: "gitlab", kind: "pr", repo: "group/proj", number: 7 });
    expect(
      workItemMatchesMention(mergeRequest, parseWorkItemMentionToken("@gl:group/proj!7")!),
    ).toBe(true);
    expect(
      workItemMatchesMention(mergeRequest, parseWorkItemMentionToken("@gl:group/proj#7")!),
    ).toBe(false);
  });

  it("rejects unknown aliases", () => {
    expect(parseWorkItemMentionToken("@nope:ABC-1")).toBeNull();
  });
});

describe("lookupWorkItemMention", () => {
  it("answers from a picked row without reading the provider", async () => {
    const picked = item({ provider: "linear", identifier: "ENG-12", repo: "" });
    rememberWorkItemMention(picked);
    expect(peekWorkItemMention("@lin:eng-12", "/repo")).toBe(picked);
    await expect(lookupWorkItemMention("@linear:ENG-12", "/repo")).resolves.toBe(picked);
    expect(mocks.workItemMentionCandidates).not.toHaveBeenCalled();
  });

  it("searches only the token's provider and keeps the exact match", async () => {
    const wanted = item({ provider: "jira", identifier: "PFDEV-834", repo: "" });
    mocks.workItemMentionCandidates.mockResolvedValue([
      item({ provider: "jira", identifier: "PFDEV-8340", repo: "" }),
      wanted,
    ]);
    await expect(lookupWorkItemMention("@jira:PFDEV-834", "/repo")).resolves.toBe(wanted);
    expect(mocks.workItemMentionCandidates).toHaveBeenCalledWith(
      "/repo",
      "jira",
      "PFDEV-834",
      ["jira"],
      undefined,
    );
  });

  it("searches code hosts by number and returns null without a match", async () => {
    await expect(lookupWorkItemMention("@gh:owner/repo#9", "/repo")).resolves.toBeNull();
    expect(mocks.workItemMentionCandidates).toHaveBeenCalledWith(
      "/repo",
      "github",
      "9",
      ["github"],
      undefined,
    );
  });
});

describe("inbox item requests", () => {
  it("notifies listeners and hands the request to one consumer", () => {
    const listener = vi.fn();
    const stop = subscribeInboxItemRequests(listener);
    const target = item();
    requestInboxItem(target);
    stop();
    expect(listener).toHaveBeenCalledWith(target);
    expect(takeInboxItemRequest()).toBe(target);
    expect(takeInboxItemRequest()).toBeNull();
  });
});
