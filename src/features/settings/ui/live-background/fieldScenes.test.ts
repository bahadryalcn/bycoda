import { describe, expect, it } from "vitest";
import { createCodeRainScene } from "./codeRain";
import { createDotGridScene } from "./dotGrid";
import type { LiveBackgroundScene } from "./types";

const palette = { content: "content-token", accent: "accent-token", monoFont: "monospace" };

function capture(scene: LiveBackgroundScene, time: number, delta: number, presence: number) {
  const marks: unknown[][] = [];
  const context = {
    globalAlpha: 1,
    fillStyle: "",
    clearRect() {},
    fillRect(...args: number[]) {
      marks.push([this.globalAlpha, this.fillStyle, ...args]);
    },
    fillText(...args: unknown[]) {
      marks.push([this.globalAlpha, this.fillStyle, ...args]);
    },
  };
  scene.draw(context as unknown as CanvasRenderingContext2D, time, delta, { presence });
  expect(context.globalAlpha).toBe(1);
  return marks;
}

describe.each([
  ["dot grid", createDotGridScene, 1800],
  ["code rain", createCodeRainScene, 1400],
] as const)("%s full-pane field", (_name, createScene, budget) => {
  it.each([
    [390, 800],
    [7680, 4320],
    [1000000, 1],
  ])("bounds visible drawing work at %sx%s and covers both sides of the pane", (width, height) => {
    const scene = createScene(palette);
    scene.resize(width, height);
    const marks = capture(scene, 12, 0, 0);
    expect(marks.length).toBeGreaterThan(0);
    expect(marks.length).toBeLessThanOrEqual(budget);
    const xs = marks.map((mark) => Number(mark[mark.length - (_name === "dot grid" ? 4 : 2)]));
    expect(Math.min(...xs)).toBeLessThan(width * 0.25);
    expect(Math.max(...xs)).toBeGreaterThan(width * 0.75);
  });

  it("holds the same composition at rest and visibly changes throughout replies", () => {
    const scene = createScene(palette);
    scene.resize(1200, 800);
    const rest = capture(scene, 12, 0, 0);
    expect(capture(scene, 500, 0.1, 0)).toEqual(rest);
    const reply = capture(scene, 20, 0.1, 1);
    expect(reply).not.toEqual(rest);
    expect(capture(scene, 20.1, 0.1, 1)).not.toEqual(reply);
  });

  it("releases empty geometry on resize", () => {
    const scene = createScene(palette);
    scene.resize(1200, 800);
    scene.resize(0, 0);
    expect(capture(scene, 12, 0, 1)).toEqual([]);
  });
});
