import { describe, expect, it } from "vitest";
import {
  defaultCrewPolicy,
  type CrewAgent,
  type CrewDefinition,
  type SavedCrewAgent,
} from "../../src/features/crews/model/crew";
import type { CrewDefaultsState } from "./crew-defaults";
import { updateLibraryGroup } from "./crew-groups";

const base = (id: string): CrewAgent => ({
  id,
  name: id,
  role: "specialist",
  instructions: `${id} instructions`,
  selection: "fixed",
  candidates: [
    { id: `${id}-model`, harness: "codex", model: "codex:fixture", modelSettings: {}, capabilities: {} },
  ],
});
const saved = (id: string, groups: string[] | undefined, projectId?: string): SavedCrewAgent => ({
  ...base(id),
  ...(groups ? { groups } : {}),
  ...(projectId ? { projectId } : {}),
  updatedAt: 10,
});
const members = (...ids: string[]) => ids.map((agentId) => ({ agentId, expectedUpdatedAt: 10 }));
const now = () => 5;

function state(agents: SavedCrewAgent[], definitions: CrewDefinition[] = []): CrewDefaultsState {
  return { definitions, agents, membershipLinked: true };
}

describe("updateLibraryGroup", () => {
  it("renames the label on every member in one pass, bumps revisions and keeps other groups", () => {
    const current = state([
      saved("ui", ["UI", "Mobile"]),
      saved("web", ["UI"], "p1"),
      saved("api", ["Backend"]),
    ]);
    expect(
      updateLibraryGroup(
        current,
        { projectId: "p1", group: "UI", rename: "Interface", members: members("ui", "web") },
        now,
      ),
    ).toBe(2);
    expect(current.agents!.map((a) => [a.id, a.groups, a.updatedAt])).toEqual([
      ["ui", ["Interface", "Mobile"], 11],
      ["web", ["Interface"], 11],
      ["api", ["Backend"], 10],
    ]);
  });

  it("removes the label on delete, drops an emptied list and keeps the members", () => {
    const current = state([saved("ui", ["UI"]), saved("web", ["UI", "Web"])]);
    updateLibraryGroup(current, { projectId: "p1", group: "UI", members: members("ui", "web") }, now);
    expect(current.agents!.map((a) => [a.id, a.groups])).toEqual([
      ["ui", undefined],
      ["web", ["Web"]],
    ]);
  });

  it("changes nothing when a member revision is stale", () => {
    const current = state([saved("ui", ["UI"]), saved("web", ["UI"])]);
    const before = structuredClone(current);
    expect(() =>
      updateLibraryGroup(
        current,
        {
          projectId: "p1",
          group: "UI",
          rename: "Interface",
          members: [
            { agentId: "ui", expectedUpdatedAt: 10 },
            { agentId: "web", expectedUpdatedAt: 9 },
          ],
        },
        now,
      ),
    ).toThrow("Group changed");
    expect(current).toEqual(before);
  });

  it("changes nothing when the caller's membership misses or adds a profile", () => {
    const current = state([saved("ui", ["UI"]), saved("web", ["UI"])]);
    const before = structuredClone(current);
    for (const ids of [["ui"], ["ui", "web", "api"], ["ui", "ui"]])
      expect(() =>
        updateLibraryGroup(current, { projectId: "p1", group: "UI", members: members(...ids) }, now),
      ).toThrow("Group changed");
    expect(current).toEqual(before);
  });

  it("refuses a rename onto an existing group instead of merging", () => {
    const current = state([saved("ui", ["UI"]), saved("api", ["Backend"])]);
    const before = structuredClone(current);
    expect(() =>
      updateLibraryGroup(
        current,
        { projectId: "p1", group: "UI", rename: "Backend", members: members("ui") },
        now,
      ),
    ).toThrow("already exists");
    expect(current).toEqual(before);
  });

  it("ignores another project's profiles when matching and checking names", () => {
    const current = state([saved("ui", ["UI"]), saved("other", ["UI", "Interface"], "p2")]);
    expect(
      updateLibraryGroup(
        current,
        { projectId: "p1", group: "UI", rename: "Interface", members: members("ui") },
        now,
      ),
    ).toBe(1);
    expect(current.agents!.find((a) => a.id === "other")!.groups).toEqual(["UI", "Interface"]);
  });

  it("follows a profile's new group into linked, uncustomized crew members", () => {
    const linked: CrewAgent = {
      ...base("member"),
      groups: ["UI"],
      source: { id: "ui", updatedAt: 10 },
    };
    const crew = {
      id: "crew",
      name: "Crew",
      agents: [linked],
      policy: defaultCrewPolicy,
      updatedAt: 1,
    } as unknown as CrewDefinition;
    const current = state([saved("ui", ["UI"])], [crew]);
    updateLibraryGroup(
      current,
      { projectId: "p1", group: "UI", rename: "Interface", members: members("ui") },
      now,
    );
    expect(current.definitions[0]!.agents[0]!.groups).toEqual(["Interface"]);
    expect(current.definitions[0]!.agents[0]!.source?.updatedAt).toBe(11);
  });

  it("is a no-op for the same name and rejects an empty or oversized name", () => {
    const current = state([saved("ui", ["UI"])]);
    const before = structuredClone(current);
    expect(
      updateLibraryGroup(current, { projectId: "p1", group: "UI", rename: "UI", members: members("ui") }, now),
    ).toBe(0);
    for (const rename of ["  ", "x".repeat(41)])
      expect(() =>
        updateLibraryGroup(current, { projectId: "p1", group: "UI", rename, members: members("ui") }, now),
      ).toThrow("Invalid group name");
    expect(current).toEqual(before);
  });
});
