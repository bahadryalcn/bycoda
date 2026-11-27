import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * Regression for #344: the --space-* scale and the radius aliases were declared twice, once on :root
 * in index.css and again on .bycoda-arc in arc.css, so an edit to one copy silently changed spacing
 * inside Arc controls only. The owner is index.css; .bycoda-arc must inherit it.
 */
const index = readFileSync("src/styles/index.css", "utf8");
const arc = readFileSync("src/styles/arc.css", "utf8");

const SCALE_DECLARATION = /^\s*--((?:ui-)?space-\d+|radius-(?:pill|control|panel|surface)):/gm;

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

it("publishes the four-pixel rem scale and keeps the established spacing aliases", () => {
  const scale = {
    1: "0.25rem",
    2: "0.5rem",
    3: "0.75rem",
    4: "1rem",
    5: "1.25rem",
    6: "1.5rem",
    8: "2rem",
    10: "2.5rem",
    12: "3rem",
  };
  for (const [step, value] of Object.entries(scale)) {
    expect(index.match(new RegExp(`^  --ui-space-${step}: [^;]+;`, "gm"))).toEqual([
      `  --ui-space-${step}: ${value};`,
    ]);
  }
  expect(index).toContain("--space-2: 0.375rem;");
  expect(index).toContain("--space-3: 0.625rem;");
  expect(index).toContain("--space-4: 0.875rem;");
  const legacyAliases = { 1: 1, 5: 4, 6: 5, 8: 6, 10: 8, 12: 10, 16: 12 };
  for (const [legacy, canonical] of Object.entries(legacyAliases)) {
    expect(index).toContain(`--space-${legacy}: var(--ui-space-${canonical});`);
  }
});

it("does not re-declare the scale on the .bycoda-arc root block in arc.css", () => {
  const root = ruleBody(arc, ".bycoda-arc");
  expect(root.match(SCALE_DECLARATION)).toBeNull();
});

it("keeps only the card override of --space-5 and --space-6 in arc.css", () => {
  const card = ruleBody(arc, ".bycoda-arc-card");
  expect(card).toContain("--space-5: var(--ui-space-3);");
  expect(card).toContain("--space-6: 0.875rem;");
});
