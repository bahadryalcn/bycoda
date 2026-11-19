import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * Regression for #331: the editor blame hover card and the explorer drag preview built their own
 * radius, background and shadow instead of the shared floating-surface tokens, so adjacent floating
 * chips diverged from each other and from theme or elevation changes.
 */
const css = [
  "src/features/files/editor/editorBlame.css",
  "src/features/files/ui/explorerDragPreview.css",
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

function ruleBody(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start));
}

it("draws the blame hover card with the shared floating radius, surface and elevation", () => {
  const rule = ruleBody(".cm-blameCard");
  expect(rule).toContain("border-radius: var(--ui-radius-popup);");
  expect(rule).toContain("background: var(--ui-surface-floating);");
  expect(rule).toContain("box-shadow: var(--ui-elevation-floating);");
});

it("draws the explorer drag preview with the shared floating radius, surface and elevation", () => {
  const rule = ruleBody(".explorer-file-drag-preview");
  expect(rule).toContain("border-radius: var(--ui-radius-popup);");
  expect(rule).toContain("background: var(--ui-surface-floating);");
  expect(rule).toContain("box-shadow: var(--ui-elevation-floating);");
});

it("lets the Explorer drag preview styles cascade in either theme", () => {
  const previewCss = readFileSync("src/features/files/ui/explorerDragPreview.css", "utf8");
  expect(previewCss).not.toContain("!important");
  expect(ruleBody("html.theme-light .explorer-file-drag-preview")).not.toContain("background:");
});
