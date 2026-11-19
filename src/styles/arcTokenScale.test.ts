import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * Regression for #344: the --space-* scale and the radius aliases were declared twice, once on :root
 * in index.css and again on .bycoda-arc in arc.css, so an edit to one copy silently changed spacing
 * inside Arc controls only. The owner is index.css; .bycoda-arc must inherit it.
 */
const index = readFileSync("src/styles/index.css", "utf8");
const arc = readFileSync("src/styles/arc.css", "utf8");

const SCALE_DECLARATION = /^\s*--(space-\d+|radius-(?:pill|control|panel|surface)):/gm;

function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n}", start));
}

it("declares the spacing scale and radius aliases once, on :root in index.css", () => {
  expect(index.match(/^  --space-1: /gm)).toHaveLength(1);
  expect(index.match(/^  --radius-pill: /gm)).toHaveLength(1);
  expect(index.match(/^  --radius-control: /gm)).toHaveLength(1);
});

it("does not re-declare the scale on the .bycoda-arc root block in arc.css", () => {
  const root = ruleBody(arc, ".bycoda-arc");
  expect(root.match(SCALE_DECLARATION)).toBeNull();
});

it("keeps only the card override of --space-5 and --space-6 in arc.css", () => {
  const card = ruleBody(arc, ".bycoda-arc-card");
  expect(card).toContain("--space-5: 0.75rem;");
  expect(card).toContain("--space-6: 0.875rem;");
});
