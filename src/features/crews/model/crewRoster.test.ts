import { describe, expect, it } from "vitest";
import { defaultCrewPolicy, type CrewAgent, type CrewDefinition, type CrewRun } from "./crew";
import {
  crewRosterIssues,
  crewRosterValid,
  crewRunTitle,
  libraryUpdate,
  memberFromLibrary,
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
});
