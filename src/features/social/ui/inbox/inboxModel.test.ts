import { describe, expect, it } from "vitest";
import { dayLabel, groupByDay, replyBlockedText, statusText, unreadableText } from "./inboxModel";
import { unifiedFilterInput } from "./inboxApi";

describe("reply block reasons", () => {
  it("is undefined when a reply can be sent", () => {
    expect(replyBlockedText({ canReply: true })).toBeUndefined();
  });

  it("names the expired 24-hour window in plain words", () => {
    expect(
      replyBlockedText({
        canReply: false,
        templatesOnly: true,
        reasonCode: "window.expired",
        reason: "24-hour window passed; only a template can be sent",
      }),
    ).toBe("This conversation requires a template. Template replies are unavailable here.");
  });

  it("uses the platform wording when the platform forbids replies", () => {
    expect(replyBlockedText({ canReply: false, reasonCode: "platform.reply_not_allowed" })).toBe(
      "The platform does not allow replies to this conversation.",
    );
  });

  it("maps an unknown capability code to a fixed sentence, never the raw code", () => {
    const text = replyBlockedText({ canReply: false, reasonCode: "browser.no_recipe" });
    expect(text).toBe("Not available in the browser yet");
    expect(text).not.toContain("browser.no_recipe");
  });

  it("falls back to a generic sentence when no code is given", () => {
    expect(replyBlockedText({ canReply: false })).toBe("This account cannot reply right now.");
  });
});

describe("unreadable account text", () => {
  it("names the account and the plain reason", () => {
    expect(
      unreadableText(
        {
          accountId: "li-main",
          platform: "linkedin",
          reasonCode: "browser.no_recipe",
          reason: "x",
        },
        "Company page",
      ),
    ).toBe("Can't read messages on Company page: Not available in the browser yet");
  });

  it("falls back to the platform name when the account has no name", () => {
    expect(
      unreadableText(
        {
          accountId: "li-main",
          platform: "linkedin",
          reasonCode: "browser.no_recipe",
          reason: "x",
        },
        "",
      ),
    ).toContain("on LinkedIn");
  });
});

describe("status labels and filter input", () => {
  it("labels every status", () => {
    expect(statusText("unread")).toBe("Unread");
    expect(statusText("replied")).toBe("Replied");
    expect(statusText("assigned")).toBe("Assigned");
    expect(statusText("done")).toBe("Done");
  });

  it("sends only the filters the owner set, trimmed", () => {
    expect(unifiedFilterInput({ status: "all", accountId: "", query: "  " })).toEqual({});
    expect(unifiedFilterInput({ status: "done", accountId: "x-1", query: " vip " })).toEqual({
      status: "done",
      accountId: "x-1",
      query: "vip",
    });
  });
});

describe("day grouping", () => {
  const at = (day: number, hour: number) => new Date(2026, 4, day, hour, 0).getTime();
  const line = (id: string, time: number) => ({
    id,
    at: time,
    direction: "inbound" as const,
    text: id,
  });

  it("keeps order and starts a group on each new local day", () => {
    const groups = groupByDay([
      line("a", at(1, 9)),
      line("b", at(1, 23)),
      line("c", at(2, 0)),
      line("d", at(4, 12)),
    ]);
    expect(groups.map((group) => group.lines.map((entry) => entry.id))).toEqual([
      ["a", "b"],
      ["c"],
      ["d"],
    ]);
  });

  it("returns no groups for no messages", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("labels today and yesterday and falls back to a date", () => {
    const now = at(10, 15);
    expect(dayLabel(at(10, 1), now, "en")).toBe("Today");
    expect(dayLabel(at(9, 23), now, "en")).toBe("Yesterday");
    expect(dayLabel(at(2, 12), now, "en")).toContain("2");
  });
});

it("blocks template-only replies even when a provider reports canReply", () => {
  expect(replyBlockedText({ canReply: true, templatesOnly: true })).toBe(
    "This conversation requires a template. Template replies are unavailable here.",
  );
});

it("explains an expired window without promising a template action", () => {
  expect(replyBlockedText({ canReply: false, reasonCode: "window.expired" })).toBe(
    "The reply window has closed. Replies are unavailable here.",
  );
});
