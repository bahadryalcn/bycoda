import { describe, expect, it } from "vitest";
import { parseCrewAgent, parseCrewModelPool, type CrewAgent, type CrewCandidate } from "./crew";
import { libraryVersionPatch, rebaseOntoSync } from "./crewLink";
import { modelPoolDraftIssue, modelPoolUsage, newModelPoolDraft } from "./crewModelPools";

const candidate = (id: string): CrewCandidate => ({
  id,
  harness: "codex",
  model: "m",
  modelSettings: {},
  capabilities: {},
});
const agent = (id: string, extra: Partial<CrewAgent> = {}): CrewAgent => ({
  id,
  name: id,
  role: "specialist",
  instructions: "",
  selection: "automatic",
  candidates: [candidate("a")],
  ...extra,
});

describe("model pool parsing", () => {
  it("accepts a pool and trims its name", () => {
    expect(
      parseCrewModelPool({ id: "p", name: " Fast ", candidates: [candidate("a")], updatedAt: 3 }),
    ).toMatchObject({ id: "p", name: "Fast", updatedAt: 3 });
  });

  it("rejects empty, oversized and duplicate candidate lists", () => {
    const pool = (candidates: unknown[]) => ({ id: "p", name: "n", candidates });
    expect(() => parseCrewModelPool(pool([]))).toThrow("1 to 20");
    expect(() =>
      parseCrewModelPool(pool(Array.from({ length: 21 }, (_, i) => candidate(String(i))))),
    ).toThrow("1 to 20");
    expect(() => parseCrewModelPool(pool([candidate("a"), candidate("a")]))).toThrow("Duplicate");
    expect(() => parseCrewModelPool({ ...pool([candidate("a")]), name: "" })).toThrow();
  });

  it("keeps a member's pool reference only for automatic selection", () => {
    expect(parseCrewAgent(agent("m", { pool: { id: "p" } })).pool).toEqual({ id: "p" });
    expect(parseCrewAgent(agent("m", { selection: "fixed", pool: { id: "p" } })).pool).toBe(
      undefined,
    );
    expect(() => parseCrewAgent({ ...agent("m"), pool: { id: "" } })).toThrow();
  });
});

describe("model pool drafts and usage", () => {
  const pools = [{ id: "p1", name: "Fast", candidates: [candidate("a")], updatedAt: 1 }];
  it("names the first problem that blocks saving", () => {
    const draft = (name: string, candidates: CrewCandidate[], id = "new") => ({
      ...newModelPoolDraft(id, candidates),
      name,
    });
    expect(modelPoolDraftIssue(draft("", [candidate("a")]), pools)).toBe("name");
    expect(modelPoolDraftIssue(draft(" fast ", [candidate("a")]), pools)).toBe("duplicate");
    expect(modelPoolDraftIssue(draft("Fast", [candidate("a")], "p1"), pools)).toBeUndefined();
    expect(modelPoolDraftIssue(draft("Other", []), pools)).toBe("models");
  });

  it("counts library profiles and crew members per pool", () => {
    const data = {
      agents: [{ ...agent("lib", { pool: { id: "p1" } }), updatedAt: 1 }],
      definitions: [
        {
          id: "c",
          name: "c",
          updatedAt: 0,
          agents: [agent("x", { pool: { id: "p1" } }), agent("y", { pool: { id: "p2" } })],
        },
      ],
    } as unknown as Parameters<typeof modelPoolUsage>[1];
    expect(modelPoolUsage("p1", data)).toEqual({ profiles: 1, members: 1 });
    expect(modelPoolUsage("none", data)).toEqual({ profiles: 0, members: 0 });
  });
});

describe("library link with a pool", () => {
  it("takes the profile's pool when adopting its version", () => {
    const profile = { ...agent("lib", { pool: { id: "p1" } }), updatedAt: 4 };
    expect(libraryVersionPatch(profile).pool).toEqual({ id: "p1" });
  });

  it("treats a pool change as a library sync when rebasing a draft", () => {
    const base = agent("m", { source: { id: "lib", updatedAt: 1 } });
    const synced = {
      ...base,
      pool: { id: "p1" },
      candidates: [candidate("b")],
      source: { id: "lib", updatedAt: 2 },
    };
    const crew = (member: CrewAgent, updatedAt: number) => ({
      id: "c",
      name: "c",
      agents: [member],
      policy: {} as never,
      updatedAt,
    });
    const rebased = rebaseOntoSync(crew(base, 1), crew(base, 1), crew(synced, 2));
    expect(rebased?.agents[0]?.pool).toEqual({ id: "p1" });
  });
});
