import { describe, expect, it } from "vitest";
import {
  CROSS_ADVISOR_KEY,
  CROSS_SUBAGENTS_KEY,
  encodeAdvisor,
  encodeSubagents,
} from "../../../shared/model/host-contracts/delegation";
import { delegationGuidance } from "./delegationGuidance";

const advisor = encodeAdvisor({ harness: "claude", model: "claude:opus-5-5" }) ?? "";
const subagents =
  encodeSubagents([
    { harness: "codex", model: "gpt-6.1-sol" },
    { harness: "cursor", model: "composer" },
  ]) ?? "";

describe("delegationGuidance", () => {
  it("is empty when neither setting is on", () => {
    expect(delegationGuidance(undefined)).toBe("");
    expect(delegationGuidance({})).toBe("");
    expect(delegationGuidance({ effort: "high" })).toBe("");
  });

  it("is empty when the saved values do not decode", () => {
    expect(delegationGuidance({ [CROSS_SUBAGENTS_KEY]: "garbage", [CROSS_ADVISOR_KEY]: "{" })).toBe(
      "",
    );
  });

  it("lists the subagent and advisor labels when they are on", () => {
    const text = delegationGuidance({
      [CROSS_SUBAGENTS_KEY]: subagents,
      [CROSS_ADVISOR_KEY]: advisor,
    });
    expect(text).toContain("Subagent models: Codex gpt-6.1-sol, Cursor composer.");
    expect(text).toContain("Advisor model: Claude Code claude:opus-5-5.");
    expect(text).toContain("read-only");
  });

  it("omits the advisor lines when only subagents are on", () => {
    const text = delegationGuidance({ [CROSS_SUBAGENTS_KEY]: subagents });
    expect(text).toContain("Subagent models:");
    expect(text).not.toContain("Advisor model");
    expect(text).not.toContain("Consult the advisor");
    expect(text).toContain("With one subagent model, always use it");
  });

  it("omits the subagent brief rule when only the advisor is on", () => {
    const text = delegationGuidance({ [CROSS_ADVISOR_KEY]: advisor });
    expect(text).toContain("Advisor model:");
    expect(text).not.toContain("Subagent models");
    expect(text).not.toContain("self-contained briefs");
  });

  it("tells the model to start with agents.options and to treat output as untrusted", () => {
    const text = delegationGuidance({ [CROSS_ADVISOR_KEY]: advisor });
    expect(text).toContain("agents.options");
    expect(text).toContain("agents.wait");
    expect(text).toContain("untrusted data");
  });

  it("stays compact", () => {
    const text = delegationGuidance({
      [CROSS_SUBAGENTS_KEY]: subagents,
      [CROSS_ADVISOR_KEY]: advisor,
    });
    expect(text.split("\n").length).toBeLessThanOrEqual(10);
  });
});
