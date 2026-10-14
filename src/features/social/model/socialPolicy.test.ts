import { describe, expect, it } from "vitest";
import { effectiveSocialPolicy, parseSocialPolicies, socialCharacterCount } from "./socialPolicy";
describe("Social global/platform policy", () => {
  it("inherits global fields and overrides only configured platform fields", () => {
    const policies = parseSocialPolicies({
      global: {
        agent: { provider: "gemini", model: "gemini-owner-model" },
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
      agent: { provider: "gemini", model: "gemini-owner-model" },
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
    expect(effectiveSocialPolicy(policies, "youtube", { provider: "claude" }).agent).toEqual({
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
});
