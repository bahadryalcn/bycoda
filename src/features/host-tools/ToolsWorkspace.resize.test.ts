import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Regression for #1182: the dock must not re-read localStorage or reset its width on every
// window resize event. The shared useDragResize hook already re-clamps the saved preference.
const source = readFileSync(new URL("./ToolsWorkspace.tsx", import.meta.url), "utf8");

it("does not attach a raw window resize listener that restores the saved size", () => {
  expect(source).not.toMatch(/window\.addEventListener\(\s*"resize"/);
});

it("reads the saved dock width once instead of on every render", () => {
  expect(source).toContain("useState(readSize)");
  expect(source).toContain("initial: savedSize");
  expect(source).not.toMatch(/initial:\s*readSize\(\)/);
});

it("restores the saved width only when the layout key changes", () => {
  expect(source).toMatch(/restoredKey\.current === sizeKey\) return;/);
});
