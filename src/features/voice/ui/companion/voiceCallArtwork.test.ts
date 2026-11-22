import { expect, it } from "vitest";
import { callArtworkState, paintCallOrb } from "./voiceCallArtwork";

it("distinguishes an interrupted connection and transcription without overriding mute or failure", () => {
  expect(callArtworkState("idle", "off")).toBe("off");
  expect(callArtworkState("connecting", "connecting")).toBe("connecting");
  expect(callArtworkState("reconnecting", "connecting")).toBe("reconnecting");
  expect(callArtworkState("reconnecting", "error")).toBe("error");
  expect(callArtworkState("live", "thinking", "transcribing")).toBe("transcribing");
  expect(callArtworkState("live", "thinking", "replying")).toBe("thinking");
  expect(callArtworkState("live", "muted", "transcribing")).toBe("muted");
  expect(callArtworkState("live", "assistant", "transcribing")).toBe("assistant");
});

it("paints different in-bounds particle silhouettes for each call phase", () => {
  const size = 420;
  const points: number[][] = [];
  const context = {
    beginPath() {},
    arc(x: number, y: number, radius: number) {
      points.push([x, y, radius]);
    },
    fill() {},
  } as unknown as CanvasRenderingContext2D;
  const phases = [
    "off",
    "connecting",
    "reconnecting",
    "listening",
    "user",
    "transcribing",
    "thinking",
    "assistant",
    "error",
  ] as const;
  const shapes = phases.map((phase) => {
    points.length = 0;
    paintCallOrb(context, size, phase, 2.4, phase === "user" ? 1 : 0, "currentColor", true);
    expect(points.length).toBeGreaterThan(200);
    expect(points.every(([x, y, radius]) => x > radius && y > radius)).toBe(true);
    expect(points.every(([x, y, radius]) => x + radius < size && y + radius < size)).toBe(true);
    return JSON.stringify(points);
  });
  expect(new Set(shapes).size).toBe(phases.length);
});
