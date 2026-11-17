import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { surfaceAttributes } from "./Surface";

const css = readFileSync("src/shared/ui/Surface.module.css", "utf8");

it("draws a glass floating panel as a veil over a blur, with opaque fallbacks", () => {
  const glass = surfaceAttributes({ variant: "floating", material: "glass" });
  expect(glass["data-surface-material"]).toBe("glass");
  expect(glass["data-surface-role"]).toBe("floating");
  expect(surfaceAttributes({ variant: "floating" })["data-surface-material"]).toBeUndefined();
  expect(css).toContain("var(--ui-activity-dock-glass)");
  expect(css).toContain("var(--ui-activity-dock-filter)");
  // Streaming, disabled blur and reduced transparency keep the opaque composer surface.
  expect(css).toContain("[data-performance-no-blur]");
  expect(css).toContain('[data-session-streaming="true"]');
  expect(css).toContain("(prefers-reduced-transparency: reduce)");
});
