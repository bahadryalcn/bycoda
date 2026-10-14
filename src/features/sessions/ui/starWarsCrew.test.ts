import { describe, expect, it } from "vitest";
import { crewCharge, STAR_WARS_ARTWORK, STAR_WARS_CREW, starWarsCharacter } from "./starWarsCrew";

describe("Star Wars crew", () => {
  it("seats Chewbacca in the default six and reserves R2-D2 for the seventh arrival", () => {
    const defaults = ["darth-vader", "leia", "obi-wan", "yoda", "luke", "chewbacca"];
    expect(STAR_WARS_CREW.map((character) => character.id)).toEqual(defaults);
    expect(defaults.map((_, id) => starWarsCharacter(id).id)).toEqual(defaults);
    expect(starWarsCharacter(6, "subagent").id).toBe("r2-d2");
    expect(Array.from({ length: 6 }, (_, offset) => starWarsCharacter(6 + offset).id)).toEqual([
      "r2-d2",
      "darth-vader",
      "leia",
      "luke",
      "chewbacca",
      "r2-d2",
    ]);
    expect(STAR_WARS_ARTWORK.map((character) => character.id)).toEqual([...defaults, "r2-d2"]);
  });
  it("has six distinct identities and preserves the lead/advisor across crowded crews", () => {
    expect(new Set(STAR_WARS_CREW.map((c) => c.id)).size).toBe(6);
    expect(starWarsCharacter(2, "lead").id).toBe("obi-wan");
    expect(starWarsCharacter(3, "advisor").id).toBe("yoda");
    expect(starWarsCharacter(6, "lead").id).toBe("obi-wan");
    expect(starWarsCharacter(6, "advisor").id).toBe("yoda");
    for (let id = 6; id < 30; id++) {
      expect(["obi-wan", "yoda"]).not.toContain(starWarsCharacter(id, "subagent").id);
    }
  });
  it("uses actual context, including compaction, without inventing unknown readings", () => {
    expect([0, 0.5, 1, 0.12].map((value) => crewCharge(value))).toEqual([0, 0.5, 1, 0.12]);
    expect(crewCharge(undefined)).toBeUndefined();
    expect(crewCharge(NaN)).toBeUndefined();
    expect(crewCharge(Infinity)).toBeUndefined();
    expect(crewCharge(-0.1)).toBe(0);
    expect(crewCharge(1.5)).toBe(1);
    expect(crewCharge(undefined, false)).toBe(1);
  });
});
