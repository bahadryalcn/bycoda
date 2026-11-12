import { expect, it } from "vitest";
import {
  classicColorTable,
  classicColorEdge,
  classicInk,
  colorCell,
  sampleColorTag,
} from "./crewCodeColor";
import { crewLayout } from "./crewLayout";

it("leaves unknown, zero and untagged furniture exactly grey", () => {
  expect(classicInk(180, undefined, 0, 3)).toBe("rgb(180,180,180)");
  expect(classicInk(180, 0, 0, 3)).toBe("rgb(180,180,180)");
  expect(classicInk(180, 1, 0, 0)).toBe("rgb(180,180,180)");
});
it("tags regions without changing tone, and distinguishes all six jackets", () => {
  const table = classicColorTable();
  const jackets = [];
  for (let id = 0; id < 6; id++) {
    expect(classicInk(180, 1, id, 3)).toBe(`rgb(180,${id * 7 + 3},0)`);
    jackets.push(table.slice((id * 7 + 3) * 4, (id * 7 + 3) * 4 + 3).join(","));
  }
  expect(new Set(jackets).size).toBe(6);
});
it("fills upward, reverses on compaction, and fully colors the crown at one", () => {
  const make = (charge: number) =>
    classicColorEdge(crewLayout(6)[0], { stand: 0, talk: 0, charge }, 234);
  const half = make(0.5),
    lower = make(0.25),
    full = make(1);
  expect(colorCell(3 | (half << 8), 170)).toBe(3);
  expect(colorCell(3 | (half << 8), 100)).toBe(0);
  expect(lower).toBeGreaterThan(half);
  expect(colorCell(3 | (full << 8), 0)).toBe(3);
  expect(classicColorEdge(crewLayout(40)[32], { stand: 0, talk: 0, charge: 0.1 }, 234)).not.toBe(
    half,
  );
});
it("selects the most covered sample without averaging region tags", () => {
  const pixels = new Uint8ClampedArray([
    180, 3, 0, 120, 180, 10, 0, 255, 180, 17, 0, 200, 180, 24, 0, 100,
  ]);
  expect(sampleColorTag(pixels, 0, 8)).toBe(10);
});
