import { describe, expect, it, vi } from "vitest";
import type { HostProject } from "../../connections/model/protocol";
import type { SocialAccount, SocialContact, SocialSnapshot, SocialThread } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import {
  contactTarget,
  planBulkDrafts,
  prepareBulkDrafts,
  threadTarget,
  type BulkOptions,
} from "./socialBulk";

const projects = [{ id: "project", name: "Demo", cwd: "C:/demo" }] as HostProject[];
const account: SocialAccount = {
  id: "account",
  name: "Owner",
  platform: "x",
  platformId: "owner",
  accountType: "member",
  scopes: [],
  accessApproved: true,
  connected: true,
  paused: false,
  executorId: "host",
  grants: { project: ["read", "draft", "message", "reply", "comment"] },
  createdAt: 1,
};
const contact = (id: string, overrides: Partial<SocialContact> = {}): SocialContact => ({
  id,
  name: id,
  accountId: "account",
  platformId: id,
  source: "manual",
  projectIds: ["project"],
  tags: [],
  consent: { allowed: true, source: "Owner record", at: 1 },
  replyEligible: true,
  commentEligible: true,
  optedOut: false,
  history: [],
  ...overrides,
});
const thread = (id: string, overrides: Partial<SocialThread> = {}): SocialThread => ({
  id,
  accountId: "account",
  platformThreadId: id,
  kind: "comment",
  projectId: "project",
  contactId: "one",
  lastInboundAt: 2,
  replyAllowed: true,
  events: [{ id: "inbound", text: "Question", direction: "inbound", at: 2, platformId: "message" }],
  ...overrides,
});
function snapshot(overrides: Partial<SocialSnapshot> = {}): SocialSnapshot {
  return {
    executorId: "host",
    hostOnline: true,
    sendingEnabled: false,
    stopped: false,
    pollingEnabled: false,
    accounts: [account],
    campaigns: [],
    contacts: [contact("one"), contact("two")],
    threads: [thread("thread")],
    segments: [],
    rules: [],
    jobs: [],
    drafts: [],
    profiles: [],
    capabilities: {
      account: ["message.start", "message.reply", "reply", "comment"].map((operation) => ({
        operation: operation as "comment",
        status: "available",
        reason: "",
        scopes: [],
        source: "api",
      })),
    },
    ...overrides,
  };
}
const options = (value = snapshot()): BulkOptions => ({
  targets: value.contacts.map(contactTarget),
  kind: "message",
  text: "Hello",
  projectId: "project",
  postIds: {},
});

describe("bulk social draft eligibility", () => {
  it("validates every recipient independently without granting communication consent", () => {
    const value = snapshot({
      contacts: [
        contact("one"),
        contact("two", { consent: undefined }),
        contact("out", { optedOut: true }),
        contact("other", { projectIds: ["other"] }),
      ],
    });
    const rows = planBulkDrafts(options(value), value, projects, {
      account: { maxMessageCharacters: 10 },
    });
    expect(rows.map((row) => row.reason)).toEqual([
      "",
      "There is no recorded contact consent for a new message.",
      "This contact has opted out of contact.",
      "This contact is not linked to the selected project.",
    ]);
    expect(value.contacts[1].consent).toBeUndefined();
  });
  it("applies effective per-account limits and excludes failed policy reads", () => {
    const second = { ...account, id: "other" };
    const value = snapshot({
      accounts: [account, second],
      contacts: [contact("one"), contact("two", { accountId: "other" })],
      capabilities: { ...snapshot().capabilities, other: snapshot().capabilities.account },
    });
    const rows = planBulkDrafts(
      options(value),
      value,
      projects,
      { account: { maxMessageCharacters: 3 } },
      { other: "Policy unavailable" },
    );
    expect(rows[0].reason).toBe("The text exceeds the 3 character limit.");
    expect(rows[1].reason).toBe("Policy unavailable");
  });
  it("shows the current browser capability reason instead of a blanket API requirement", () => {
    const value = snapshot({
      accounts: [{ ...account, connection: "browser" }],
      capabilities: {
        account: [
          {
            operation: "reply",
            status: "unsupported",
            reason: "No inbox",
            scopes: [],
            source: "browser",
          },
        ],
      },
    });
    const rows = planBulkDrafts(
      { ...options(value), kind: "reply", targets: value.threads.map(threadTarget) },
      value,
      projects,
      { account: {} },
    );
    expect(rows[0].reason).toBe("No inbox");
  });
  it("rejects missing assignment, expired reply windows, and changed thread/contact association", () => {
    const value = snapshot({
      threads: [
        thread("unassigned", { projectId: undefined }),
        thread("expired", { replyUntil: 1 }),
        thread("mismatch", { contactId: "two" }),
      ],
    });
    const targets = value.threads.map(threadTarget);
    targets[2].contactId = "one";
    const rows = planBulkDrafts(
      { ...options(value), kind: "reply", targets },
      value,
      projects,
      { account: {} },
      {},
      100,
    );
    expect(rows[0].reason).toBe("Select an accessible project.");
    expect(rows[1].reason).toBe("The reply window has expired.");
    expect(rows[2].reason).toBe("The conversation match is invalid.");
  });
  it("allows browser replies after an old API window while preserving opt-out and reply restrictions", () => {
    const value = snapshot({
      accounts: [{ ...account, platform: "instagram", connection: "browser" }],
      contacts: [contact("one"), contact("out", { optedOut: true })],
      threads: [
        thread("expired", { kind: "message", replyUntil: 1 }),
        thread("denied", { kind: "message", replyUntil: 1, replyAllowed: false }),
        thread("opted-out", { kind: "message", replyUntil: 1, contactId: "out" }),
      ],
    });
    const rows = planBulkDrafts(
      { ...options(value), kind: "reply", targets: value.threads.map(threadTarget) },
      value,
      projects,
      { account: {} },
      {},
      100,
    );
    expect(rows.map((row) => row.reason)).toEqual([
      "",
      "Replying to this conversation is not allowed.",
      "This contact has opted out of contact.",
    ]);
  });
  it("requires a separate post identity for each selected comment recipient", () => {
    const value = snapshot();
    const rows = planBulkDrafts(
      { ...options(value), kind: "comment", postIds: { "contact:one": "post-one" } },
      value,
      projects,
      { account: {} },
    );
    expect(rows[0].reason).toBe("");
    expect(rows[1].reason).toBe("Enter the ID of the post to comment on.");
  });
});

