import { describe, expect, it } from "vitest";
import { humanizeModelId } from "./modelNameFromId";

describe("humanizeModelId", () => {
  it.each([
    ["claude-opus-5-5", "Claude Opus 5.5"],
    ["claude-haiku-4-5-20251001", "Claude Haiku 4.5"],
    ["claude-3-5-sonnet-20241022", "Claude 3.5 Sonnet"],
    ["claude:opus-4.6", "Opus 4.6"],
    ["claude-sonnet-4-6[1m]", "Claude Sonnet 4.6 (1M context)"],
    ["gpt-5.4", "GPT-5.4"],
    ["gpt-5.6-sol", "GPT-5.6-Sol"],
    ["gpt-5.4-codex-mini", "GPT-5.4-Codex-Mini"],
    ["o4-mini", "o4 Mini"],
    ["gemini-3-flash-preview", "Gemini 3 Flash Preview"],
    ["gemini-2.5-pro-2025-06-17", "Gemini 2.5 Pro"],
    ["deepseek-v4-flash", "DeepSeek V4 Flash"],
    ["openrouter/meta/llama-3.3-70b-instruct", "Llama 3.3 70B Instruct"],
    ["glm-5.2", "GLM 5.2"],
    ["kimi_k2_5", "Kimi K2 5"],
  ])("turns %s into %s", (id, name) => {
    expect(humanizeModelId(id)).toBe(name);
  });

  it("never returns an empty name for a non-empty id", () => {
    expect(humanizeModelId(" - ")).toBe("-");
    expect(humanizeModelId("")).toBe("");
  });
});
