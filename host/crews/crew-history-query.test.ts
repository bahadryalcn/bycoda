import { expect, it } from "vitest";
import { crewHistoryQuery } from "./crew-history-query";

it("retains omitted and bounded Crew history requests", () => {
  expect(crewHistoryQuery({})).toBeUndefined();
  expect(crewHistoryQuery({ historyLimit: 100, historyCursor: "cursor" })).toEqual({
    limit: 100,
    cursor: "cursor",
  });
});

it.each([
  { historyLimit: 0 },
  { historyLimit: 101 },
  { historyLimit: 1.5 },
  { historyCursor: "cursor" },
  { historyLimit: 1, historyCursor: {} },
  { historyLimit: 1, historyCursor: "a".repeat(1025) },
])("rejects invalid Crew history bounds: %j", (input) => {
  expect(() => crewHistoryQuery(input)).toThrow("bounded Crew history");
});
