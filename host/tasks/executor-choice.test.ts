import { describe, expect, it, vi } from "vitest";
import type { DecisionRequest, DecisionResult } from "../decision-models/decision-types";
import { chooseExecutor, type ExecutorChoiceDeps } from "./executor-choice";

const crews = [
  { id: "web", name: "Web crew", summary: "Lead (coordinator), UI (specialist)" },
  { id: "docs", name: "Docs crew", summary: "Writer (specialist)" },
];
const task = (patch: Record<string, unknown> = {}) =>
  ({
    executor: { kind: "auto" },
    projectId: "project",
    prompt: "Redesign the settings page",
    request: "Redesign the settings page",
    ...patch,
  }) as Parameters<typeof chooseExecutor>[1];
const answering = (answer: DecisionResult["answers"][string] | undefined) => {
  const decide = vi.fn(async (_request: DecisionRequest): Promise<DecisionResult> => ({
    answers: answer ? { executor: answer } : {},
    sourceChain: [],
    durationMs: 1,
  }));
  const deps: ExecutorChoiceDeps = { crews: async () => crews, decisions: { decide } };
  return { decide, deps };
};
const confident = (value: string, confidence = 0.93) => ({
  value,
  confidence,
  sourceId: "local",
  model: "m",
});

describe("chooseExecutor", () => {
  it("returns an explicit agent or crew without asking anyone", async () => {
    const { decide, deps } = answering(undefined);
    expect(await chooseExecutor(deps, task({ executor: undefined }))).toEqual({
      executor: { kind: "agent" },
    });
    const crew = { kind: "crew", crewDefinitionId: "web" };
    expect(await chooseExecutor(deps, task({ executor: crew }))).toEqual({ executor: crew });
    expect(decide).not.toHaveBeenCalled();
  });

  it("asks one choice question with the request, each crew and an agent option", async () => {
    const { decide, deps } = answering(confident("web"));
    const result = await chooseExecutor(deps, task());
    expect(result.executor).toEqual({ kind: "crew", crewDefinitionId: "web" });
    expect(result.reason).toMatch(/Chose crew Web crew \(confidence 93%\)/);
    expect(decide).toHaveBeenCalledOnce();
    const request = decide.mock.calls[0]![0];
    // The owner's own words may be personal: only local sources may read them.
    expect(request).toMatchObject({ taskType: "generic", personalData: true });
    expect(request.state).toEqual({ request: "Redesign the settings page" });
    const question = request.questions.executor!;
    expect(question.type).toBe("choice");
    expect(Object.keys((question as { criteria: object }).criteria)).toEqual([
      "agent",
      "web",
      "docs",
    ]);
  });

  it.each([
    ["the gate is unsure", { error: "below_threshold" as const }],
    ["the gate has no source", { error: "unavailable" as const }],
    ["it names something that is not offered", confident("ghost")],
    ["it prefers the agent", confident("agent")],
    ["it answers nothing", undefined],
  ])("runs one agent when %s", async (_name, answer) => {
    const { deps } = answering(answer);
    const result = await chooseExecutor(deps, task());
    expect(result.executor).toEqual({ kind: "agent" });
    expect(result.reason).toBeTruthy();
  });

  it("runs one agent when the gate throws", async () => {
    const deps: ExecutorChoiceDeps = {
      crews: async () => crews,
      decisions: {
        decide: async () => {
          throw new Error("down");
        },
      },
    };
    expect((await chooseExecutor(deps, task())).executor).toEqual({ kind: "agent" });
  });

  it("runs one agent, saying why, when no crew fits the task's own options", async () => {
    const { decide, deps } = answering(confident("web"));
    for (const [patch, field] of [
      [{ isolate: true }, "isolate"],
      [{ review: true }, "review"],
      [{ workspace: { branch: "main" } }, "workspace"],
      [{ modelChoice: { kind: "fixed" } }, "model"],
    ] as const) {
      const result = await chooseExecutor(deps, task(patch));
      expect(result.executor).toEqual({ kind: "agent" });
      expect(result.reason).toContain(field);
    }
    expect(decide).not.toHaveBeenCalled();
  });

  it("runs one agent when the project has no crew or the host cannot run them", async () => {
    const { decide, deps } = answering(confident("web"));
    expect((await chooseExecutor({ ...deps, crews: async () => [] }, task())).reason).toMatch(
      /No crew is available/,
    );
    expect((await chooseExecutor({ ...deps, crews: undefined }, task())).reason).toMatch(
      /unavailable/,
    );
    expect(decide).not.toHaveBeenCalled();
  });

  it("keeps the first choice on every later pass", async () => {
    const { decide, deps } = answering(confident("docs"));
    const resolved = {
      executor: { kind: "agent" as const },
      reason: "No crew fits.",
    } as never;
    expect(await chooseExecutor(deps, task({ resolved }))).toEqual({
      executor: { kind: "agent" },
      reason: "No crew fits.",
    });
    expect(decide).not.toHaveBeenCalled();
  });
});
