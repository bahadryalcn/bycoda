import { describe, expect, it, vi } from "vitest";
import verified from "../fixtures/clef/verified-cases.json";
import type { DecisionQuestion, DecisionSource } from "../decision-types";
import { AdapterFailure, type AdapterTransport } from "./common";
import { parseSystemOneAnswers, systemOneAdapter, systemOneBody } from "./systemone";

type FixtureCase = {
  name: string;
  request: { state: Record<string, unknown>; questions: Record<string, DecisionQuestion> };
  response: {
    answers: Record<
      string,
      {
        type: string;
        choice?: string;
        noul?: number;
        probabilities?: Record<string, number>;
        confidence?: number;
      }
    >;
  };
  expected: string | boolean;
};

const cases = (verified as unknown as { cases: FixtureCase[] }).cases;
const CLEF_ENDPOINT = "http://127.0.0.1:8767/v1/systemone";

const clefSource: DecisionSource = {
  id: "clef-local",
  name: "Clef",
  kind: "local",
  adapter: "systemone",
  endpoint: CLEF_ENDPOINT,
  model: "clef-flash",
  status: "ready",
};

describe("System One parser against the recorded Clef run", () => {
  for (const fixtureCase of cases) {
    it(`parses ${fixtureCase.name} to the expected value`, () => {
      const output = parseSystemOneAnswers(fixtureCase.response, fixtureCase.request.questions);
      const answer = output.answers.answer;
      expect(answer).toBeDefined();
      expect(String(answer.value)).toBe(String(fixtureCase.expected));
      expect(answer.confidence).toBeGreaterThanOrEqual(0);
      expect(answer.confidence).toBeLessThanOrEqual(1);
    });
  }

  it("matches Clef's own confidence for every choice case", () => {
    for (const fixtureCase of cases.filter(
      (entry) => entry.response.answers.answer.type === "choice",
    )) {
      const output = parseSystemOneAnswers(fixtureCase.response, fixtureCase.request.questions);
      const clefConfidence = fixtureCase.response.answers.answer.confidence ?? Number.NaN;
      expect(output.answers.answer.confidence, fixtureCase.name).toBeCloseTo(clefConfidence, 9);
    }
  });

  it("uses max(p, 1 - p) for noul, so Clef's P(true) is kept as the probability", () => {
    const consentNegative = cases.find((entry) => entry.name === "C07-consent-negative");
    expect(consentNegative).toBeDefined();
    const output = parseSystemOneAnswers(
      consentNegative!.response,
      consentNegative!.request.questions,
    );
    const pTrue = consentNegative!.response.answers.answer.noul ?? Number.NaN;
    expect(output.answers.answer.value).toBe(false);
    expect(output.answers.answer.probabilities.true).toBeCloseTo(pTrue, 12);
    expect(output.answers.answer.confidence).toBeCloseTo(1 - pTrue, 12);
  });

  it("uses its own score confidence, not Clef's, and the score value is the most probable level", () => {
    const completed = cases.find((entry) => entry.name === "C12-score-completed");
    expect(completed).toBeDefined();
    const output = parseSystemOneAnswers(completed!.response, completed!.request.questions);
    const probabilities = Object.values(completed!.response.answers.answer.probabilities ?? {});
    const max = Math.max(...probabilities);
    expect(output.answers.answer.value).toBe(2);
    expect(output.answers.answer.confidence).toBeCloseTo((3 * max - 1) / 2, 9);
  });

  it("reports input tokens from usage", () => {
    const first = cases[0];
    expect(parseSystemOneAnswers(first.response, first.request.questions).inputTokens).toBe(214);
  });
});

describe("System One parser rejects or skips bad answers", () => {
  const questions: Record<string, DecisionQuestion> = {
    answer: {
      type: "choice",
      instructions: "Pick one.",
      criteria: { yes: "Yes", no: "No" },
    },
  };

  it("fails the whole response when it has no answers object", () => {
    expect(() => parseSystemOneAnswers({ model: "x" }, questions)).toThrow(AdapterFailure);
  });

  it("skips a question whose reported choice disagrees with its probabilities", () => {
    const output = parseSystemOneAnswers(
      {
        answers: { answer: { type: "choice", choice: "no", probabilities: { yes: 0.9, no: 0.1 } } },
      },
      questions,
    );
    expect(output.answers.answer).toBeUndefined();
  });

  it("skips a question with the wrong answer type or missing probabilities", () => {
    const output = parseSystemOneAnswers(
      { answers: { answer: { type: "noul", noul: 0.9 } } },
      questions,
    );
    expect(output.answers.answer).toBeUndefined();
  });
});

describe("System One adapter request", () => {
  it("builds the body from the model, state and questions", () => {
    const call = {
      source: clefSource,
      state: { text: "x" },
      questions: {
        answer: { type: "noul" as const, instructions: "?", criteria: { true: "a", false: "b" } },
      },
      signal: new AbortController().signal,
      transport: {} as AdapterTransport,
    };
    expect(systemOneBody(call)).toEqual({
      model: "clef-flash",
      state: { text: "x" },
      questions: call.questions,
    });
  });

  it("sends no authorization header without a key (local Clef)", async () => {
    const response = cases[0].response;
    const transport = {
      postJson: vi.fn(async () => response),
      runTextPrompt: vi.fn(),
    } as unknown as AdapterTransport;
    const output = await systemOneAdapter.run({
      source: clefSource,
      state: { text: "x" },
      questions: cases[0].request.questions,
      signal: new AbortController().signal,
      transport,
    });
    expect(transport.postJson).toHaveBeenCalledTimes(1);
    const [url, headers] = (transport.postJson as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0] as [string, Record<string, string>];
    expect(url).toBe(CLEF_ENDPOINT);
    expect(headers.authorization).toBeUndefined();
    expect(output.answers.answer.value).toBe("Onboarding");
  });

  it("sends the bearer key only in the header, never in the body", async () => {
    const transport = {
      postJson: vi.fn(async () => cases[0].response),
      runTextPrompt: vi.fn(),
    } as unknown as AdapterTransport;
    await systemOneAdapter.run({
      source: { ...clefSource, endpoint: "https://api.example.test/v1/systemone" },
      state: { text: "x" },
      questions: cases[0].request.questions,
      apiKey: "test-key-not-real",
      signal: new AbortController().signal,
      transport,
    });
    const [, headers, body] = (transport.postJson as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0] as [string, Record<string, string>, unknown];
    expect(headers.authorization).toBe("Bearer test-key-not-real");
    expect(JSON.stringify(body)).not.toContain("test-key-not-real");
  });

  it("refuses to run without an endpoint", async () => {
    const transport = { postJson: vi.fn(), runTextPrompt: vi.fn() } as unknown as AdapterTransport;
    await expect(
      systemOneAdapter.run({
        source: { ...clefSource, endpoint: undefined },
        state: {},
        questions: cases[0].request.questions,
        signal: new AbortController().signal,
        transport,
      }),
    ).rejects.toMatchObject({ code: "not_configured" });
    expect(transport.postJson).not.toHaveBeenCalled();
  });
});
