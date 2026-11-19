// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Regression for #1355: Touch density raises the control-height tokens to 44px, so a fixed pixel
// row height in the checkout header must never sit below them.
const css = readFileSync(new URL("./CheckoutHeader.module.css", import.meta.url), "utf8");

it("sizes every checkout header row and control from the density-aware height tokens", () => {
  const heights = [...css.matchAll(/^\s*((?:min-)?(?:block-size|height)):\s*([^;]+);/gm)];
  expect(heights.length).toBeGreaterThan(0);
  for (const [, property, value] of heights) {
    expect(value, property).toContain("var(--ui-control-height");
  }
});
