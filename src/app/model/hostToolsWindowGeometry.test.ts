import { expect, it } from "vitest";
import { reachableToolsGeometry } from "./hostToolsWindowGeometry";
it("moves removed-monitor bounds onto current display and clamps oversized windows", () => {
  expect(
    reachableToolsGeometry({ x: 3400, y: 100, width: 2000, height: 1000, maximized: true }, [
      { x: 0, y: 0, width: 1280, height: 800 },
    ]),
  ).toEqual({ x: 0, y: 0, width: 1280, height: 800, maximized: true });
});
it("preserves reachable negative-coordinate monitor bounds and rejects corrupt layout", () => {
  expect(
    reachableToolsGeometry({ x: -1800, y: 20, width: 900, height: 700 }, [
      { x: -1920, y: 0, width: 1920, height: 1080 },
    ]),
  ).toMatchObject({ x: -1800, y: 20, width: 900, height: 700 });
  expect(
    reachableToolsGeometry({ x: NaN, y: 0, width: 900, height: 700 }, [
      { x: 0, y: 0, width: 1920, height: 1080 },
    ]),
  ).toBeNull();
});
