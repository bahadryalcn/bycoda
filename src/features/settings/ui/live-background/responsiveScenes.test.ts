import { describe, expect, it } from "vitest";
import { createCodeVisageScene, createLatentFaceScene, mouthOpening } from "./latentFace";
import { createNeuralTreeScene } from "./neuralTree";
import { createThoughtWeaverScene } from "./thoughtWeaver";
import type { LiveBackgroundPalette } from "./types";

const palette: LiveBackgroundPalette = {
  content: "content-token",
  accent: "accent-token",
  monoFont: "monospace",
};

/** Capture rendered geometry and paint state, without a real GPU or timing loop. */
function recordingContext() {
  const calls: unknown[][] = [];
  const context = new Proxy({} as CanvasRenderingContext2D, {
    get(_target, key) {
      return (...args: unknown[]) => calls.push([key, ...args]);
    },
    set(_target, key, value) {
      calls.push([key, value]);
      return true;
    },
  });
  return { context, calls };
}

const scenes = [
  ["latent face", createLatentFaceScene],
  ["code visage", createCodeVisageScene],
  ["neural tree", createNeuralTreeScene],
  ["thought weaver", createThoughtWeaverScene],
] as const;

describe.each(scenes)("%s conversation response", (_name, createScene) => {
  it("keeps idle artwork fixed regardless of elapsed time", () => {
    const scene = createScene(palette);
    scene.resize(1440, 900);
    const first = recordingContext();
    const later = recordingContext();
    scene.draw(first.context, 0, 0.1, { presence: 0 });
    scene.draw(later.context, 100, 0.1, { presence: 0 });
    expect(later.calls).toEqual(first.calls);
  });

  it("moves visible geometry during a reply", () => {
    const scene = createScene(palette);
    scene.resize(1440, 900);
    const first = recordingContext();
    const later = recordingContext();
    scene.draw(first.context, 0.12, 0.1, { presence: 1 });
    scene.draw(later.context, 0.42, 0.1, { presence: 1 });
    const geometry = (calls: unknown[][]) =>
      calls.filter(([name]) =>
        ["fillText", "arc", "moveTo", "lineTo", "bezierCurveTo"].includes(name as string),
      );
    expect(geometry(later.calls)).not.toEqual(geometry(first.calls));
  });

  it("bounds drawing work when the pane grows", () => {
    const scene = createScene(palette);
    const normal = recordingContext();
    const large = recordingContext();
    scene.resize(1440, 900);
    scene.draw(normal.context, 0, 0, { presence: 1 });
    scene.resize(14400, 9000);
    scene.draw(large.context, 0, 0, { presence: 1 });
    expect(large.calls.length).toBeLessThanOrEqual(normal.calls.length + 30);
    expect(large.calls.length).toBeLessThan(5000);
  });
});

describe.each([
  ["latent face", createLatentFaceScene],
  ["code visage", createCodeVisageScene],
] as const)("%s figure", (_name, createScene) => {
  const glyphs = (calls: unknown[][]) => calls.filter(([name]) => name === "fillText").length;

  it("appears only during a reply and leaves the pane empty at rest", () => {
    const scene = createScene(palette);
    scene.resize(1440, 900);
    const initial = recordingContext();
    const active = recordingContext();
    const resting = recordingContext();
    scene.draw(initial.context, 0, 0, { presence: 0 });
    scene.draw(active.context, 0.15, 0.1, { presence: 1 });
    scene.draw(resting.context, 8, 0.1, { presence: 0 });
    expect(initial.calls.map(([name]) => name)).toEqual(["clearRect"]);
    expect(glyphs(active.calls)).toBeGreaterThan(300);
    expect(resting.calls).toEqual(initial.calls);
  });

  it("kindles gradually as the reply fades in", () => {
    const scene = createScene(palette);
    scene.resize(1440, 900);
    const faint = recordingContext();
    const full = recordingContext();
    scene.draw(faint.context, 1, 0, { presence: 0.25 });
    scene.draw(full.context, 1, 0, { presence: 1 });
    expect(glyphs(faint.calls)).toBeGreaterThan(0);
    expect(glyphs(faint.calls)).toBeLessThan(glyphs(full.calls) * 0.6);
  });
});

it("moves the lips only during a reply", () => {
  const openings = new Set<number>();
  for (let frame = 0; frame < 120; frame++) {
    expect(mouthOpening(frame / 30, 0)).toBe(0);
    openings.add(Math.round(mouthOpening(frame / 30, 1) * 10));
  }
  expect(openings.has(0)).toBe(true);
  expect(openings.size).toBeGreaterThanOrEqual(5);
});
