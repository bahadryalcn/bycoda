// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  linearIssueDetails,
  linearTeamIdsForFetch,
  peekLinearIssueDetails,
  readHiddenLinearTeamIds,
  requireHiddenLinearTeamIds,
  saveHiddenLinearTeamIds,
  subscribeLinearScope,
} from "./linear";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("linear issue details cache", () => {
  it("caps at 128 entries, evicting the least recently read", async () => {
    vi.mocked(invoke).mockImplementation(
      async (_command, args) => ({ id: (args as { id: string }).id }) as never,
    );
    for (let i = 0; i < 128; i++) await linearIssueDetails(`lin-${i}`);
    // Reading lin-0 refreshes it, so lin-1 is now the oldest.
    expect(peekLinearIssueDetails("lin-0")).not.toBeNull();
    await linearIssueDetails("lin-128");

    expect(peekLinearIssueDetails("lin-0")).not.toBeNull();
    expect(peekLinearIssueDetails("lin-1")).toBeNull();
    expect(peekLinearIssueDetails("lin-2")).not.toBeNull();
    expect(peekLinearIssueDetails("lin-128")).not.toBeNull();
  });
});

describe("linearTeamIdsForFetch", () => {
  const teams = [
    { id: "t1", key: "ENG", name: "Engineering" },
    { id: "t2", key: "DES", name: "Design" },
  ];

  it("sends no team filter when nothing is hidden", () => {
    expect(linearTeamIdsForFetch(teams, [])).toBeNull();
  });

  it("keeps visible team ids", () => {
    expect(linearTeamIdsForFetch(teams, ["t2"])).toEqual(["t1"]);
  });

  it("returns empty when every known team is hidden", () => {
    expect(linearTeamIdsForFetch(teams, ["t1", "t2"])).toEqual([]);
  });

  it("sends no team filter when hidden ids match no team", () => {
    expect(linearTeamIdsForFetch(teams, ["gone"])).toBeNull();
  });

  it("keeps later-page teams when one or every first-page team is hidden", () => {
    const allTeams = Array.from({ length: 53 }, (_, index) => ({
      id: `team-${index}`,
      key: `T${index}`,
      name: `Team ${index}`,
    }));
    expect(linearTeamIdsForFetch(allTeams, ["team-0"])).toHaveLength(52);
    expect(linearTeamIdsForFetch(allTeams, ["team-0"])).toContain("team-52");
    expect(
      linearTeamIdsForFetch(
        allTeams,
        allTeams.slice(0, 50).map((team) => team.id),
      ),
    ).toEqual(["team-50", "team-51", "team-52"]);
  });
});

describe("linear saved team scope", () => {
  it("separates an empty scope from an unreadable one and fails closed", () => {
    localStorage.removeItem("bycoda.linearHiddenTeams");
    expect(readHiddenLinearTeamIds()).toEqual([]);
    localStorage.setItem("bycoda.linearHiddenTeams", "{not json");
    expect(readHiddenLinearTeamIds()).toBeNull();
    expect(() => requireHiddenLinearTeamIds()).toThrow("scope is unavailable");
    localStorage.removeItem("bycoda.linearHiddenTeams");
  });

  it("reports whether a save was read back and tells sibling windows", () => {
    const changed = vi.fn();
    const stop = subscribeLinearScope(changed);
    expect(saveHiddenLinearTeamIds(["t1"])).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: "bycoda.linearHiddenTeams" }));
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
    expect(changed).toHaveBeenCalledTimes(2);
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(saveHiddenLinearTeamIds(["t2"])).toBe(false);
    setItem.mockRestore();
    expect(readHiddenLinearTeamIds()).toEqual(["t1"]);
    stop();
    localStorage.removeItem("bycoda.linearHiddenTeams");
  });
});
