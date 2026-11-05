import { describe, expect, it } from "vitest";
import {
  contactTagBlockedReason,
  contactTagInput,
  contactTagScopes,
  initialTagReview,
  keepAllValid,
  keptTagCount,
  keptTags,
  mergeTags,
  tagIssue,
  type ContactTagSubject,
} from "./socialContactTags";
import type { ContactTagResult } from "./socialSuggestions";

const subject = (ref: string, over: Partial<ContactTagSubject> = {}): ContactTagSubject => ({
  ref,
  accountId: "a",
  platformId: `id-${ref}`,
  projectIds: ["p"],
  name: `Name ${ref}`,
  tags: [],
  ...over,
});
const result: ContactTagResult = {
  accountId: "a",
  projectId: "p",
  proposals: [
    {
      ref: "1",
      name: "Name 1",
      currentTags: ["vip"],
      tags: [
        { tag: "press", reason: "r", isNew: false },
        { tag: "Press", reason: "r", isNew: false },
        { tag: "VIP", reason: "r", isNew: false },
      ],
      segments: [],
    },
  ],
  unchangedRefs: [],
  notes: [],
  agent: { provider: "codex" },
  draftOnly: true,
};

describe("contactTagScopes", () => {
  it("groups subjects by account and accessible project, largest first", () => {
    const scopes = contactTagScopes(
      [
        subject("1"),
        subject("2", { projectIds: ["p", "q"] }),
        subject("3", { accountId: "b" }),
        subject("4", { projectIds: ["hidden"] }),
      ],
      ["p", "q"],
    );
    expect(scopes.map((scope) => [scope.accountId, scope.projectId, scope.refs])).toEqual([
      ["a", "p", ["1", "2"]],
      ["a", "q", ["2"]],
      ["b", "p", ["3"]],
    ]);
  });
});

describe("contactTagInput", () => {
  const scope = { key: "k", accountId: "a", projectId: "p", refs: ["1", "2"] };
  it("sends import rows without consent fields and trims instructions", () => {
    const input = contactTagInput(
      "import",
      scope,
      [subject("1", { language: "tr", profileUrl: "https://example.com/u" }), subject("2")],
      "  press only  ",
    );
    expect(input).toEqual({
      accountId: "a",
      projectId: "p",
      rows: [
        {
          ref: "1",
          name: "Name 1",
          platformId: "id-1",
          profileUrl: "https://example.com/u",
          language: "tr",
          tags: [],
        },
        { ref: "2", name: "Name 2", platformId: "id-2", tags: [] },
      ],
      instructions: "press only",
    });
  });
  it("sends only ids for saved contacts and caps one request at 100", () => {
    const many = Array.from({ length: 130 }, (_, index) => subject(String(index)));
    const big = { ...scope, refs: many.map((item) => item.ref) };
    const input = contactTagInput("contacts", big, many, "");
    expect(input.contactIds).toHaveLength(100);
    expect(input.rows).toBeUndefined();
    expect(input).not.toHaveProperty("instructions");
  });
});

describe("contactTagBlockedReason", () => {
  const base = {
    hostOnline: true,
    account: { grants: { p: ["draft"] } },
    projectId: "p",
    agent: "ready" as const,
    count: 2,
  };
  it("explains each blocker and is empty when the ask can go ahead", () => {
    expect(contactTagBlockedReason(base)).toBe("");
    expect(contactTagBlockedReason({ ...base, hostOnline: false })).toContain("offline");
    expect(contactTagBlockedReason({ ...base, account: undefined })).toContain(
      "account and project",
    );
    expect(contactTagBlockedReason({ ...base, account: { grants: { p: ["read"] } } })).toContain(
      "draft access",
    );
    expect(contactTagBlockedReason({ ...base, count: 0 })).toContain("at least one contact");
    expect(contactTagBlockedReason({ ...base, agent: "missing" })).toContain("text agent");
    expect(contactTagBlockedReason({ ...base, agent: "checking" })).toBe("");
  });
});

describe("tag review", () => {
  it("starts with nothing kept: the owner chooses what to apply", () => {
    const review = initialTagReview(result);
    expect(keptTagCount(keptTags(result, review))).toBe(0);
  });

  it("flags empty, long, existing and repeated tags and keeps only valid choices", () => {
    const review = initialTagReview(result);
    review["1"][0].use = true;
    review["1"][1].use = true;
    review["1"][2].use = true;
    expect(tagIssue(["vip"], review["1"], 0)).toBe("");
    expect(tagIssue(["vip"], review["1"], 1)).toContain("already kept");
    expect(tagIssue(["vip"], review["1"], 2)).toContain("already has");
    expect(keptTags(result, review)).toEqual({ "1": ["press"] });
    review["1"][0].text = "   ";
    expect(tagIssue(["vip"], review["1"], 0)).toContain("Enter a tag");
    review["1"][0].text = "x".repeat(41);
    expect(tagIssue(["vip"], review["1"], 0)).toContain("at most 40");
    review["1"][0].text = " new   label ";
    expect(keptTags(result, review)).toEqual({ "1": ["new label", "Press"] });
  });

  it("stops at the contact's 30-tag limit", () => {
    const edits = [
      { use: true, text: "a" },
      { use: true, text: "b" },
    ];
    const current = Array.from({ length: 29 }, (_, index) => `t${index}`);
    expect(tagIssue(current, edits, 0)).toBe("");
    expect(tagIssue(current, edits, 1)).toContain("at most 30");
  });

  it("keeps every valid suggestion at once", () => {
    const kept = keepAllValid(result, initialTagReview(result));
    expect(kept["1"].map((edit) => edit.use)).toEqual([true, false, false]);
  });

  it("merges tags without repeating one", () => {
    expect(mergeTags(["VIP"], ["vip", "press", "Press"])).toEqual(["VIP", "press"]);
  });
});
