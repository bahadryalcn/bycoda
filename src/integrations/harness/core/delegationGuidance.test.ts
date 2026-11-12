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
    expect(text).toContain(
      "Subagent models: Codex gpt-6.1-sol (default account) [codex:gpt-6.1-sol], Cursor composer (default account) [cursor:composer]. Pass the bracketed ref as agents.delegate model.",
    );
    expect(text).toContain("Advisor model: Claude Code claude:opus-5-5 (default account).");
    expect(text).toContain("read-only");
    // Children are fresh sessions; the hint must say what they do not see.
    expect(text).toContain("sees only the question and context you send");
    expect(text).toContain("no conversation context");
    expect(text).toContain("cannot commit, push or install");
  });

  it("omits the advisor lines when only subagents are on", () => {
    const text = delegationGuidance({ [CROSS_SUBAGENTS_KEY]: subagents });
    expect(text).toContain("Subagent models:");
    expect(text).not.toContain("Advisor model");
    expect(text).not.toContain("Consult the advisor");
    // Owner decision: splittable work is delegated unasked, with no routing between models.
    expect(text).toContain("Delegate without being asked when a request splits");
    expect(text).toContain("Set agents.delegate effort to what each part needs");
    expect(text).toContain("Do small, sequential or single-file work yourself");
    expect(text).toContain("usefulness first, then cost");
    expect(text).not.toContain("always use it");
  });

  it("does not ask an advisor-only session to delegate", () => {
    const text = delegationGuidance({ [CROSS_ADVISOR_KEY]: advisor });
    expect(text).toContain("Consulting is optional");
    expect(text).not.toContain("Delegate without being asked");
  });

  it("omits the subagent brief rule when only the advisor is on", () => {
    const text = delegationGuidance({ [CROSS_ADVISOR_KEY]: advisor });
    expect(text).toContain("Advisor model:");
    expect(text).not.toContain("Subagent models");
    expect(text).not.toContain("child sessions in this project folder");
  });

  it("names the agents tools and treats output as untrusted", () => {
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

  it("names the native subagent tool only when it is fixed to one selected model", () => {
    const mixed =
      encodeSubagents([
        { harness: "codex", model: "codex:gpt-6.1-terra" },
        { harness: "claude", model: "claude:haiku", providerAccountId: "work" },
      ]) ?? "";
    const claude = delegationGuidance(
      { [CROSS_SUBAGENTS_KEY]: mixed },
      { harness: "claude", providerAccountId: "work" },
    );
    expect(claude).toContain("native subagent tool is fixed to Claude Code claude:haiku");
    expect(claude).toContain("Never substitute a different account or model");
    const codex = delegationGuidance(
      { [CROSS_SUBAGENTS_KEY]: mixed },
      { harness: "codex", providerAccountId: "work" },
    );
    expect(codex).not.toContain("native subagent tool");
    const otherAccount = delegationGuidance(
      { [CROSS_SUBAGENTS_KEY]: mixed },
      { harness: "claude", providerAccountId: "personal" },
    );
    expect(otherAccount).not.toContain("native subagent tool");
  });

  it("says the built-in subagent tool is disabled whenever it is not fixed to one model", () => {
    const accounts =
      encodeSubagents([
        { harness: "claude", model: "claude:opus-5-5", providerAccountId: "one" },
        { harness: "claude", model: "claude:sonnet-5-5", providerAccountId: "two" },
        { harness: "claude", model: "claude:haiku-5-5", providerAccountId: "three" },
        { harness: "codex", model: "codex:gpt-6.1-sol", providerAccountId: "work" },
      ]) ?? "";
    const settings = { [CROSS_SUBAGENTS_KEY]: accounts };
    // Main session on account one: Opus is the one native pick, the rest delegate.
    expect(delegationGuidance(settings, { harness: "claude", providerAccountId: "one" })).toContain(
      "native subagent tool is fixed to Claude Code claude:opus-5-5 (account one)",
    );
    const elsewhere = delegationGuidance(settings, {
      harness: "claude",
      providerAccountId: "four",
    });
    expect(elsewhere).toContain("built-in subagent tool (Agent/Task) is disabled");
    expect(elsewhere).toContain("[claude:sonnet-5-5@two]");
    expect(elsewhere).toContain("[codex:gpt-6.1-sol@work]");
    expect(delegationGuidance(settings, { harness: "codex" })).toContain(
      "built-in subagent tools are disabled",
    );
    // Advisor-only sessions keep native subagents; nothing is said about them.
    expect(
      delegationGuidance({ [CROSS_ADVISOR_KEY]: advisor }, { harness: "claude" }),
    ).not.toContain("disabled");
  });
});

it("Automatic lists tier groups within ten lines and names a ceiling only when set", () => {
  const text = delegationGuidance(
    { crossSubagents: "auto", crossSubagentMaxEffort: "max" },
    { harness: "claude" },
  );
  expect(text).toContain("best:");
  expect(text).toContain("unranked:");
  expect(text).toContain("lowest tier");
  expect(text).toContain("ceiling: max");
  expect(text.split("\n").length).toBeLessThanOrEqual(10);
  expect(delegationGuidance({ crossSubagents: "auto" })).not.toContain("ceiling:");
});
