import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * Regression for #535: at the 168px minimum rail, seven joined tool icons shared one row and each
 * target fell to about 20px. Above the icon rail the joined group must wrap into grid cells of at
 * least 28px, and the Usage footer, which reuses `.bycoda-rail-tools`, must keep its own layout.
 */
const css = readFileSync("src/styles/bycoda.css", "utf8");

it("wraps the joined rail tools into cells of at least 28px above the icon rail", () => {
  expect(css).toMatch(
    /@container rail \(width > 140px\) \{\s*\.bycoda-rail-tools:not\(\.bycoda-rail-tools--footer\) > \[data-button-group="joined"\] \{\s*display: grid;\s*grid-template-columns: repeat\(auto-fit, minmax\(28px, 1fr\)\);/,
  );
});
