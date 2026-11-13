import { expect, it } from "vitest";
import type { CrewAgent, CrewDefinition, SavedCrewAgent } from "./crew";
import { planAdd, planBulkAdd, planRemove } from "./crewAssignment";

const agent = (id: string, role: CrewAgent["role"], extra: Partial<CrewAgent> = {}): CrewAgent => ({
  id,
  name: id,
  role,
  instructions: "",
  selection: "fixed",
  candidates: [{ id: "c", harness: "codex", model: "m", modelSettings: {}, capabilities: {} }],
  ...extra,
});
const profile = (id: string, role: CrewAgent["role"], extra: Partial<CrewAgent> = {}) =>
  ({ ...agent(id, role, extra), updatedAt: 7 }) as SavedCrewAgent;
const crew = (agents: CrewAgent[], name = "Alpha"): CrewDefinition => ({
  id: "c1",
  name,
  agents,
  policy: {
    maxParallel: 2,
    maxAssignments: 8,
    maxRunMinutes: 60,
    allowSubagents: false,
  },
  updatedAt: 3,
});
const base = () => [agent("co", "coordinator"), agent("rv", "reviewer"), agent("sp", "specialist")];
const link = { id: "lib", updatedAt: 1 };

it("adds a linked copy in the profile's role without mutating the input", () => {
  const definition = crew(base());
  const plan = planAdd(definition, profile("lib", "specialist"));
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  const added = plan.definition.agents.at(-1)!;
  expect(added.role).toBe("specialist");
  expect(added.source).toEqual({ id: "lib", updatedAt: 7 });
  expect(added.id).not.toBe("lib");
  expect(definition.agents).toHaveLength(3);
  expect(plan.definition.updatedAt).toBe(3);
});

it("refuses a second coordinator or reviewer with a reason", () => {
  const coordinator = planAdd(crew(base()), profile("x", "coordinator"));
  expect(coordinator).toEqual({ ok: false, reason: expect.stringContaining("coordinator") });
  const reviewer = planAdd(crew(base()), profile("x", "reviewer"));
  expect(reviewer).toEqual({ ok: false, reason: expect.stringContaining("reviewer") });
});

it("allows an advisor", () => {
  expect(planAdd(crew(base()), profile("x", "advisor")).ok).toBe(true);
});

it("refuses a member already linked", () => {
  const definition = crew([...base(), agent("m", "specialist", { source: link })]);
  expect(planAdd(definition, profile("lib", "specialist"))).toMatchObject({ ok: false });
});

it("refuses past 20 members", () => {
  const many = [...base(), ...Array.from({ length: 17 }, (_, i) => agent(`s${i}`, "specialist"))];
  expect(many).toHaveLength(20);
  expect(planAdd(crew(many), profile("x", "specialist"))).toMatchObject({ ok: false });
});

it("refuses a duplicate handle", () => {
  const definition = crew([...base(), agent("h", "specialist", { handle: "ann" })]);
  expect(planAdd(definition, profile("x", "specialist", { handle: "ann" }))).toMatchObject({
    ok: false,
  });
});

it("reports Host validation failures for a crew that is already invalid", () => {
  expect(planAdd(crew([agent("co", "coordinator")]), profile("x", "specialist")).ok).toBe(false);
});

it("removes every linked copy of a specialist", () => {
  const definition = crew([...base(), agent("m1", "specialist", { source: link })]);
  const plan = planRemove(definition, profile("lib", "specialist"));
  expect(plan.ok).toBe(true);
  if (plan.ok) expect(plan.definition.agents.map((a) => a.id)).toEqual(["co", "rv", "sp"]);
});

it("refuses removing the coordinator, reviewer or last specialist", () => {
  const withRole = (role: CrewAgent["role"], rest: CrewAgent[]) =>
    crew([agent("m", role, { source: link }), ...rest]);
  const sp = agent("sp", "specialist");
  expect(
    planRemove(
      withRole("coordinator", [agent("rv", "reviewer"), sp]),
      profile("lib", "coordinator"),
    ),
  ).toMatchObject({ ok: false });
  expect(
    planRemove(withRole("reviewer", [agent("co", "coordinator"), sp]), profile("lib", "reviewer")),
  ).toMatchObject({ ok: false });
  expect(
    planRemove(
      withRole("specialist", [agent("co", "coordinator"), agent("rv", "reviewer")]),
      profile("lib", "specialist"),
    ),
  ).toMatchObject({ ok: false });
});

it("refuses removing a profile that is not in the crew", () => {
  expect(planRemove(crew(base()), profile("lib", "specialist"))).toMatchObject({ ok: false });
});

it("bulk-adds what fits and reports the rest", () => {
  const plan = planBulkAdd(crew(base()), [
    profile("a", "specialist"),
    profile("b", "coordinator"),
    profile("c", "advisor"),
    profile("d", "reviewer"),
  ]);
  expect(plan.added).toEqual(["a", "c"]);
  expect(plan.skipped.map((s) => s.name)).toEqual(["b", "d"]);
  expect(plan.definition?.agents).toHaveLength(5);
});

it("bulk accounts for earlier additions", () => {
  const definition = crew([agent("rv", "reviewer"), agent("sp", "specialist")]);
  const plan = planBulkAdd(definition, [profile("a", "coordinator"), profile("b", "coordinator")]);
  expect(plan.added).toEqual(["a"]);
  expect(plan.skipped).toHaveLength(1);
});

it("bulk stops at 20 and returns no definition when nothing fits", () => {
  const many = [...base(), ...Array.from({ length: 17 }, (_, i) => agent(`s${i}`, "specialist"))];
  const plan = planBulkAdd(crew(many), [profile("a", "specialist")]);
  expect(plan.definition).toBeUndefined();
  expect(plan.skipped).toHaveLength(1);
});

it("bulk fills the last free slots then skips the rest", () => {
  const many = [...base(), ...Array.from({ length: 16 }, (_, i) => agent(`s${i}`, "specialist"))];
  const plan = planBulkAdd(crew(many), [profile("a", "specialist"), profile("b", "specialist")]);
  expect(plan.added).toEqual(["a"]);
  expect(plan.skipped.map((s) => s.name)).toEqual(["b"]);
});
