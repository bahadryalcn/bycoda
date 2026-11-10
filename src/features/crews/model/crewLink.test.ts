import { describe, expect, it } from "vitest";
import {
  defaultCrewPolicy,
  type CrewAgent,
  type CrewDefinition,
  type SavedCrewAgent,
} from "./crew";
import { handleErrorsFromHost, libraryVersionPatch, memberLink, rebaseOntoSync } from "./crewLink";

const candidate = {
  id: "codex/m",
  harness: "codex" as const,
  model: "m",
  modelSettings: {},
  capabilities: {},
};
const member = (id: string, extra: Partial<CrewAgent> = {}): CrewAgent => ({
  id,
  name: id,
  role: "specialist",
  instructions: "",
  selection: "fixed",
  candidates: [candidate],
  ...extra,
});
const profile: SavedCrewAgent = { ...member("lib"), updatedAt: 5 };
const crew = (agents: CrewAgent[], updatedAt: number, extra: Partial<CrewDefinition> = {}) => ({
  id: "crew",
  name: "Team",
  agents,
  policy: { ...defaultCrewPolicy },
  updatedAt,
  ...extra,
});

describe("memberLink", () => {
  it("reports linked, customized and crew-only members", () => {
    const source = { id: "lib", updatedAt: 5 };
    expect(memberLink(member("a", { source }), [profile])?.state).toBe("linked");
    expect(memberLink(member("a", { source, customized: true }), [profile])?.state).toBe(
      "customized",
    );
    expect(memberLink(member("a"), [profile])).toBeUndefined();
    expect(
      memberLink(member("a", { source: { id: "gone", updatedAt: 1 } }), [profile]),
    ).toBeUndefined();
  });
});

describe("libraryVersionPatch", () => {
  it("takes the synced fields and clears customized", () => {
    const edited = member("a", {
      name: "Mine",
      customized: true,
      source: { id: "lib", updatedAt: 1 },
    });
    const next = { ...edited, ...libraryVersionPatch({ ...profile, name: "Lib", handle: "lib" }) };
    expect(next).toMatchObject({ name: "Lib", handle: "lib", source: { updatedAt: 5 } });
    expect(next.customized).toBeUndefined();
    expect(next.id).toBe("a");
  });
});

describe("rebaseOntoSync", () => {
  const source = { id: "lib", updatedAt: 1 };
  const base = crew([member("a", { source }), member("b")], 10);
  const synced = member("a", { source: { id: "lib", updatedAt: 2 }, name: "Renamed" });
  const latest = crew([synced, member("b")], 11);

  it("keeps local edits to other members and takes the synced one", () => {
    const draft = crew([member("a", { source }), member("b", { instructions: "x" })], 10);
    const rebased = rebaseOntoSync(base, draft, latest);
    expect(rebased?.updatedAt).toBe(11);
    expect(rebased?.agents[0]).toEqual(synced);
    expect(rebased?.agents[1].instructions).toBe("x");
  });

  it("is a conflict when the draft touched the synced member", () => {
    const draft = crew([member("a", { source, instructions: "mine" }), member("b")], 10);
    expect(rebaseOntoSync(base, draft, latest)).toBeUndefined();
  });

  it("is a conflict when the remote change is not a library sync", () => {
    const draft = structuredClone(base);
    expect(rebaseOntoSync(base, draft, { ...latest, name: "Other" })).toBeUndefined();
    expect(
      rebaseOntoSync(
        base,
        draft,
        crew([member("a", { source, role: "reviewer" }), member("b")], 11),
      ),
    ).toBeUndefined();
    expect(
      rebaseOntoSync(base, draft, crew([{ ...synced, customized: true }, member("b")], 11)),
    ).toBeUndefined();
  });

  it("is a conflict when a crew-only member changed remotely or the base is stale", () => {
    const draft = structuredClone(base);
    expect(
      rebaseOntoSync(base, draft, crew([member("a", { source }), member("b", { name: "B2" })], 11)),
    ).toBeUndefined();
    expect(rebaseOntoSync({ ...base, updatedAt: 9 }, draft, latest)).toBeUndefined();
  });
});

describe("handleErrorsFromHost", () => {
  const agents = [member("a", { handle: "ada" }), member("b", { handle: "ada" }), member("c")];
  it("targets the member holding a taken handle", () => {
    const message = "Handle @ada is already used by Library Ada";
    expect(Object.keys(handleErrorsFromHost(message, agents))).toEqual(["a", "b"]);
  });
  it("targets every member sharing a handle for duplicates", () => {
    expect(Object.keys(handleErrorsFromHost("Duplicate member handles", agents))).toEqual([
      "a",
      "b",
    ]);
  });
  it("ignores other failures", () => {
    expect(handleErrorsFromHost("Network down", agents)).toEqual({});
  });
});
