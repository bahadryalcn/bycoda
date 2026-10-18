import { describe, expect, it } from "vitest";
import { linearTeamIdsForFetch } from "./linear";

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
