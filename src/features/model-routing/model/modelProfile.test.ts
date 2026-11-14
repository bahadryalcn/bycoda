import { describe, expect, it } from "vitest";
import { inferAccountKind, modelProfile } from "./modelProfile";

describe("modelProfile", () => {
  it("uses the tier and price tables for known models", () => {
    expect(modelProfile("claude", "claude-opus-4-6")).toEqual({
      intelligence: 4,
      cost: 3,
      estimated: false,
    });
    expect(modelProfile("claude", "claude-haiku-4-5")).toEqual({
      intelligence: 2,
      cost: 1,
      estimated: false,
    });
    expect(modelProfile("claude", "claude-fable-5").intelligence).toBe(5);
    expect(modelProfile("claude", "claude-fable-5").cost).toBe(4);
  });
  it("estimates unknown models from the name and marks them", () => {
    expect(modelProfile("opencode", "acme-ultra-1")).toEqual({
      intelligence: 5,
      cost: 4,
      estimated: true,
    });
    expect(modelProfile("opencode", "acme-lite")).toEqual({
      intelligence: 2,
      cost: 1,
      estimated: true,
    });
    expect(modelProfile("opencode", "acme-9")).toEqual({
      intelligence: 3,
      cost: 2,
      estimated: true,
    });
  });
  it("marks a ranked model without a price as estimated", () => {
    const profile = modelProfile("claude", "claude-opus-9-9-preview-x");
    expect(profile.intelligence).toBe(4);
    expect(profile.estimated).toBe(true);
    expect(profile.cost).toBe(3);
  });
});

describe("inferAccountKind", () => {
  it("matches whole words in both languages", () => {
    expect(inferAccountKind("Work account")).toBe("work");
    expect(inferAccountKind("İş hesabı")).toBe("work");
    expect(inferAccountKind("Şirket")).toBe("work");
    expect(inferAccountKind("Kişisel")).toBe("personal");
    expect(inferAccountKind("my PRIVATE one")).toBe("personal");
  });
  it("is undefined for both, neither or partial words", () => {
    expect(inferAccountKind("work and personal")).toBeUndefined();
    expect(inferAccountKind("default")).toBeUndefined();
    expect(inferAccountKind("homework")).toBeUndefined();
    expect(inferAccountKind("this account")).toBeUndefined();
  });
});
