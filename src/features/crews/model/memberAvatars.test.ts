import { describe, expect, it } from "vitest";
import { memberTraits, teamTraits } from "./memberAvatars";

describe("member avatars", () => {
  it("uses the saved choice over the seeded look", () => {
    const member = { id: "m1", avatar: { headwear: "beret" as const, palette: 3 } };
    expect(memberTraits(member)).toMatchObject({ headwear: "beret", palette: 3 });
  });

  it("gives copies of one profile the same look", () => {
    expect(memberTraits({ id: "a", source: { id: "p" } })).toEqual(
      memberTraits({ id: "b", source: { id: "p" } }),
    );
  });

  it("resolves every member of a roster", () => {
    const members = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect([...teamTraits(members).keys()].sort()).toEqual(["a", "b", "c", "d"]);
  });
});
