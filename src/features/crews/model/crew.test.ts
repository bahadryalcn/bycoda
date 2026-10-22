import { describe, expect, it } from "vitest";
import {
  defaultCrewPolicy,
  parseCrewDefinition,
  selectCrewCandidate,
  crewScopesOverlap,
  parseCrewScopes,
  type CrewAgent,
  type CrewCandidate,
} from "./crew";

const candidate = (id: string, cost?: number, quality?: number): CrewCandidate => ({
  id,
  harness: "codex",
  model: id,
  modelSettings: {},
  capabilities: {},
  cost,
  quality,
});
const agent = (
  candidates: CrewCandidate[],
  selection: CrewAgent["selection"] = "automatic",
): CrewAgent => ({
  id: "worker",
  name: "Worker",
  role: "specialist",
  instructions: "",
  candidates,
  selection,
});
describe("crew allocation", () => {
  it("normalizes file leases and blocks traversal and overlapping scopes", () => {
    expect(parseCrewScopes(["./src/./ui/", "src\\backend", "."])).toEqual([
      "src/ui",
      "src/backend",
      ".",
    ]);
    expect(() => parseCrewScopes(["../outside"])).toThrow();
    expect(crewScopesOverlap(["src/ui"], ["src/ui/Button.tsx"])).toBe(true);
    expect(crewScopesOverlap(["src/ui"], ["src/backend"])).toBe(false);
    expect(crewScopesOverlap(["."], ["src/backend"])).toBe(true);
  });
  it("filters missing capabilities before considering quality or cost", () => {
    const cheap = candidate("cheap", 0, 100);
    const image = {
      ...candidate("image", 5, 80),
      capabilities: {
        "image-generation": { state: "available" as const, observedAt: 1000, source: "probe" },
      },
    };
    expect(
      selectCrewCandidate(
        agent([cheap, image]),
        defaultCrewPolicy,
        ["image-generation"],
        () => true,
        1001,
      ).candidate.id,
    ).toBe("image");
    expect(() =>
      selectCrewCandidate(
        agent([image]),
        defaultCrewPolicy,
        ["image-generation"],
        () => true,
        1000 + 86400000,
      ),
    ).toThrow("No eligible");
    expect(() =>
      selectCrewCandidate(
        agent([image]),
        defaultCrewPolicy,
        ["image-generation"],
        () => false,
        1001,
      ),
    ).toThrow("No eligible");
  });
  it("does not escape a fixed model pin", () => {
    expect(() =>
      selectCrewCandidate(
        agent([candidate("fixed"), candidate("fallback")], "fixed"),
        defaultCrewPolicy,
        [],
        (c) => c.id === "fallback",
      ),
    ).toThrow("No eligible");
  });
  it("distinguishes unknown costs from zero and applies hard thresholds first", () => {
    const options = agent([
      candidate("unknown", undefined, 100),
      candidate("cheap", 1, 60),
      candidate("quality", 3, 95),
    ]);
    expect(
      selectCrewCandidate(
        options,
        { ...defaultCrewPolicy, preset: "economy", allowUnknownCost: false },
        [],
        () => true,
      ).candidate.id,
    ).toBe("cheap");
    expect(
      selectCrewCandidate(
        options,
        { ...defaultCrewPolicy, preset: "quality", maxEstimatedCost: 2 },
        [],
        () => true,
      ).candidate.id,
    ).toBe("cheap");
    expect(() =>
      selectCrewCandidate(
        options,
        { ...defaultCrewPolicy, minimumQuality: 90, maxEstimatedCost: 2 },
        [],
        () => true,
      ),
    ).toThrow();
  });
  it("rejects missing review roles and duplicate identities", () => {
    const worker = agent([candidate("one")]);
    const definition = {
      id: "crew",
      name: "Crew",
      updatedAt: 0,
      policy: defaultCrewPolicy,
      agents: [
        worker,
        { ...worker, id: "lead", role: "coordinator" },
        { ...worker, id: "reviewer", role: "reviewer" },
      ],
    };
    expect(parseCrewDefinition(definition).agents).toHaveLength(3);
    expect(() =>
      parseCrewDefinition({ ...definition, agents: [worker, worker, worker] }),
    ).toThrow();
    expect(() =>
      parseCrewDefinition({ ...definition, policy: { ...defaultCrewPolicy, maxParallel: 1.5 } }),
    ).toThrow();
  });
});
