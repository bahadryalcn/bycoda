import { describe, expect, it } from "vitest";
import { formation } from "./formation";

describe("halay formation", () => {
  it("leaves the floor empty until a dancer joins", () => {
    expect(formation(0, 900, 1600)).toEqual([]);
  });

  it("places the leader at the front in either aspect ratio", () => {
    for (const [width, height] of [[900, 1600], [1600, 900]]) {
      const dancers = formation(72, width, height);
      expect(dancers[0].y).toBe(Math.max(...dancers.map((dancer) => dancer.y)));
      expect(dancers.every(({ x, y }) => x > 0 && x < width && y > 0 && y < height)).toBe(true);
    }
  });

  it("caps both rings at sixty dancers", () => {
    const dancers = formation(150, 900, 1600);
    expect(dancers.filter(({ ring }) => ring === 0)).toHaveLength(60);
    expect(dancers.filter(({ ring }) => ring === 1)).toHaveLength(60);
  });
});
