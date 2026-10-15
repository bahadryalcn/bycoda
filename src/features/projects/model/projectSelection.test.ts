import { expect, it } from "vitest";
import { moveSelectedProjects, selectProjectRange } from "./projectSelection";

it("toggles Windows aliases and extends a reverse range without losing other selections", () => {
  expect(
    selectProjectRange(["C:/Work/A"], new Set(["c:/work/a"]), null, "C:\\Work\\A", false).size,
  ).toBe(0);
  expect([
    ...selectProjectRange(["/a", "/b", "/c", "/d"], new Set(["/d"]), "/c", "/a", true),
  ]).toEqual(["/d", "/a", "/b", "/c"]);
  expect([...selectProjectRange(["/a"], new Set(), "/removed", "/a", true)]).toEqual(["/a"]);
});

it("moves runs together and preserves relative order in both directions", () => {
  const order = ["/a", "/b", "/c", "/d", "/e"];
  const selection = new Set(["/b", "/c", "/e"]);
  expect(moveSelectedProjects(order, [order], selection, -1)).toEqual([
    "/b",
    "/c",
    "/a",
    "/e",
    "/d",
  ]);
  expect(moveSelectedProjects(order, [order], selection, 1)).toEqual([
    "/a",
    "/d",
    "/b",
    "/c",
    "/e",
  ]);
  expect(moveSelectedProjects(order, [order], new Set(order), 1)).toEqual(order);
});

it("keeps sections and unselected hidden projects in their existing slots", () => {
  const order = ["/a", "/hidden", "/b", "/c", "/d"];
  expect(
    moveSelectedProjects(
      order,
      [
        ["/a", "/b"],
        ["/c", "/d"],
      ],
      new Set(["/b", "/c"]),
      -1,
    ),
  ).toEqual(["/b", "/hidden", "/a", "/c", "/d"]);
});
