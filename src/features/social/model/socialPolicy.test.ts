import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOCIAL_POLICIES,
  effectiveSocialPolicy,
  parseSocialPolicies,
  socialCharacterCount,
} from "./socialPolicy";
describe("Social global/platform policy", () => {
  it("inherits global fields and overrides only configured platform fields", () => {
    const policies = parseSocialPolicies({
      global: {
        agent: { provider: "antigravity", model: "antigravity-owner-model" },
        maxContentCharacters: 800,
        maxCommentCharacters: 300,
        maxMessageCharacters: 500,
      },
      platforms: {
        x: { maxCommentCharacters: 120 },
        youtube: {
          agent: { provider: "codex", model: "owner-model" },
          maxContentCharacters: 1000,
        },
      },
    });
    expect(effectiveSocialPolicy(policies, "x")).toEqual({
      agent: { provider: "antigravity", model: "antigravity-owner-model" },
      maxContentCharacters: 800,
      maxCommentCharacters: 120,
      maxMessageCharacters: 500,
    });
    expect(effectiveSocialPolicy(policies, "youtube")).toMatchObject({
      agent: { provider: "codex" },
      maxCommentCharacters: 300,
      maxContentCharacters: 1000,
    });
    expect(effectiveSocialPolicy(policies, "x", { provider: "claude" }).agent?.provider).toBe(
      "claude",
    );
    expect(effectiveSocialPolicy(policies, "youtube").agent).toEqual({
      provider: "codex",
      model: "owner-model",
    });
  });
  it("rejects forged settings, invalid providers and zero/fractional limits; counts Unicode code points", () => {
    for (const limit of [0, -1, 1.5, 20001, "100"])
      expect(() =>
        parseSocialPolicies({
          global: { maxCommentCharacters: limit },
          platforms: {},
        }),
      ).toThrow();
    expect(() =>
      parseSocialPolicies({
        global: { agent: { provider: "fake" } },
        platforms: {},
      }),
    ).toThrow();
    expect(() => parseSocialPolicies({ global: { provider: "owner" }, platforms: {} })).toThrow();
    expect(() => parseSocialPolicies({ global: {}, platforms: { fake: {} } })).toThrow();
    expect(socialCharacterCount("A😀ğ")).toBe(3);
  });

  it("accepts a reddit platform override while rejecting unknown platform keys", () => {
    const policies = parseSocialPolicies({
      global: {},
      platforms: { reddit: { maxContentCharacters: 300 } },
    });
    expect(policies.platforms.reddit).toEqual({ maxContentCharacters: 300 });
    expect(() => parseSocialPolicies({ global: {}, platforms: { myspace: {} } })).toThrow(
      "Unsupported social platform.",
    );
  });

  it("resolves the agent as rule > platform > global (B29)", () => {
    const global = { provider: "codex", model: "global-model" } as const;
    const platform = { provider: "claude", model: "platform-model" } as const;
    const rule = { provider: "pi", model: "rule-model" } as const;
    const policies = parseSocialPolicies({
      global: { agent: global, maxContentCharacters: 800 },
      platforms: { x: { agent: platform } },
    });
    expect(effectiveSocialPolicy(policies, "x")).toMatchObject({ agent: platform });
    expect(effectiveSocialPolicy(policies, "x", rule)).toMatchObject({
      agent: rule,
      maxContentCharacters: 800,
    });
    expect(effectiveSocialPolicy(policies, "youtube")).toMatchObject({ agent: global });
    expect(effectiveSocialPolicy(policies, "youtube", rule)).toMatchObject({ agent: rule });
  });

  it("keeps AI off until an agent is chosen, so the first-use prompt can appear", () => {
    expect(effectiveSocialPolicy(DEFAULT_SOCIAL_POLICIES, "x").agent).toBeUndefined();
  });
});
