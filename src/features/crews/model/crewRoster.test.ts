import { describe, expect, it } from "vitest";
import { defaultCrewPolicy, type CrewAgent, type CrewDefinition, type CrewRun } from "./crew";
import type { HostModelCatalog } from "../../connections/model/protocol";
import {
  applyFixedModel,
  candidateDetailLabel,
  candidatePassesPolicy,
  crewPolicyImpact,
  crewRosterIssues,
  crewRosterValid,
  crewRunTitle,
  libraryUpdate,
  memberDraftStarted,
  memberFromLibrary,
  memberModelSummary,
} from "./crewRoster";

const candidate = {
  id: "codex/m",
  harness: "codex" as const,
  model: "m",
  modelSettings: {},
  capabilities: {},
};
const agent = (id: string, role: CrewAgent["role"], extra: Partial<CrewAgent> = {}): CrewAgent => ({
  id,
  name: id,
  role,
  instructions: "",
  selection: "fixed",
  candidates: [candidate],
  ...extra,
});
const crew = (agents: CrewAgent[], name = "Crew"): CrewDefinition => ({
  id: "crew",
  name,
  agents,
  policy: defaultCrewPolicy,
  updatedAt: 0,
});

describe("crew roster", () => {
  it("names each missing or repeated role before saving", () => {
    expect(crewRosterIssues(crew([]))).toMatchObject({
      coordinator: "missing",
      reviewer: "missing",
      specialist: "missing",
      size: "small",
    });
    const issues = crewRosterIssues(
      crew(
        [
          agent("a", "coordinator"),
          agent("b", "coordinator"),
          agent("c", "specialist", { candidates: [] }),
          agent("d", "reviewer"),
        ],
        " ",
      ),
    );
    expect(issues).toMatchObject({ coordinator: "duplicate", name: "missing" });
    expect(issues.members).toEqual({ c: "model" });
    expect(crewRosterValid(issues)).toBe(false);
    expect(
      crewRosterValid(
        crewRosterIssues(
          crew([agent("a", "coordinator"), agent("b", "specialist"), agent("c", "reviewer")]),
        ),
      ),
    ).toBe(true);
  });

  it("copies library profiles and offers their later changes explicitly", () => {
    const saved = {
      ...agent("ui", "specialist", { groups: ["UI"] }),
      updatedAt: 5,
    };
    const member = memberFromLibrary(saved, "reviewer");
    expect(member).toMatchObject({
      role: "reviewer",
      groups: ["UI"],
      source: { id: "ui", updatedAt: 5 },
    });
    expect(member.id).not.toBe("ui");
    expect(member).not.toHaveProperty("projectId");
    expect(libraryUpdate(member, [saved])).toBeUndefined();
    expect(libraryUpdate(member, [{ ...saved, updatedAt: 6 }])?.updatedAt).toBe(6);
  });

  it("titles work by the delivery's first line, not the whole prompt", () => {
    const run = {
      definition: crew([]),
      assignments: [],
      launch: { prompt: "\n  Mobile sign-in screen\nWith tests and docs" },
    } as unknown as CrewRun;
    expect(crewRunTitle(run)).toBe("Mobile sign-in screen");
    expect(crewRunTitle({ ...run, launch: undefined })).toBe("Crew");
    expect(
      crewRunTitle({
        ...run,
        launch: { ...run.launch!, prompt: "x".repeat(100) },
      }),
    ).toHaveLength(72);
  });

  const catalog = {
    models: { codex: [{ id: "m", name: "Model M", harness: "codex" }] },
    errors: {},
  } as unknown as HostModelCatalog;

  it("summarizes a member's model the same way everywhere", () => {
    expect(memberModelSummary(catalog, agent("a", "specialist"))).toBe("Fixed: Model M");
    expect(memberModelSummary(catalog, agent("a", "specialist", { candidates: [] }))).toBe(
      "No model",
    );
    const pool = [candidate, { ...candidate, id: "codex/n", model: "n" }];
    expect(
      memberModelSummary(
        catalog,
        agent("a", "specialist", { selection: "automatic", candidates: pool }),
      ),
    ).toBe("Automatic: 2 candidates");
    expect(
      memberModelSummary(
        catalog,
        agent("a", "specialist", { selection: "automatic", candidates: [candidate] }),
      ),
    ).toBe("Automatic: 1 candidate");
  });

  it("qualifies a candidate with its provider and keeps unknown models readable", () => {
    expect(candidateDetailLabel(catalog, candidate)).toBe("Model M · codex");
    expect(candidateDetailLabel(catalog, { ...candidate, model: "gone" })).toBe("gone · codex");
    expect(candidateDetailLabel(catalog, undefined)).toBe("");
  });

  it("lists the members the eligibility guards affect, fixed pins included", () => {
    const rated = (id: string, cost?: number, quality?: number) => ({
      ...candidate,
      id,
      model: id,
      cost,
      quality,
    });
    const policy = { allowUnknownCost: false, maxEstimatedCost: 2, minimumQuality: 70 };
    expect(candidatePassesPolicy(rated("a", 2, 70), policy)).toBe(true);
    expect(candidatePassesPolicy(rated("a", 3, 90), policy)).toBe(false);
    expect(candidatePassesPolicy(rated("a", undefined, 90), policy)).toBe(false);
    expect(candidatePassesPolicy(rated("a", 1, 40), policy)).toBe(false);
    expect(candidatePassesPolicy(rated("a"), { allowUnknownCost: true })).toBe(true);

    const impact = crewPolicyImpact(
      [
        // A pin that fails the guard is blocked, not exempted.
        agent("pinned", "specialist", { candidates: [rated("x", 3, 90), rated("y", 1, 90)] }),
        agent("ok", "reviewer", { candidates: [rated("y", 1, 90)] }),
        agent("auto", "specialist", {
          selection: "automatic",
          candidates: [rated("x", 3, 90), rated("y", 1, 90)],
        }),
        agent("none", "specialist", { selection: "automatic", candidates: [rated("x", 3, 90)] }),
        agent("empty", "advisor", { candidates: [] }),
      ],
      policy,
    );
    expect(impact.blocked.map((item) => item.agent.id)).toEqual(["pinned", "none"]);
    expect(impact.narrowed.map((item) => [item.agent.id, item.eligible, item.pool])).toEqual([
      ["auto", 1, 2],
    ]);
  });

  it("applies one model to fixed members only and keeps matching settings and the pool", () => {
    const next = { ...candidate, id: "codex/n", model: "n" };
    const kept = { ...next, modelSettings: { effort: "high" }, cost: 2 };
    const members = applyFixedModel(
      [
        agent("a", "specialist"),
        agent("b", "specialist", { candidates: [candidate, kept] }),
        agent("c", "specialist", { selection: "automatic", candidates: [candidate] }),
      ],
      next,
    );
    expect(members[0]!.candidates.map((item) => item.id)).toEqual(["codex/n"]);
    expect(members[1]!.candidates).toEqual([kept, candidate]);
    expect(members[2]!.candidates).toEqual([candidate]);
  });

  it("tells a started member draft from an untouched one and shortens name lists", () => {
    expect(memberDraftStarted({ name: "  ", instructions: "", groups: [] })).toBe(false);
    expect(memberDraftStarted({ name: "", instructions: " x ", groups: undefined })).toBe(true);
    expect(memberDraftStarted({ name: "", instructions: "", groups: ["UI"] })).toBe(true);
  });
});
