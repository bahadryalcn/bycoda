import { describe, expect, it } from "vitest";
import { PEOPLE_PAGE_SIZE, audienceQuery } from "./useAudienceData";
import { SEGMENT_LIST, STATIC_LIST } from "./audienceTestKit";

describe("audienceQuery", () => {
  it("asks for everyone when no list and no search text is set", () => {
    expect(audienceQuery(undefined, "")).toEqual({});
    expect(audienceQuery(undefined, "   ")).toEqual({});
  });

  it("puts the trimmed search text into the filter", () => {
    expect(audienceQuery(undefined, "  ada ")).toEqual({ filter: { query: "ada" } });
  });

  it("keeps a static list by id and adds the search beside it", () => {
    expect(audienceQuery(STATIC_LIST, "")).toEqual({ listId: "l1" });
    expect(audienceQuery(STATIC_LIST, "ada")).toEqual({ listId: "l1", filter: { query: "ada" } });
  });

  it("searches inside a segment without losing the segment's own conditions", () => {
    expect(audienceQuery(SEGMENT_LIST, "ada")).toEqual({
      filter: { language: "tr", query: "ada" },
    });
    expect(SEGMENT_LIST.filter).toEqual({ language: "tr" });
  });

  it("loads one hundred people per page", () => {
    expect(PEOPLE_PAGE_SIZE).toBe(100);
  });
});
