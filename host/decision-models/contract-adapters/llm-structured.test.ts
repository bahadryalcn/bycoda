import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DecisionQuestion, DecisionSource } from "../decision-types";
import { AdapterFailure, type AdapterTransport } from "./common";
import {
  buildStructuredPrompt,
  extractJson,
  llmStructuredAdapter,
  parseStructuredAnswers,
} from "./llm-structured";

const questions: Record<string, DecisionQuestion> = {
  state: {
    type: "choice",
    instructions: "Which screen is this?",
    criteria: { consent: "cookie banner", login: "login form", other: "anything else" },
  },
  hasButton: {
    type: "noul",
    instructions: "Is there a visible button?",
    criteria: { true: "yes", false: "no" },
  },
};

const sampleText = readFileSync(
  new URL("../fixtures/contract-assumption/llm-structured-text.txt", import.meta.url),
  "utf8",
);

describe("llm-structured", () => {
  it("asks for JSON probabilities per option and lists the option keys", () => {
    const prompt = buildStructuredPrompt({ url: "https://example.test" }, questions);
    expect(prompt).toContain("Reply with JSON only");
    expect(prompt).toContain('"options":["consent","login","other"]');
    expect(prompt).toContain('"options":["true","false"]');
  });

  it("extracts the JSON object from prose and a code fence (contract assumption fixture)", () => {
    const json = extractJson(sampleText) as { answers: Record<string, unknown> };
    expect(Object.keys(json.answers)).toEqual(["state", "hasButton"]);
  });

  it("turns probabilities into answers with the gateway confidence", () => {
    const output = parseStructuredAnswers(extractJson(sampleText), questions);
    expect(output.answers.state.value).toBe("login");
    // n = 3, p_max = 0.95 -> (3 * 0.95 - 1) / 2 = 0.925
    expect(output.answers.state.confidence).toBeCloseTo(0.925, 6);
    expect(output.answers.hasButton.value).toBe(true);
    expect(output.answers.hasButton.confidence).toBeCloseTo(0.97, 9);
  });

  it("refuses text without a JSON object", () => {
    expect(() => extractJson("no json here")).toThrow(AdapterFailure);
    expect(() => extractJson("{ broken")).toThrow(AdapterFailure);
  });

  it("skips a question with incomplete probabilities", () => {
    const output = parseStructuredAnswers(
      { answers: { state: { probabilities: { login: 1 } } } },
      questions,
    );
    expect(output.answers.state).toBeUndefined();
  });

  it("calls the injected text runner with the source model and returns its parsed answers", async () => {
    const transport = {
      postJson: vi.fn(),
      runTextPrompt: vi.fn(async () => sampleText),
    } as unknown as AdapterTransport;
    const source: DecisionSource = {
      id: "llm-1",
      name: "Structured LLM",
      kind: "llm",
      adapter: "llm-structured",
      model: "small-model",
      status: "ready",
    };
    const output = await llmStructuredAdapter.run({
      source,
      state: { url: "https://example.test" },
      questions,
      signal: new AbortController().signal,
      transport,
    });
    expect(transport.runTextPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ model: "small-model" }),
    );
    expect(transport.postJson).not.toHaveBeenCalled();
    expect(output.answers.state.value).toBe("login");
  });
});
