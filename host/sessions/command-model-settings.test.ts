import { describe, expect, it } from "vitest";
import { DELEGATION_LIMITS } from "../../src/shared/model/host-contracts/delegation";
import { modelSettings } from "./command-model-settings";

describe("modelSettings command admission", () => {
  it("accepts a long JSON value for a reserved delegation key", () => {
    const value = JSON.stringify([
      { harness: "codex", model: "codex:gpt-6.1-sol".padEnd(150, "x") },
    ]);
    expect(value.length).toBeGreaterThan(128);
    expect(modelSettings({ crossSubagents: value })).toEqual({ crossSubagents: value });
    expect(modelSettings({ crossAdvisor: value })).toEqual({ crossAdvisor: value });
    expect(modelSettings({ delegationParent: value })).toEqual({ delegationParent: value });
  });

  it("rejects a reserved delegation value above the byte limit", () => {
    const value = "x".repeat(DELEGATION_LIMITS.valueBytes + 1);
    expect(() => modelSettings({ crossSubagents: value })).toThrow("Invalid model settings");
  });

  it("still caps an ordinary key at 128 characters", () => {
    const value = "x".repeat(129);
    expect(() => modelSettings({ effort: value })).toThrow("Invalid model settings");
    expect(modelSettings({ effort: "x".repeat(128) })).toEqual({ effort: "x".repeat(128) });
  });

  it("keeps the other validation rules for reserved keys", () => {
    expect(() => modelSettings({ crossSubagents: "a\0b" })).toThrow("Invalid model settings");
    expect(() => modelSettings({ crossSubagents: 1 })).toThrow("Invalid model settings");
    expect(() => modelSettings({ "cross-subagents": "[]" })).toThrow("Invalid model settings");
    expect(() => modelSettings(["crossSubagents"])).toThrow("Invalid model settings");
    expect(() => modelSettings("crossSubagents")).toThrow("Invalid model settings");
    const twentyOne = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [`key${index}`, "v"]),
    );
    expect(() => modelSettings(twentyOne)).toThrow("Invalid model settings");
  });

  it("accepts null and undefined as no settings", () => {
    expect(modelSettings(undefined)).toEqual({});
    expect(modelSettings(null)).toEqual({});
  });
});
