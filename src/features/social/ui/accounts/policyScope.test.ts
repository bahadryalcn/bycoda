import { describe, expect, it } from "vitest";
import type { SocialPolicies } from "../../model/social";
import { readScope, withAgent, writeScope } from "./policyScope";

const agent = { provider: "claude" as const, model: "m" };
const base: SocialPolicies = {
  global: { agent, maxContentCharacters: 280 },
  platforms: { x: { maxContentCharacters: 200 } },
};

describe("policy scopes", () => {
  it("removes a platform override that has no keys left, so it inherits again", () => {
    const next = writeScope(base, "x", {});
    expect(next.platforms.x).toBeUndefined();
    expect(next.global).toEqual(base.global);
  });

  it("keeps the other scope untouched when one scope changes", () => {
    const next = writeScope(base, "global", { ...base.global, maxCommentCharacters: 100 });
    expect(next.platforms).toEqual(base.platforms);
    expect(next.global.maxCommentCharacters).toBe(100);
  });

  it("reads an unset platform as an empty scope", () => {
    expect(readScope(base, "reddit")).toEqual({});
  });

  it("replaces or removes only the agent of a policy", () => {
    expect(withAgent({ maxContentCharacters: 5, agent }, undefined)).toEqual({
      maxContentCharacters: 5,
    });
    expect(withAgent({}, agent)).toEqual({ agent });
  });
});
