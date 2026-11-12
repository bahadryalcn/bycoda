import { describe, expect, it } from "vitest";
import { mentionTokenAt, replaceMentionToken } from "../../files/public/fileMentions";
import type { InboxItem } from "../../inbox/public/workItemMentions";
import {
  workItemMentionOf,
  workItemMentionRows,
  WORK_ITEM_HINT_PREFIX,
  WORK_ITEM_MENTION_PREFIX,
} from "./workItemMentionRows";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    provider: "jira",
    kind: "jira",
    number: 123,
    identifier: "PROJ-123",
    title: "Login bug",
    repo: "PROJ",
    state: "Open",
    projectPath: "/repo",
    url: "https://example.test/PROJ-123",
    updatedAt: "2026-11-12T00:00:00Z",
    labels: [],
    assignees: [],
    draft: false,
    ...overrides,
  };
}

describe("work-item mention rows", () => {
  it("offers canonical hints only for connected providers", () => {
    const rows = workItemMentionRows([item()], "", ["jira", "github"]);
    expect(rows.map((row) => row.relative)).toEqual(["jira:", "github:"]);
    expect(rows.every((row) => row.path.startsWith(WORK_ITEM_HINT_PREFIX))).toBe(true);
    expect(workItemMentionOf(rows[0])).toMatchObject({
      kind: "hint",
      aliases: ["jira", "jr", "j"],
    });
  });

  it("matches partial aliases and hides hints for explicit provider queries", () => {
    expect(
      workItemMentionRows([], "gi", ["jira", "github", "gitlab"]).map((row) => row.relative),
    ).toEqual(["github:", "gitlab:"]);
    expect(workItemMentionRows([], "j", ["jira"])[0].relative).toBe("jira:");
    expect(workItemMentionRows([], "jr:", ["jira"])).toEqual([]);
  });

  it("scopes aliases to one connected provider and inserts model-generated tokens", () => {
    const rows = workItemMentionRows(
      [item(), item({ provider: "github", kind: "issue" })],
      "jr:PROJ",
      ["jira", "github"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ relative: "jira:PROJ-123", name: "PROJ-123 Login bug" });
    expect(rows[0].path.startsWith(WORK_ITEM_MENTION_PREFIX)).toBe(true);
    expect(rows[0].positions.length).toBeGreaterThan(0);
    expect(workItemMentionRows([item()], "jr:", ["github"])).toEqual([]);
  });

  it("ranks exact identifiers before title matches and caps both scopes at ten", () => {
    const items = Array.from({ length: 12 }, (_, number) =>
      item({ number, identifier: `PROJ-${number}`, title: "PROJ-7 login" }),
    );
    const rows = workItemMentionRows(items, "PROJ-7", ["jira"]);
    expect(rows).toHaveLength(10);
    expect(rows[0].relative).toBe("jira:PROJ-7");
    expect(workItemMentionRows(items, "jira:", ["jira"])).toHaveLength(10);
  });

  it("excludes disconnected items and leaves ordinary file rows unmarked", () => {
    expect(workItemMentionRows([item()], "login", ["github"])).toEqual([]);
    expect(workItemMentionOf({ path: "/repo/file.ts" })).toBeUndefined();
  });
});

describe("work-item draft tokens", () => {
  it.each(["jira:PROJ-123", "gh:owner/repo#142", "gl:group/repo!12", "ado:org/project#42"])(
    "accepts punctuation in @%s",
    (query) => {
      expect(mentionTokenAt(`See @${query}`, query.length + 5)).toEqual({
        start: 4,
        end: query.length + 5,
        query,
      });
    },
  );

  it("keeps spaces as token boundaries and ignores email and quoted tokens", () => {
    expect(mentionTokenAt("@jr:login bug", 13)).toBeNull();
    expect(mentionTokenAt("user@jira:PROJ-123", 17)).toBeNull();
    expect(mentionTokenAt("> @jira:PROJ-123", 15)).toBeNull();
  });

  it("inserts hints without a space so the next keystroke searches the provider", () => {
    expect(replaceMentionToken("@j", mentionTokenAt("@j", 2)!, "jira:", false)).toBe("@jira:");
    const text = "See @jr later";
    const token = mentionTokenAt(text, 7)!;
    const next = replaceMentionToken(text, token, "jira:", false);
    expect(next).toBe("See @jira: later");
    expect(mentionTokenAt(next, 10)?.query).toBe("jira:");
  });

  it("replaces the whole query and preserves following text for an item selection", () => {
    const text = "See @gh:owner/repo#14 later";
    const token = mentionTokenAt(text, text.indexOf(" later"))!;
    expect(replaceMentionToken(text, token, "gh:owner/repo#142")).toBe(
      "See @gh:owner/repo#142 later",
    );
  });
});