describe("partial draft preparation", () => {
  it("reads policy once per account before mutation, keeps partial successes, and retries only failures with the same request ID", async () => {
    let fail = true;
    const request = vi.fn(
      async (action: string, input: Record<string, unknown>, requestId?: string) => {
        if (action === "policy.get") return { effective: { maxMessageCharacters: 20 } };
        if (input.contactId === "two" && fail) throw new Error("Temporary failure");
        return {
          id: `draft-${input.contactId}`,
          accountId: "account",
          projectId: "project",
          kind: "message",
          contactId: input.contactId,
          text: input.text,
          factIds: [],
          createdAt: 1,
          requestId,
        };
      },
    );
    const client = { request } as unknown as SocialClient;
    const value = snapshot();
    const current = options(value);
    const first = await prepareBulkDrafts(client, current, value, projects);
    expect(first.map((row) => row.status)).toEqual(["succeeded", "failed"]);
    expect(request.mock.calls[0]).toEqual(["policy.get", { accountId: "account" }]);
    const failedRequestId = request.mock.calls.find((call) => call[1].contactId === "two")?.[2];
    expect(failedRequestId).toBeTruthy();
    fail = false;
    request.mockClear();
    const second = await prepareBulkDrafts(client, current, value, projects, first);
    expect(second.map((row) => row.status)).toEqual(["succeeded", "succeeded"]);
    expect(request.mock.calls.filter((call) => call[0] === "messages.draft")).toEqual([
      [
        "messages.draft",
        { accountId: "account", contactId: "two", projectId: "project", text: "Hello" },
        failedRequestId,
      ],
    ]);
    expect(second[0].draft?.id).toBe(first[0].draft?.id);
    expect(
      request.mock.calls.some((call) => call[0].endsWith(".send") || call[0] === "drafts.approve"),
    ).toBe(false);
  });
  it("skips ineligible recipients and deduplicates repeated selections", async () => {
    const value = snapshot({ contacts: [contact("one"), contact("two", { optedOut: true })] });
    const request = vi.fn(async (action: string, input: Record<string, unknown>) =>
      action === "policy.get" ? { effective: {} } : { id: String(input.contactId) },
    );
    const current = options(value);
    current.targets.push(current.targets[0]);
    const rows = await prepareBulkDrafts(
      { request } as unknown as SocialClient,
      current,
      value,
      projects,
    );
    expect(rows.map((row) => row.status)).toEqual(["succeeded", "skipped"]);
    expect(request.mock.calls.filter((call) => call[0] === "messages.draft")).toHaveLength(1);
  });
  it("rechecks policy during retry and does not recreate a success when limits changed", async () => {
    const value = snapshot();
    let short = false;
    const request = vi.fn(async (action: string, input: Record<string, unknown>) => {
      if (action === "policy.get") return { effective: { maxMessageCharacters: short ? 2 : 20 } };
      if (input.contactId === "two") throw new Error("Retry needed");
      return { id: "done" };
    });
    const client = { request } as unknown as SocialClient;
    const first = await prepareBulkDrafts(client, options(value), value, projects);
    request.mockClear();
    short = true;
    const second = await prepareBulkDrafts(client, options(value), value, projects, first);
    expect(second.map((row) => row.status)).toEqual(["succeeded", "skipped"]);
    expect(request.mock.calls.every((call) => call[0] === "policy.get")).toBe(true);
  });
});
