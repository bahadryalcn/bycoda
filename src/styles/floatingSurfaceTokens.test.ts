import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * Regression for #331: the editor blame hover card and the explorer drag preview built their own
 * radius, background and shadow instead of the shared floating-surface tokens, so adjacent floating
 * chips diverged from each other and from theme or elevation changes.
 */
const sharedCss = readFileSync("src/shared/ui/Surface.module.css", "utf8");
const previewCss = readFileSync("src/features/files/ui/explorerDragPreview.css", "utf8");
const indexCss = readFileSync("src/styles/index.css", "utf8");
const arcCss = readFileSync("src/styles/arc.css", "utf8");
const surfaceRolesCss = readFileSync("src/styles/surface-roles.css", "utf8");

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start));
}

it("routes imperative floating surfaces through the shared radius, fill and elevation", () => {
  expect(ruleBody(sharedCss, '.appearance[data-surface-radius="popup"]')).toContain(
    "border-radius: var(--ui-radius-popup);",
  );
  expect(ruleBody(sharedCss, '.appearance[data-surface-variant="floating"]')).toContain(
    "background: var(--ui-surface-floating);",
  );
  expect(ruleBody(sharedCss, '.appearance[data-surface-elevation="floating"]')).toContain(
    "box-shadow: var(--ui-elevation-floating);",
  );
});

it("lets the Explorer drag preview styles cascade in either theme", () => {
  expect(previewCss).not.toContain("!important");
  expect(previewCss).not.toMatch(/\b(?:background(?:-color)?|box-shadow|border-radius):/);
  expect(previewCss).not.toMatch(/\.theme-(?:light|dark)/);
  const tree = readFileSync("src/features/files/ui/FileTree.tsx", "utf8");
  expect(tree).toMatch(
    /surfaceAttributes\(\{\s*variant: "floating",\s*frame: "pane",\s*radius: "popup",\s*elevation: "floating",/,
  );
});

it("keeps the opaque floating ground on the theme step, never a gray content lift", () => {
  expect(indexCss).toContain("--ui-surface-floating: var(--ui-surface-raised);");
  expect(indexCss).not.toMatch(/--ui-floating-(?:base|lift)/);
  // Pure dark stays near the pure ground; Pure light returns to the raised step.
  expect(ruleBody(indexCss, 'html[data-canvas-background="pure"]')).toMatch(
    /--ui-surface-floating: color-mix\(\s*in srgb,\s*var\(--color-content\) calc\(10%/,
  );
  expect(ruleBody(indexCss, 'html.theme-light[data-canvas-background="pure"]')).toContain(
    "--ui-surface-floating: var(--ui-surface-raised);",
  );
  expect(indexCss).toContain("--ui-surface-floating: Canvas;");
  expect(indexCss).toContain("--ui-floating-edge: CanvasText;");
  expect(indexCss).toContain("--ui-floating-shadow: none;");
});

it("paints every in-window popup backdrop with the theme glass and keeps fallbacks opaque", () => {
  expect(indexCss).toMatch(/--ui-floating-glass: color-mix\(in oklab, var\(--color-background-base\)/);
  expect(indexCss).toContain("--ui-frosted-glass: var(--ui-floating-glass);");
  const after = (marker: string) => {
    const start = indexCss.indexOf(marker);
    expect(start, marker).toBeGreaterThanOrEqual(0);
    return indexCss.slice(start, indexCss.indexOf("}", start));
  };
  const glass = after("html:not([data-performance-no-blur]) :is(.popover-backdrop");
  expect(glass).toContain("background: var(--ui-floating-glass);");
  expect(glass).toContain("backdrop-filter: var(--ui-floating-glass-filter);");
  const fallback = after("  html :is(.popover-backdrop, .popover-frosted) {");
  expect(fallback).toContain("background: var(--ui-surface-floating);");
  expect(fallback).toContain("backdrop-filter: none;");
  expect(ruleBody(indexCss, ".popover-solid,\n.popover-backdrop,\n.popover-frosted")).toContain(
    "background: var(--ui-surface-floating);",
  );
  const host = readFileSync("src/shared/ui/NativePopupHost.tsx", "utf8");
  expect(host).toContain("<PopupBackdrop solid />");
});

it("uses canonical floating paint for legacy names and the live Arc bridge", () => {
  expect(indexCss).toContain("--ui-dialog-frame: var(--ui-floating-edge);");
  expect(indexCss).toContain("--ui-elevation-floating: var(--ui-floating-shadow);");
  expect(indexCss).toContain("--ui-radius-popup: var(--ui-radius-floating);");
  expect(surfaceRolesCss).toContain("--ui-surface-danger-floating: var(--ui-surface-floating);");
  const arc = ruleBody(arcCss, ".bycoda-arc");
  expect(arc).toContain("--surface-raised: var(--ui-surface-floating);");
  expect(arc).toContain("--shadow-floating: var(--ui-floating-shadow);");
  expect(arc).toContain("--control-on: var(--ui-control-on);");
  expect(ruleBody(arcCss, ".bycoda-arc-menu")).toContain("--border: var(--ui-floating-edge);");
});
