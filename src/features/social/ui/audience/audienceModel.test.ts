import { describe, expect, it } from "vitest";
import type { SocialList } from "../../model/audience";
import { isFilterEmpty, peopleScope, rateText, uniqueTags } from "./audienceModel";

const staticList = {
  id: "l1",
  name: "Buyers",
  kind: "static",
  projectIds: [],
  createdAt: 1,
} as SocialList;
const segment = {
  id: "s1",
  name: "Turkish",
  kind: "dynamic",
  filter: { language: "tr" },
  projectIds: [],
  createdAt: 1,
} as SocialList;

describe("peopleScope", () => {
  it("queries a static list by its id", () => {
    expect(peopleScope(staticList)).toEqual({ listId: "l1" });
  });

  it("evaluates a dynamic segment from its filter", () => {
    expect(peopleScope(segment)).toEqual({ filter: { language: "tr" } });
  });

  it("queries everyone when no list is selected", () => {
    expect(peopleScope(undefined)).toEqual({});
  });
});

describe("uniqueTags", () => {
  it("trims, drops empty values and keeps the first spelling of duplicates", () => {
    expect(uniqueTags([" vip ", "", "vip", "lead", "  "])).toEqual(["vip", "lead"]);
  });
});

describe("isFilterEmpty", () => {
  it("is true only when no condition is set", () => {
    expect(isFilterEmpty({})).toBe(true);
    expect(isFilterEmpty({ tags: [] })).toBe(true);
    expect(isFilterEmpty({ minScore: 0 })).toBe(false);
    expect(isFilterEmpty({ platforms: ["x"] })).toBe(false);
  });
});

describe("rateText", () => {
  it("shows a dash when nothing was sent, so an empty board never reads as 0%", () => {
    expect(rateText(0, 0)).toBe("–");
  });

  it("formats the share as a percentage", () => {
    expect(rateText(1, 10)).toBe("10%");
  });
});
