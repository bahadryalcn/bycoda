import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * Regression for #1350: arc.css stripped border, outline and box-shadow with !important from every
 * role=option/menuitem*, so components could not draw a selected border or focus ring without their
 * own !important. The reset now sits at zero specificity and the focus fallback uses the shared ring.
 */
const arc = readFileSync("src/styles/arc.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const ROLE_RULE = /\[role="option"\]|\[role="menuitem"\]/;

function roleRules(): string[] {
  return arc.split("}").filter((chunk) => ROLE_RULE.test(chunk));
}

it("never forces a reset with !important on option and menu item roles", () => {
  const rules = roleRules();
  expect(rules.length).toBeGreaterThan(0);
  for (const rule of rules) expect(rule).not.toContain("!important");
});

it("resets border and shadow through a zero-specificity :where() rule", () => {
  expect(arc).toMatch(
    /:where\(:root\)\s*:where\(\[role="option"\][^{]*\)\s*\{\s*border:\s*0;\s*box-shadow:\s*none;/,
  );
});

it("draws the keyboard focus fallback with the shared focus ring", () => {
  expect(arc).toMatch(/:focus-visible:not\([^)]*\)\s*\{[^}]*box-shadow:\s*var\(--ui-focus-ring\)/);
});
