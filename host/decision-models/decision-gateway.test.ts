import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import verified from "./fixtures/clef/verified-cases.json";
import { createDecisionGateway, type DecisionGatewayDeps } from "./decision-gateway";
import { EVALUATION_SET } from "./evaluation";
import { DecisionRequestError } from "./contract-adapters/common";
import {
  DEFAULT_THRESHOLD,
  type DecisionConfig,
  type DecisionQuestion,
  type DecisionRequest,
  type DecisionSource,
} from "./decision-types";
import { defaultDecisionConfig } from "./decision-config";

type ClefCase = {
  name: string;
  request: { state: Record<string, unknown> | string; questions: Record<string, DecisionQuestion> };
  response: Record<string, unknown>;
  expected: string | boolean;
};
type ClefRequestCase = Omit<ClefCase, "request"> & {
  request: { state: Record<string, unknown>; questions: Record<string, DecisionQuestion> };
};

const clefCases = (verified as unknown as { cases: ClefCase[] }).cases;
/** Some recorded cases keep state as plain text; the request contract takes an object (`{ text }`, as in EVALUATION_SET). */
const clef = (name: string): ClefRequestCase => {
  const entry = clefCases.find((item) => item.name === name) as ClefCase;
  const state =
    typeof entry.request.state === "string" ? { text: entry.request.state } : entry.request.state;
  return { ...entry, request: { ...entry.request, state } };
};

const LOCAL = "http://127.0.0.1:8767/v1/systemone";
const REMOTE = "https://api.example.test/v1/systemone";

const localClef: DecisionSource = {
  id: "local-clef",
  name: "Clef",
  kind: "local",
  adapter: "systemone",
  endpoint: LOCAL,
  model: "clef-flash",
  status: "ready",
};

