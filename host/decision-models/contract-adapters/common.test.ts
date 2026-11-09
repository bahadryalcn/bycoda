import { describe, expect, it } from "vitest";
import type { DecisionQuestion, DecisionRequest } from "../decision-types";
import {
  AdapterFailure,
  DEFAULT_ADAPTER_LIMITS,
  DecisionRequestError,
  assertValidRequest,
  distributionAnswer,
  fitsLimits,
  planChunks,
} from "./common";

const yesNo: DecisionQuestion = {
  type: "choice",
  instructions: "Pick one.",
  criteria: { yes: "Yes", no: "No" },
};

function request(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    taskType: "screen_state",
    personalData: false,
    state: { url: "https://example.test/login" },
    questions: { screen: yesNo },
    ...overrides,
  };
}

describe("assertValidRequest", () => {
  it("accepts a well-formed request", () => {
    expect(() => assertValidRequest(request())).not.toThrow();
  });

  it("rejects an unknown task type, an empty question set and a bad question name", () => {
    expect(() => assertValidRequest(request({ taskType: "unknown" as never }))).toThrow(
      DecisionRequestError,
    );
    expect(() => assertValidRequest(request({ questions: {} }))).toThrow(DecisionRequestError);
    expect(() => assertValidRequest(request({ questions: { "bad name": yesNo } }))).toThrow(
      DecisionRequestError,
    );
  });

  it("rejects a choice with one option and a score with one level", () => {
    expect(() =>
      assertValidRequest(
        request({
          questions: { screen: { type: "choice", instructions: "x", criteria: { a: "a" } } },
        }),
      ),
    ).toThrow(DecisionRequestError);
    expect(() =>
      assertValidRequest(
        request({ questions: { level: { type: "score", instructions: "x", criteria: ["only"] } } }),
      ),
    ).toThrow(DecisionRequestError);
  });

  it("rejects a timeout outside 100 to 120000 ms and a non-boolean personalData", () => {
    expect(() => assertValidRequest(request({ timeoutMs: 50 }))).toThrow(DecisionRequestError);
    expect(() => assertValidRequest(request({ timeoutMs: 200_000 }))).toThrow(DecisionRequestError);
    expect(() => assertValidRequest(request({ personalData: "yes" as never }))).toThrow(
      DecisionRequestError,
    );
  });
});

describe("fitsLimits", () => {
  it("skips choices and score levels beyond the adapter limits, never noul", () => {
    const wide: DecisionQuestion = {
      type: "choice",
      instructions: "x",
      criteria: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`o${i}`, "d"])),
    };
    expect(fitsLimits(wide, DEFAULT_ADAPTER_LIMITS)).toBe(false);
    expect(fitsLimits(yesNo, DEFAULT_ADAPTER_LIMITS)).toBe(true);
    expect(
      fitsLimits(
        { type: "noul", instructions: "x", criteria: { true: "a", false: "b" } },
        { ...DEFAULT_ADAPTER_LIMITS, maxChoices: 2 },
      ),
    ).toBe(true);
  });
});

describe("planChunks", () => {
  it("splits questions into groups of at most maxQuestions", () => {
    const questions = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`q${i}`, yesNo]));
    const chunks = planChunks({ a: 1 }, questions, { ...DEFAULT_ADAPTER_LIMITS, maxQuestions: 2 });
    expect(chunks.map((chunk) => Object.keys(chunk))).toEqual([["q0", "q1"], ["q2", "q3"], ["q4"]]);
  });

  it("splits when the request would exceed the input size", () => {
    const questions = { a: yesNo, b: yesNo };
    const single = JSON.stringify({
      state: { big: "x".repeat(40) },
      questions: { a: yesNo },
    }).length;
    const chunks = planChunks({ big: "x".repeat(40) }, questions, {
      ...DEFAULT_ADAPTER_LIMITS,
      maxInputChars: single + 5,
    });
    expect(chunks).toHaveLength(2);
  });

  it("refuses when the state or one question alone is over the limit", () => {
    expect(() =>
      planChunks(
        { big: "x".repeat(500) },
        { a: yesNo },
        { ...DEFAULT_ADAPTER_LIMITS, maxInputChars: 100 },
      ),
    ).toThrow(AdapterFailure);
  });

  it("returns no chunks for no questions", () => {
    expect(planChunks({}, {}, DEFAULT_ADAPTER_LIMITS)).toEqual([]);
  });
});

describe("distributionAnswer", () => {
  it("returns undefined for an incomplete or invalid probability object", () => {
    expect(distributionAnswer(yesNo, { yes: 0.5 }, {})).toBeUndefined();
    expect(distributionAnswer(yesNo, { yes: -1, no: 0.5 }, {})).toBeUndefined();
    expect(distributionAnswer(yesNo, undefined, {})).toBeUndefined();
  });

  it("builds a choice answer with the gateway confidence", () => {
    const answer = distributionAnswer(yesNo, { yes: 0.9, no: 0.1 }, {});
    expect(answer?.value).toBe("yes");
    expect(answer?.confidence).toBeCloseTo(0.8, 12);
  });
});
