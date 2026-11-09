import { describe, expect, it } from "vitest";
import type { Capability, SocialAccount, SocialCampaign, SocialPolicies } from "../../model/social";
import {
  draftFromCampaign,
  emptyDraft,
  type ContentDraft,
  type ContentMedia,
} from "./contentDraft";
import { buildVariants, draftProblems, selectedAccounts, type RuleInput } from "./contentRules";

const NOW = Date.UTC(2026, 10, 7, 9, 0);

function account(
  patch: Partial<SocialAccount> & { id: string; platform: SocialAccount["platform"] },
): SocialAccount {
  return {
    platformId: `${patch.id}-platform`,
    name: "Studio",
    accountType: "member",
    scopes: [],
    accessApproved: true,
    connected: true,
    connection: "oauth",
    paused: false,
    executorId: "exec",
    grants: { p1: ["read", "draft", "publish"] },
    createdAt: 1,
    ...patch,
  } as SocialAccount;
}

function capability(status: Capability["status"], reasonCode = "api.ready"): Capability {
  return { operation: "publish", status, reason: "", reasonCode, scopes: [], source: "test" };
}

const image = (id: string): ContentMedia => ({
  localId: id,
  name: `${id}.jpg`,
  media: { kind: "image", uploadId: id },
});

function input(
  draft: Partial<ContentDraft>,
  accounts: SocialAccount[],
  policies: SocialPolicies = { global: {}, platforms: {} },
  capabilities: Record<string, Capability[]> = {},
): RuleInput {
  return {
    draft: {
      ...emptyDraft(),
      text: "Hello",
      accountIds: accounts.map((item) => item.id),
      ...draft,
    },
    projectId: "p1",
    accounts,
    snapshot: {
      capabilities: {
        ...Object.fromEntries(accounts.map((item) => [item.id, [capability("available")]])),
        ...capabilities,
      },
      policies,
    },
    now: NOW,
  };
}

