import { expect, it } from "vitest";
import { imageGuidance } from "./imageGuidance";
import { IMAGE_MODELS_KEY } from "../../../shared/model/host-contracts/image-models";

it("keeps automatic sessions to one discovery line", () => {
  const hint = imageGuidance(undefined);
  expect(hint).toContain("images.status");
  expect(hint.split("\n")).toHaveLength(1);
});

it("names only the selected models with their capabilities", () => {
  const hint = imageGuidance({ [IMAGE_MODELS_KEY]: '["antigravity","codex"]' });
  expect(hint).toContain("Nano Banana (Antigravity) [antigravity]");
  expect(hint).toContain("raster only, no SVG, GIF");
  expect(hint).toContain("highest quality");
  expect(hint).toContain("quick or simple images");
  expect(hint).toContain("Codex ImageGen [codex]");
  expect(hint).toContain("use no other image model");
  expect(hint).not.toContain("Gemini");
  expect(imageGuidance({ [IMAGE_MODELS_KEY]: "[]" })).toBe("");
});
