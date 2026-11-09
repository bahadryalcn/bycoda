import { describe, expect, it } from "vitest";
import { defaultCrewPolicy, type CrewAgent, type CrewCandidate, type CrewDefinition } from "./crew";
import {
  adoptSaved,
  applyCandidate,
  commonCandidate,
  crewFingerprint,
  shouldAutosave,
} from "./crewBulk";

const candidate = (id: string, effort = "high"): CrewCandidate => ({
  id,
  harness: "claude",
  model: id,
  modelSettings: { effort },
  capabilities: {},
});
const agent = (id: string, patch: Partial<CrewAgent> = {}): CrewAgent => ({
  id,
  name: id,
  role: "specialist",
  instructions: "",
  selection: "fixed",
  candidates: [candidate("old", "low")],
  ...patch,
});
const crew = (patch: Partial<CrewDefinition> = {}): CrewDefinition => ({
  id: "c",
  name: "Crew",
  agents: [agent("a")],
  policy: { ...defaultCrewPolicy },
  updatedAt: 5,
  ...patch,
});

describe("applyCandidate", () => {
  it("pins selected members to a cloned candidate and leaves others", () => {
    const next = candidate("new");
    const agents = [agent("a"), agent("b", { selection: "automatic" }), agent("c")];
    const result = applyCandidate(agents, ["b", "c"], next);
    expect(result[0]).toBe(agents[0]);
    expect(result[1]).toMatchObject({ selection: "fixed", candidates: [next] });
    expect(result[2]!.candidates[0]).toEqual(next);
    expect(result[2]!.candidates[0]).not.toBe(next);
    expect(result[1]!.candidates[0]).not.toBe(result[2]!.candidates[0]);
  });

  it("targets everyone for an empty selection", () => {
    const result = applyCandidate([agent("a"), agent("b")], [], candidate("new"));
    expect(result.every((m) => m.candidates.length === 1 && m.candidates[0]!.id === "new")).toBe(
      true,
    );
  });
});

describe("shouldAutosave", () => {
  const saved = crew();
  it("needs a saved crew, a valid draft and a real change", () => {
    const edited = crew({ name: "Renamed" });
    expect(shouldAutosave(edited, saved, true)).toBe(true);
    expect(shouldAutosave(edited, saved, false)).toBe(false);
    expect(shouldAutosave(crew({ name: "Renamed", updatedAt: 0 }), saved, true)).toBe(false);
    expect(shouldAutosave(edited, undefined, true)).toBe(false);
    expect(shouldAutosave(crew({ updatedAt: 9 }), saved, true)).toBe(false);
    expect(shouldAutosave(crew({ name: "Crew  " }), saved, true)).toBe(false);
  });

  it("does not resend what was just sent or what failed", () => {
    const edited = crew({ name: "Renamed" });
    expect(shouldAutosave(edited, saved, true, crewFingerprint(edited))).toBe(false);
    expect(shouldAutosave(edited, saved, true, undefined, crewFingerprint(edited))).toBe(false);
    expect(shouldAutosave(crew({ name: "Other" }), saved, true, crewFingerprint(edited))).toBe(
      true,
    );
  });
});

describe("adoptSaved", () => {
  it("takes the stored definition when nothing changed since the request", () => {
    const sent = crew({ name: "Renamed" });
    const returned = crew({ name: "Renamed", updatedAt: 6 });
    expect(adoptSaved(structuredClone(sent), sent, returned)).toBe(returned);
  });

  it("keeps edits made during the request and moves the revision", () => {
    const sent = crew({ name: "Renamed" });
    const current = crew({ name: "Renamed again" });
    const result = adoptSaved(current, sent, crew({ name: "Renamed", updatedAt: 6 }));
    expect(result).toMatchObject({ name: "Renamed again", updatedAt: 6 });
  });
});

describe("commonCandidate", () => {
  it("returns the most shared first candidate, counting settings as identity", () => {
    const low = candidate("m", "low");
    const high = candidate("m", "high");
    const agents = [
      agent("a", { candidates: [high] }),
      agent("b", { candidates: [low] }),
      agent("c", { candidates: [high] }),
      agent("d", { candidates: [] }),
    ];
    expect(commonCandidate(agents)).toEqual(high);
    expect(commonCandidate([agents[1]!, agents[0]!])).toEqual(low);
    expect(commonCandidate([])).toBeUndefined();
    expect(commonCandidate(agents, ["b"])).toEqual(low);
  });
});