const yesNo: DecisionQuestion = {
  type: "choice",
  instructions: "Pick one.",
  criteria: { yes: "Yes", no: "No" },
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function config(
  sources: DecisionSource[],
  overrides: Partial<DecisionConfig> = {},
): DecisionConfig {
  return { ...defaultDecisionConfig(), sources, ...overrides };
}

function build(
  cfg: DecisionConfig,
  options: Partial<DecisionGatewayDeps> & {
    fetchImpl?: (
      url: string,
      body: Record<string, unknown>,
      init: RequestInit,
    ) => Response | Promise<Response>;
  } = {},
) {
  let clock = 1_700_000_000_000;
  const fetchImpl = options.fetchImpl ?? (() => jsonResponse(clef("C01-business-area").response));
  const fetcher = vi.fn(async (url: string, init: RequestInit) =>
    fetchImpl(url, JSON.parse(String(init.body)) as Record<string, unknown>, init),
  );
  const sleep = vi.fn(async () => undefined);
  const gateway = createDecisionGateway({
    loadConfig: async () => cfg,
    fetcher: fetcher as unknown as typeof fetch,
    sleep,
    now: () => clock,
    secrets: options.secrets,
    runTextPrompt: options.runTextPrompt,
  });
  return {
    gateway,
    fetcher,
    sleep,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const request = (overrides: Partial<DecisionRequest> = {}): DecisionRequest => ({
  taskType: "screen_state",
  personalData: false,
  state: { text: "x" },
  questions: { screen: yesNo },
  ...overrides,
});

/** Answers each evaluation case from its expected value, so the evaluation accuracy is measurable. */
function evaluationReply(body: { state: unknown; questions: Record<string, DecisionQuestion> }) {
  const [name, question] = Object.entries(body.questions)[0];
  const match = EVALUATION_SET.find(
    (entry) =>
      JSON.stringify(entry.state) === JSON.stringify(body.state) &&
      entry.question.instructions === question.instructions,
  );
  if (!match) return { answers: {} };
  if (question.type === "noul")
    return { answers: { [name]: { type: "noul", noul: match.expected ? 0.95 : 0.05 } } };
  const keys =
    question.type === "choice"
      ? Object.keys(question.criteria)
      : question.criteria.map((_, i) => String(i));
  const hot = String(match.expected);
  const probabilities = Object.fromEntries(
    keys.map((key) => [key, key === hot ? 0.97 : 0.03 / (keys.length - 1)]),
  );
  return {
    answers: {
      [name]:
        question.type === "choice"
          ? { type: "choice", choice: hot, probabilities }
          : { type: "score", probabilities },
    },
  };
}

describe("decide: answering and threshold", () => {
  it("answers a choice question from the local Clef source with the recorded value", async () => {
    const c01 = clef("C01-business-area");
    const { gateway, fetcher } = build(config([localClef]));
    const result = await gateway.decide({
      taskType: "screen_state",
      personalData: false,
      state: c01.request.state,
      questions: c01.request.questions,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const answer = result.answers.answer as { value: string; sourceId: string; confidence: number };
    expect(answer.value).toBe("Onboarding");
    expect(answer.sourceId).toBe("local-clef");
    expect(answer.confidence).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    expect(result.sourceChain).toEqual(["local-clef"]);
  });

  it("sends all questions of one step in one request and answers each", async () => {
    const c01 = clef("C01-business-area");
    const c07 = clef("C07-consent-negative");
    const c11 = clef("C11-score-not-started");
    const reply = {
      answers: {
        a: (c01.response.answers as Record<string, unknown>).answer,
        b: (c07.response.answers as Record<string, unknown>).answer,
        c: (c11.response.answers as Record<string, unknown>).answer,
      },
    };
    const { gateway, fetcher } = build(config([localClef]), {
      fetchImpl: () => jsonResponse(reply),
    });
    const result = await gateway.decide({
      taskType: "generic",
      personalData: false,
      state: { text: "batch" },
      questions: {
        a: c01.request.questions.answer,
        b: c07.request.questions.answer,
        c: c11.request.questions.answer,
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetcher.mock.calls[0][1].body)) as {
      questions: Record<string, unknown>;
    };
    expect(Object.keys(sent.questions)).toEqual(["a", "b", "c"]);
    expect(result.answers.a).toMatchObject({ value: "Onboarding" });
    expect(result.answers.b).toMatchObject({ value: false });
    expect(result.answers.c).toMatchObject({ value: 0 });
  });

  it("splits more than eight questions into two requests", async () => {
    const questions = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `q${i}`,
        { type: "noul" as const, instructions: "Is it?", criteria: { true: "yes", false: "no" } },
      ]),
    );
    const { gateway, fetcher } = build(config([localClef]), {
      fetchImpl: (_url, body) => {
        const names = Object.keys(body.questions as Record<string, unknown>);
        return jsonResponse({
          answers: Object.fromEntries(names.map((name) => [name, { type: "noul", noul: 0.99 }])),
        });
      },
    });
    const result = await gateway.decide(request({ questions }));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      Object.values(result.answers).every((answer) => "value" in answer && answer.value === true),
    ).toBe(true);
  });

  it("falls to the next source when the first answer is below the threshold", async () => {
    const local = { ...localClef, id: "local-a", endpoint: "http://127.0.0.1:9000/v1/systemone" };
    const api: DecisionSource = {
      id: "api",
      name: "API",
      kind: "api",
      adapter: "systemone",
      endpoint: REMOTE,
      status: "ready",
    };
    const { gateway, fetcher } = build(config([api, local]), {
      fetchImpl: (url) =>
        url.startsWith("http://127.0.0.1")
          ? jsonResponse({
              answers: {
                screen: { type: "choice", choice: "yes", probabilities: { yes: 0.5, no: 0.5 } },
              },
            })
          : jsonResponse({
              answers: {
                screen: { type: "choice", choice: "yes", probabilities: { yes: 0.99, no: 0.01 } },
              },
            }),
    });
    const result = await gateway.decide(request());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.sourceChain).toEqual(["local-a", "api"]);
    expect(result.answers.screen).toMatchObject({ value: "yes", sourceId: "api" });
  });

  it("reports below_threshold when every source is under the threshold, and unavailable when none is configured", async () => {
    const uniform = () =>
      jsonResponse({
        answers: {
          screen: { type: "choice", choice: "yes", probabilities: { yes: 0.5, no: 0.5 } },
        },
      });
    const below = build(config([localClef]), { fetchImpl: uniform });
    expect((await below.gateway.decide(request())).answers.screen).toEqual({
      error: "below_threshold",
    });
    const none = build(config([]));
    expect((await none.gateway.decide(request())).answers.screen).toEqual({ error: "unavailable" });
    expect(none.fetcher).not.toHaveBeenCalled();
  });

  it("does not call a source when a question exceeds its choice limit", async () => {
    const wide: DecisionQuestion = {
      type: "choice",
      instructions: "Many options.",
      criteria: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`o${i}`, "d"])),
    };
    const { gateway, fetcher } = build(config([localClef]));
    const result = await gateway.decide(request({ questions: { wide } }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.answers.wide).toEqual({ error: "unavailable" });
  });

  it("rejects an invalid request before any source is called", async () => {
    const { gateway, fetcher } = build(config([localClef]));
    await expect(gateway.decide(request({ timeoutMs: 50 }))).rejects.toBeInstanceOf(
      DecisionRequestError,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("decide: personal data, keys and retries", () => {
  it("sends personal data only to local sources when local-only is on", async () => {
    const api: DecisionSource = {
      id: "api",
      name: "API",
      kind: "api",
      adapter: "systemone",
      endpoint: REMOTE,
      status: "ready",
    };
    const c01 = clef("C01-business-area");
    const { gateway, fetcher } = build(config([api, localClef], { localOnlyPersonalData: true }));
    const result = await gateway.decide({
      taskType: "audience_classify",
      personalData: true,
      state: c01.request.state,
      questions: c01.request.questions,
    });
    expect(fetcher.mock.calls.every(([url]) => String(url) === LOCAL)).toBe(true);
    expect(result.answers.answer).toMatchObject({ value: "Onboarding" });
  });

  it("returns unavailable for personal data when only remote sources are routed", async () => {
    const api: DecisionSource = {
      id: "api",
      name: "API",
      kind: "api",
      adapter: "systemone",
      endpoint: REMOTE,
      status: "ready",
    };
    const { gateway, fetcher } = build(config([api], { localOnlyPersonalData: true }));
    const result = await gateway.decide(request({ personalData: true }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.answers.screen).toEqual({ error: "unavailable" });
  });

  it("sends a stored key only as a bearer header to a remote source", async () => {
    const api: DecisionSource = {
      id: "api",
      name: "API",
      kind: "api",
      adapter: "systemone",
      endpoint: REMOTE,
      secretRef: "decision-models.api",
      status: "ready",
    };
    const secrets = { get: vi.fn(async () => "test-key-not-real"), set: vi.fn(), delete: vi.fn() };
    const { gateway, fetcher } = build(config([api]), {
      secrets,
      fetchImpl: () =>
        jsonResponse({
          answers: {
            screen: { type: "choice", choice: "yes", probabilities: { yes: 0.99, no: 0.01 } },
          },
        }),
    });
    await gateway.decide(request());
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key-not-real");
    expect(secrets.get).toHaveBeenCalledWith("decision-models.api");
  });

  it("does not call a source whose key is missing, and records missing_key in the audit", async () => {
    const api: DecisionSource = {
      id: "api",
      name: "API",
      kind: "api",
      adapter: "systemone",
      endpoint: REMOTE,
      secretRef: "decision-models.api",
      status: "ready",
    };
    const { gateway, fetcher } = build(config([api]), { secrets: { get: async () => undefined } });
    const result = await gateway.decide(request());
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.answers.screen).toEqual({ error: "unavailable" });
    expect(gateway.recentAudit().at(-1)?.errorCode).toBe("missing_key");
  });

  it("retries a 503 once with backoff and then answers", async () => {
    const c01 = clef("C01-business-area");
    let attempt = 0;
    const { gateway, fetcher, sleep } = build(config([localClef]), {
      fetchImpl: () => {
        attempt += 1;
        return attempt === 1 ? new Response("", { status: 503 }) : jsonResponse(c01.response);
      },
    });
    const result = await gateway.decide({
      taskType: "generic",
      personalData: false,
      state: c01.request.state,
      questions: c01.request.questions,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250, expect.anything());
    expect(result.answers.answer).toMatchObject({ value: "Onboarding" });
  });

  it("does not retry a 401 and records the auth error without the response body", async () => {
    const { gateway, fetcher } = build(config([localClef]), {
      fetchImpl: () => new Response("provider says: secret detail", { status: 401 }),
    });
    const result = await gateway.decide(request());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.answers.screen).toEqual({ error: "unavailable" });
    const entry = gateway.recentAudit().at(-1);
    expect(entry).toMatchObject({ outcome: "unavailable", errorCode: "auth" });
    expect(JSON.stringify(gateway.recentAudit())).not.toContain("secret detail");
  });
});

describe("cache and audit", () => {
  it("reuses an answer for the same state and source until the TTL expires", async () => {
    const c01 = clef("C01-business-area");
    const { gateway, fetcher, advance } = build(config([localClef]));
    const input = {
      taskType: "generic" as const,
      personalData: false,
      state: c01.request.state,
      questions: c01.request.questions,
    };
    await gateway.decide(input);
    await gateway.decide(input);
    expect(fetcher).toHaveBeenCalledTimes(1);
    advance(10 * 60_000 + 1);
    await gateway.decide(input);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps state and answer content out of the audit", async () => {
    const c01 = clef("C01-business-area");
    const { gateway } = build(config([localClef]));
    await gateway.decide({
      taskType: "generic",
      personalData: false,
      state: c01.request.state,
      questions: c01.request.questions,
    });
    const audit = JSON.stringify(gateway.recentAudit());
    expect(audit).not.toContain("merchant");
    expect(audit).not.toContain("Onboarding");
    expect(gateway.recentAudit()[0]).toMatchObject({
      sourceId: "local-clef",
      adapter: "systemone",
      outcome: "answered",
    });
  });
});

describe("llm-structured through the injected runner", () => {
  it("answers from the text runner's JSON probabilities", async () => {
    const text = readFileSync(
      new URL("./fixtures/contract-assumption/llm-structured-text.txt", import.meta.url),
      "utf8",
    );
    const llm: DecisionSource = {
      id: "llm",
      name: "LLM",
      kind: "llm",
      adapter: "llm-structured",
      model: "small",
      status: "ready",
    };
    const runTextPrompt = vi.fn(async () => text);
    const { gateway, fetcher } = build(config([llm]), { runTextPrompt });
    const result = await gateway.decide({
      taskType: "generic",
      personalData: false,
      state: { url: "https://example.test" },
      questions: {
        state: {
          type: "choice",
          instructions: "Which screen?",
          criteria: { consent: "cookie", login: "login", other: "other" },
        },
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(runTextPrompt).toHaveBeenCalledWith(expect.objectContaining({ model: "small" }));
    expect(result.answers.state).toMatchObject({ value: "login" });
  });
});

describe("test and evaluate", () => {
  it("test reports ok for a responding source and unavailable for an unknown id", async () => {
    const { gateway } = build(config([localClef]), {
      fetchImpl: (_url, body) => jsonResponse(evaluationReply(body as never)),
    });
    expect(await gateway.test("local-clef")).toMatchObject({ ok: true, sourceId: "local-clef" });
    expect(await gateway.test("missing")).toMatchObject({ ok: false, error: "unavailable" });
  });

  it("evaluate reports full accuracy for a source that answers every case correctly", async () => {
    const { gateway, fetcher } = build(config([localClef]), {
      fetchImpl: (_url, body) => jsonResponse(evaluationReply(body as never)),
    });
    const result = await gateway.evaluate("local-clef");
    expect(fetcher).toHaveBeenCalledTimes(EVALUATION_SET.length);
    expect(result).toMatchObject({
      sourceId: "local-clef",
      cases: EVALUATION_SET.length,
      accuracy: 1,
    });
  });

  it("evaluate reports unavailable when the source gives no answers", async () => {
    const { gateway } = build(config([localClef]), {
      fetchImpl: () => jsonResponse({ answers: {} }),
    });
    expect(await gateway.evaluate("local-clef")).toMatchObject({ error: "unavailable" });
  });
});
