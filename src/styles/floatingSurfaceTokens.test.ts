import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * Regression for #331: the editor blame hover card and the explorer drag preview built their own
 * radius, background and shadow instead of the shared floating-surface tokens, so adjacent floating
 * chips diverged from each other and from theme or elevation changes.
 */
const sharedCss = readFileSync("src/shared/ui/Surface.module.css", "utf8");
const previewCss = readFileSync("src/features/files/ui/explorerDragPreview.css", "utf8");

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
