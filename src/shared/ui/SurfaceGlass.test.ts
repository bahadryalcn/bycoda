import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { surfaceAttributes } from "./Surface";

const css = readFileSync("src/shared/ui/Surface.module.css", "utf8");

it("draws a glass floating panel as a veil over a blur, with opaque fallbacks", () => {
  const glass = surfaceAttributes({ variant: "floating", material: "glass" });
  expect(glass["data-surface-material"]).toBe("glass");
  expect(glass["data-surface-role"]).toBe("floating");
  expect(surfaceAttributes({ variant: "floating" })["data-surface-material"]).toBeUndefined();
  expect(css).toContain("background: var(--ui-chat-glass-fill, var(--ui-composer-surface));");
  expect(css).toContain("backdrop-filter: var(--ui-chat-glass-filter, none);");
});
