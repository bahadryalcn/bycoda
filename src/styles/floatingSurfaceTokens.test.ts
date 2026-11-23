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
  expect(ruleBody(previewCss, "html.theme-light .explorer-file-drag-preview")).not.toContain(
    "background:",
  );
});

it("derives a single floating ground from the active theme for Pure and Tinted", () => {
  expect(indexCss.match(/--ui-surface-floating: color-mix\(/g)).toHaveLength(1);
  expect(indexCss).toContain("--ui-floating-base: var(--ui-layer-base);");
  expect(indexCss).toMatch(/--ui-surface-floating: color-mix\([^;]+var\(--ui-floating-base\)/);
  for (const selector of [
    'html[data-canvas-background="pure"]',
    'html.theme-light[data-canvas-background="pure"]',
  ]) {
    expect(ruleBody(indexCss, selector)).not.toMatch(/--ui-(?:surface-floating:|floating-)/);
  }
  expect(ruleBody(indexCss, "html.has-workspace-background")).toContain(
    "--ui-floating-base: color-mix(in oklab, var(--ui-tint-base) 35%, var(--ui-layer-base));",
  );
  expect(indexCss).toContain("--ui-surface-floating: Canvas;");
  expect(indexCss).toContain("--ui-floating-edge: CanvasText;");
  expect(indexCss).toContain("--ui-floating-shadow: none;");
});

it("uses canonical floating paint for legacy names and the live Arc bridge", () => {
  expect(indexCss).toContain("--ui-dialog-frame: var(--ui-floating-edge);");
  expect(indexCss).toContain("--ui-elevation-floating: var(--ui-floating-shadow);");
  expect(indexCss).toContain("--ui-radius-popup: var(--ui-radius-floating);");
  expect(surfaceRolesCss).toContain("--ui-surface-danger-floating: var(--ui-surface-floating);");
  const backdrop = ruleBody(indexCss, ".popover-backdrop,\n.popover-solid,\n.popover-frosted");
  expect(backdrop).toContain("background: var(--ui-surface-floating);");
  expect(backdrop).not.toMatch(/backdrop-filter|box-shadow/);
  const arc = ruleBody(arcCss, ".bycoda-arc");
  expect(arc).toContain("--surface-raised: var(--ui-surface-floating);");
  expect(arc).toContain("--shadow-floating: var(--ui-floating-shadow);");
  expect(arc).toContain("--control-on: var(--ui-control-on);");
  expect(ruleBody(arcCss, ".bycoda-arc-menu")).toContain("--border: var(--ui-floating-edge);");
});
