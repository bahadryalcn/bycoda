import { expect, it } from "vitest";
import { parseCrewAgent, type CrewAgent } from "./crew";
import { libraryVersionPatch } from "./crewLink";
import { applyCandidate, applyChoice } from "./crewBulk";
import { newCrewMember } from "./crewRoster";
const candidate = {
  id: "m",
  harness: "codex" as const,
  model: "m",
  modelSettings: {},
  capabilities: {},
};
const agent: CrewAgent = {
  id: "member",
  name: "Member",
  role: "specialist",
  instructions: "",
  selection: "automatic",
  candidates: [candidate],
};
it("carries routing choices through library sync and rejects malformed choices", () => {
  expect(
    libraryVersionPatch({
      ...agent,
      modelChoice: { kind: "pool", poolId: "routing" },
      updatedAt: 3,
    }).modelChoice,
  ).toEqual({ kind: "pool", poolId: "routing" });
  expect(() => parseCrewAgent({ ...agent, modelChoice: { kind: "pool" } })).toThrow();
});
it("bulk routing keeps concrete fallback and fixed assignment clears routing pool", () => {
  const automatic = applyChoice([agent], [], { kind: "order" })[0]!;
  expect(automatic.modelChoice).toEqual({ kind: "order" });
  expect(automatic.candidates).toBe(agent.candidates);
  const fixed = applyCandidate([automatic], [], candidate)[0]!;
  expect(fixed.selection).toBe("fixed");
  expect(fixed.modelChoice).toEqual({ kind: "fixed" });
});
it("new UI members follow role only on routing-aware Hosts", () => {
  expect(newCrewMember("specialist", "Member", candidate, true).modelChoice).toEqual({
    kind: "default",
  });
  expect(newCrewMember("specialist", "Member", candidate).modelChoice).toBeUndefined();
});
