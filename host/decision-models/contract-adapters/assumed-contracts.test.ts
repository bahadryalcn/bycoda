import { describe, expect, it, vi } from "vitest";
import decisionsFixture from "../fixtures/contract-assumption/decisions-response.json";
import ollamaFixture from "../fixtures/contract-assumption/ollama-systemone-response.json";
import type { DecisionQuestion, DecisionSource } from "../decision-types";
import type { AdapterTransport } from "./common";
import { customAdapter } from "./custom";
import { decisionsAdapter } from "./decisions";
import { ollamaSystemOneAdapter } from "./ollama-systemone";

// These fixtures are contract assumptions (D13). They prove the adapter layout and the request
// shape the Host sends. They do not prove the provider's real schema.

type Fixture = {
  request: { state: Record<string, unknown>; questions: Record<string, DecisionQuestion> };
  response: unknown;
};

function transportReturning(response: unknown): AdapterTransport {
  return {
    postJson: vi.fn(async () => response),
    runTextPrompt: vi.fn(),
  } as unknown as AdapterTransport;
}

const base = (adapter: DecisionSource["adapter"], endpoint: string): DecisionSource => ({
  id: `${adapter}-1`,
  name: adapter,
  kind: adapter === "custom" ? "api" : "local",
  adapter,
  endpoint,
  status: "ready",
});

describe("contract assumption: decisions adapter", () => {
  const fixture = decisionsFixture as unknown as Fixture;

  it("sends the System One body to the configured endpoint and parses the assumed answer layout", async () => {
    const transport = transportReturning(fixture.response);
    const output = await decisionsAdapter.run({
      source: {
        ...base("decisions", "https://gateway.example.test/api/v1/decisions"),
        model: "example-decider",
      },
      state: fixture.request.state,
      questions: fixture.request.questions,
      apiKey: "test-key-not-real",
      signal: new AbortController().signal,
      transport,
    });
    const [url, headers, body] = (transport.postJson as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0] as [string, Record<string, string>, { model?: string; questions: unknown }];
    expect(url).toBe("https://gateway.example.test/api/v1/decisions");
    expect(headers.authorization).toBe("Bearer test-key-not-real");
    expect(body.model).toBe("example-decider");
    expect(body.questions).toEqual(fixture.request.questions);
    expect(output.answers.consent.value).toBe(true);
    expect(output.answers.consent.confidence).toBeCloseTo(0.93, 9);
  });
});

describe("contract assumption: ollama-systemone adapter", () => {
  const fixture = ollamaFixture as unknown as Fixture;

  it("parses the assumed choice layout and gives the gateway confidence", async () => {
    const transport = transportReturning(fixture.response);
    const output = await ollamaSystemOneAdapter.run({
      source: base("ollama-systemone", "http://127.0.0.1:11434/api/systemone"),
      state: fixture.request.state,
      questions: fixture.request.questions,
      signal: new AbortController().signal,
      transport,
    });
    expect(output.answers.intent.value).toBe("help");
    // n = 3, p_max = 0.7 -> (3 * 0.7 - 1) / 2 = 0.55
    expect(output.answers.intent.confidence).toBeCloseTo(0.55, 9);
  });
});

describe("contract assumption: custom adapter", () => {
  it("posts the System One layout to the configured endpoint", async () => {
    const fixture = ollamaFixture as unknown as Fixture;
    const transport = transportReturning(fixture.response);
    await expect(
      customAdapter.run({
        source: base("custom", "http://custom.example.test/v1/systemone"),
        state: fixture.request.state,
        questions: fixture.request.questions,
        signal: new AbortController().signal,
        transport,
      }),
    ).resolves.toBeDefined();
    // The endpoint rule (HTTPS or loopback) lives in the HTTP transport, tested in http.test.ts.
    expect(transport.postJson).toHaveBeenCalledWith(
      "http://custom.example.test/v1/systemone",
      expect.any(Object),
      expect.any(Object),
      expect.any(AbortSignal),
    );
  });
});