/** Local `YYYY-MM-DDTHH:mm` for an epoch time, the value the date field holds. */
function localInput(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const limit = (max: number): SocialPolicies => ({
  global: { maxContentCharacters: max },
  platforms: {},
});
const texts = (problems: { text: string }[]) => problems.map((problem) => problem.text);
const x = account({ id: "x1", platform: "x" });

describe("what a draft needs before it can be saved", () => {
  it("accepts a post with media and no words", () => {
    expect(draftProblems(input({ text: "", media: [image("a")] }, [x]))).toEqual([]);
  });

  it("asks for words or media when both are missing, even with whitespace", () => {
    expect(texts(draftProblems(input({ text: "  \n " }, [x])))).toEqual([
      "Write the post or attach media.",
    ]);
  });
});

describe("character limits", () => {
  it("counts an emoji as one character for ordinary accounts", () => {
    expect(draftProblems(input({ text: "😀".repeat(5) }, [x], limit(5)))).toEqual([]);
    expect(texts(draftProblems(input({ text: "😀".repeat(6) }, [x], limit(5))))[0]).toContain("5");
  });

  it("counts a Telegram channel bot post in UTF-16 units against the media caption cap", () => {
    const bot = account({
      id: "t1",
      platform: "telegram",
      accountType: "channel",
      connection: "token",
    });
    const text = "😀".repeat(600); // 600 characters, 1200 UTF-16 units
    const withMedia = draftProblems(input({ text, media: [image("a")] }, [bot], limit(5000)));
    expect(withMedia).toHaveLength(1);
    expect(withMedia[0]!.text).toContain("1024");
    expect(draftProblems(input({ text }, [bot], limit(5000)))).toEqual([]);
  });

  it("counts the link toward the limit", () => {
    const draft = { text: "a".repeat(20), link: "https://example.com/abcdef" };
    expect(draftProblems(input({ text: draft.text }, [x], limit(30)))).toEqual([]);
    expect(draftProblems(input(draft, [x], limit(30)))).toHaveLength(1);
  });

  it("counts UTM tags that will be added to the link", () => {
    const base = { text: "a".repeat(10), link: "https://e.co" };
    expect(draftProblems(input(base, [x], limit(30)))).toEqual([]);
    const tagged = { ...base, utm: { source: "bycoda", medium: "", campaign: "" } };
    expect(draftProblems(input(tagged, [x], limit(30)))).toHaveLength(1);
  });

  it("reports every account that is over its own limit, each with its account id", () => {
    const linkedin = account({ id: "l1", platform: "linkedin" });
    const problems = draftProblems(input({ text: "a".repeat(6) }, [x, linkedin], limit(5)));
    expect(problems.map((problem) => problem.accountId)).toEqual(["x1", "l1"]);
  });

  it("starts an account problem with the platform and the account name", () => {
    const problems = draftProblems(input({ text: "a".repeat(6) }, [x], limit(5)));
    expect(problems[0]!.text.startsWith("X · Studio: ")).toBe(true);
  });
});

describe("links and times", () => {
  it("accepts http and https links and rejects other schemes and bare hosts", () => {
    for (const link of ["https://example.com", "http://example.com/a?b=1"])
      expect(draftProblems(input({ link }, [x]))).toEqual([]);
    for (const link of ["ftp://example.com", "javascript:alert(1)", "example.com"])
      expect(texts(draftProblems(input({ link }, [x])))).toEqual([
        "Enter a link that starts with https://.",
      ]);
  });

  it("needs a usable time for a later post", () => {
    for (const scheduledAt of ["", "not-a-date"])
      expect(texts(draftProblems(input({ when: "later", scheduledAt }, [x])))).toEqual([
        "Pick a valid time.",
      ]);
  });

  it("accepts a future time and rejects the current minute and the past", () => {
    expect(
      draftProblems(input({ when: "later", scheduledAt: localInput(NOW + 3_600_000) }, [x])),
    ).toEqual([]);
    for (const at of [NOW, NOW - 60_000])
      expect(
        texts(draftProblems(input({ when: "later", scheduledAt: localInput(at) }, [x]))),
      ).toEqual(["Pick a time in the future."]);
  });

  it("ignores a stale time while the post goes out now", () => {
    expect(draftProblems(input({ when: "now", scheduledAt: "2020-01-01T10:00" }, [x]))).toEqual([]);
  });
});

describe("repeat", () => {
  it("accepts equal gaps and rejects a missing count or a zero gap", () => {
    const repeat = (minMinutes: number, maxMinutes: number, totalPosts: number) => ({
      repeat: { enabled: true, minMinutes, maxMinutes, totalPosts },
    });
    expect(draftProblems(input(repeat(60, 60, 5), [x]))).toEqual([]);
    expect(texts(draftProblems(input(repeat(60, 120, 0), [x])))).toEqual([
      "Repeat: enter how many posts to make.",
    ]);
    expect(texts(draftProblems(input(repeat(0, 120, 3), [x])))).toEqual([
      "Repeat: the longest interval must be at least the shortest.",
    ]);
  });

  it("does not check repeat values while repeat is off", () => {
    const repeat = { enabled: false, minMinutes: 0, maxMinutes: 0, totalPosts: 0 };
    expect(draftProblems(input({ repeat }, [x]))).toEqual([]);
  });
});

describe("account access", () => {
  it("names a selected account that lost project access", () => {
    const noAccess = account({ id: "x1", platform: "x", grants: {} });
    expect(texts(draftProblems(input({}, [noAccess])))).toEqual([
      "X · Studio: No access to this project. Grant it in Accounts & Settings.",
    ]);
  });

  it("says a selected account needs a new connection when its publish capability expired", () => {
    const problems = draftProblems(
      input({}, [x], undefined, { x1: [capability("expired", "api.token_expired")] }),
    );
    expect(texts(problems)).toEqual(["X · Studio: Connection needed"]);
  });

  it("reports an account problem next to a platform problem of another account", () => {
    const youtube = account({ id: "y1", platform: "youtube", name: "Channel" });
    const noAccess = account({ id: "x1", platform: "x", grants: {} });
    const problems = draftProblems(input({ media: [image("a")] }, [noAccess, youtube]));
    expect(problems.filter((problem) => problem.accountId === "x1")).toHaveLength(1);
    expect(problems.filter((problem) => problem.accountId === "y1").length).toBeGreaterThan(1);
  });
});

describe("variants for the Host", () => {
  it("uses the chosen time for a later post and 'now' for an immediate one", () => {
    const later = buildVariants(input({ when: "later", scheduledAt: "2099-01-05T14:30" }, [x]));
    expect(later[0]!.scheduledAt).toBe(new Date(2099, 0, 5, 14, 30).getTime());
    expect(
      buildVariants(input({ when: "now", scheduledAt: "2099-01-05T14:30" }, [x]))[0]!.scheduledAt,
    ).toBe(NOW);
  });

  it("builds one variant per account with the same trimmed text, media and no empty link", () => {
    const linkedin = account({ id: "l1", platform: "linkedin" });
    const built = buildVariants(input({ text: "  Hi  ", media: [image("a")] }, [x, linkedin]));
    expect(built.map((variant) => variant.accountId)).toEqual(["x1", "l1"]);
    expect(built.every((variant) => variant.text === "Hi")).toBe(true);
    expect(built.every((variant) => variant.media.length === 1 && !("link" in variant))).toBe(true);
  });

  it("does not share the fact list with the draft", () => {
    const rules = input({ factIds: ["f1"] }, [x]);
    const [variant] = buildVariants(rules);
    variant!.factIds.push("f2");
    expect(rules.draft.factIds).toEqual(["f1"]);
  });

  it("sends TikTok consent only when it was given explicitly", () => {
    const tiktok = account({ id: "tt", platform: "tiktok" });
    const video: ContentMedia = {
      localId: "v",
      name: "v.mp4",
      media: { kind: "video", uploadId: "v" },
      probe: { durationSeconds: 12 },
    };
    const built = (consent: boolean | undefined) =>
      buildVariants(
        input({ media: [video], platform: { tt: { tiktok: { privacy: "SELF_ONLY", consent } } } }, [
          tiktok,
        ]),
      )[0]!.tiktok;
    expect(built(true)?.consent).toBe(true);
    expect(built(undefined)?.consent).toBe(false);
    expect(built(false)?.consent).toBe(false);
  });

  it("keeps a saved TikTok post's choices when it is opened and saved again", () => {
    const tiktok = account({ id: "tt", platform: "tiktok" });
    const options = {
      privacy: "SELF_ONLY",
      durationSeconds: 42,
      allowComment: true,
      allowDuet: false,
      allowStitch: true,
      brandContent: false,
      brandOrganic: true,
      isAigc: false,
      consent: true,
    };
    const saved: SocialCampaign = {
      id: "c1",
      name: "Clip",
      projectIds: ["p1"],
      revision: 1,
      paused: false,
      createdAt: 1,
      variants: [
        {
          accountId: "tt",
          text: "Clip",
          media: [{ kind: "video", uploadId: "v1" }],
          scheduledAt: new Date(2099, 0, 5, 14, 30).getTime(),
          factIds: [],
          tiktok: options,
        },
      ],
    };
    const rules = input(draftFromCampaign(saved), [tiktok]);
    expect(draftProblems(rules)).toEqual([]);
    expect(buildVariants(rules)[0]!.tiktok).toEqual(options);
  });
});

describe("selected accounts", () => {
  it("returns the chosen accounts in the order they were chosen, skipping ones that are gone", () => {
    const linkedin = account({ id: "l1", platform: "linkedin" });
    const draft = { ...emptyDraft(), accountIds: ["l1", "gone", "x1"] };
    expect(selectedAccounts(draft, [x, linkedin]).map((item) => item.id)).toEqual(["l1", "x1"]);
  });
});
