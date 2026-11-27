import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Regression for #901: a pane that mounts after the hook's first effect must still be clamped
// when its parent shrinks, so the parent is observed from the pane ref through observeResize.
const source = readFileSync(new URL("./useDragResize.ts", import.meta.url), "utf8");

it("observes the pane's parent through the shared observeResize helper", () => {
  expect(source).toMatch(/import \{ observeResize \} from "\.\.\/lib\/observeResize";/);
  expect(source).not.toMatch(/new ResizeObserver\(/);
});

it("subscribes to the parent from the pane ref, not once at effect time", () => {
  expect(source).toMatch(
    /if \(el\.parentElement\) parentWatch\.current = observeResize\(el\.parentElement, reconcile\);/,
  );
  expect(source).not.toMatch(/observer\.observe\(/);
});

it("releases the parent subscription when the pane ref is swapped or unmounted", () => {
  expect(source).toMatch(/parentWatch\.current\?\.\(\);\s*parentWatch\.current = null;/);
});

it("keeps the window resize listener and re-clamps on min changes", () => {
  expect(source).toMatch(/window\.addEventListener\("resize", reconcile\);/);
  expect(source).toMatch(/\}, \[reconcile, min\]\);/);
});

it("has no garbled characters in the JSDoc example", () => {
  expect(source).not.toContain("�");
});
