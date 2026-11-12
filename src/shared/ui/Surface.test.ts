// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { Surface, surfaceAttributes, type SurfaceAppearance, type SurfaceVariant } from "./Surface";
import styles from "./Surface.module.css";

const css = readFileSync("src/shared/ui/Surface.module.css", "utf8");
const roles = readFileSync("src/styles/surface-roles.css", "utf8").replace(/\s+/g, "");

it("keeps the existing default markup and adds no opt-in attributes", () => {
  expect(renderToStaticMarkup(createElement(Surface, null, "body"))).toBe(
    `<div data-variant="plain" data-padding="md" class="${styles.surface}">body</div>`,
  );
  expect(css).toContain("border: 1px solid transparent");
  expect(css).toContain("border-radius: var(--ui-radius-card)");
  expect(css).toContain(".surface .surface");
});

it("partial appearance adds no layout, frame, padding or implicit role", () => {
  const attributes = surfaceAttributes({}, "flex gap-2");
  expect(attributes.className).toBe(`${styles.appearance} flex gap-2`);
  expect(
    Object.entries(attributes).filter(([key, value]) => key !== "className" && value !== undefined),
  ).toEqual([]);
  expect(css).not.toMatch(/\.appearance\s*\{[^}]*(?:display|padding|border:|min-inline-size)/s);
});

const variants: [SurfaceVariant, string][] = [
  ["canvas", "--ui-workspace-canvas"],
  ["workspace-panel", "--ui-workspace-panel"],
  ["canvas-chat", "--ui-workspace-canvas-chat"],
  ["canvas-surface", "--ui-workspace-canvas-surface"],
  ["reading-base", "--ui-workspace-reading-base"],
  ["navigation-quiet", "--ui-navigation-quiet"],
  ["selected", "--ui-surface-selected"],
  ["transparent", "transparent"],
  ["danger", "--ui-surface-danger"],
  ["danger-floating", "--ui-surface-danger-floating"],
  ["translucent", "--ui-surface-translucent"],
  ["effort", "--ui-effort-fill"],
  ["effort-ultra", "--ui-effort-ultra-fill"],
  ["base", "--color-background-base"],
  ["panel", "--ui-surface-panel"],
  ["floating", "--ui-surface-floating"],
  ["fill-subtle", "--ui-fill-subtle"],
];
it.each(variants)("paints %s through the existing semantic ground", (variant, token) => {
  expect(surfaceAttributes({ variant })["data-surface-variant"]).toBe(variant);
  expect(renderToStaticMarkup(createElement(Surface, { variant }))).toContain(
    `data-variant="${variant}"`,
  );
  const block = css.slice(css.indexOf(`.surface[data-variant="${variant}"]`)).split("}")[0];
  expect(block).toContain(token);
  expect(block).not.toMatch(/padding|display|height|opacity/);
});

it.each(["none", "pane", "card", "stroke", "neutral", "settings"] as const)(
  "supports opt-in frame %s",
  (frame) => {
    expect(surfaceAttributes({ frame })["data-surface-frame"]).toBe(frame);
    expect(renderToStaticMarkup(createElement(Surface, { frame }))).toContain(
      `data-surface-frame="${frame}"`,
    );
    expect(css).toContain(`[data-surface-frame="${frame}"]`);
  },
);

it.each([
  "all",
  "block-start",
  "block-end",
  "inline-start",
  "inline-end",
  "block",
  "inline",
  "top",
  "bottom",
  "left",
  "right",
] as const)("keeps the requested frame edges %s", (edge) => {
  expect(surfaceAttributes({ frame: "pane", edge })["data-surface-edge"]).toBe(edge);
  expect(renderToStaticMarkup(createElement(Surface, { edge }))).toContain(
    `data-surface-edge="${edge}"`,
  );
  if (edge !== "all") expect(css).toContain(`border-${edge}-width: 1px`);
});

it.each(["none", "xs", "sm", "row", "control", "card", "panel", "popup", "pill"] as const)(
  "keeps explicit radius %s separate from layout",
  (radius) => {
    expect(surfaceAttributes({ radius })["data-surface-radius"]).toBe(radius);
    expect(renderToStaticMarkup(createElement(Surface, { radius }))).toContain(
      `data-surface-radius="${radius}"`,
    );
    expect(css).toContain(`[data-surface-radius="${radius}"]`);
  },
);

it.each(["solid", "dashed"] as const)(
  "supports border style %s without changing width",
  (borderStyle) => {
    const appearance: SurfaceAppearance = { borderStyle };
    expect(surfaceAttributes(appearance)["data-surface-border-style"]).toBe(borderStyle);
    expect(renderToStaticMarkup(createElement(Surface, appearance))).toContain(
      `data-surface-border-style="${borderStyle}"`,
    );
    expect(css).toContain(`border-style: ${borderStyle}`);
  },
);

it("keeps theme recipes exact and derives them from existing grounds", () => {
  expect(roles).toContain("color-mix(insrgb,var(--ui-tone-danger-subtle)45%,var(--ui-surface))");
  expect(roles).toContain(
    "color-mix(insrgb,var(--ui-tone-danger-subtle)45%,var(--ui-surface-floating))",
  );
  expect(roles).toContain("color-mix(inoklab,var(--color-background-base)45%,transparent)");
  expect(roles).not.toMatch(/#[0-9a-f]|rgba?\(/i);
});
