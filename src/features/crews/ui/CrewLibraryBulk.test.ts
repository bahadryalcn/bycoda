import { expect, it, vi } from "vitest";
import type { CrewCandidate, SavedCrewAgent } from "../model/crew";
import { applyCandidateToProfiles, bulkTargets } from "./CrewLibraryBulk";

const profile = (id: string, updatedAt = 1) =>
  ({
    id,
    name: `Member ${id}`,
    role: "specialist",
    instructions: "",
    selection: "auto",
    candidates: [],
    updatedAt,
  }) as unknown as SavedCrewAgent;
const candidate = {
  id: "c",
  harness: "codex",
  model: "m",
  modelSettings: { effort: "high" },
} as unknown as CrewCandidate;

it("targets the selected visible profiles, or every visible one when none is selected", () => {
  const visible = [profile("a"), profile("b"), profile("c")];
  expect(bulkTargets(visible, new Set(["b", "gone"])).map((a) => a.id)).toEqual(["b"]);
  expect(bulkTargets(visible, new Set(["gone"])).map((a) => a.id)).toEqual(["a", "b", "c"]);
  expect(bulkTargets(visible, new Set()).map((a) => a.id)).toEqual(["a", "b", "c"]);
});

it("saves each profile with the fixed candidate in order and reports failures", async () => {
  const save = vi.fn(async (agent: { id: string }) => {
    if (agent.id === "b") throw new Error("Changed elsewhere");
  });
  const result = await applyCandidateToProfiles(
    [profile("a", 5), profile("b", 6), profile("c", 7)],
    candidate,
    save,
  );
  expect(result.updated).toBe(2);
  expect(result.failures).toEqual([{ name: "Member b", reason: "Changed elsewhere" }]);
  expect(save.mock.calls.map(([agent, at]) => [agent.id, at])).toEqual([
    ["a", 5],
    ["b", 6],
    ["c", 7],
  ]);
  const [saved] = save.mock.calls[0] as unknown as [Record<string, unknown>];
  expect(saved).toMatchObject({ selection: "fixed", candidates: [candidate] });
  expect(saved).not.toHaveProperty("updatedAt");
});
