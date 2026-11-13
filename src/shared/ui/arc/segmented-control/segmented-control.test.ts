import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("bounds segment labels and ellipsizes text inside equal-width cells", () => {
  const css = readFileSync(
    "src/shared/ui/arc/segmented-control/segmented-control.module.css",
    "utf8",
  );
  const label = css.match(/\.label\s*\{([^}]+)\}/)?.[1];
  const copy = css.match(/\.copy\s*\{([^}]+)\}/)?.[1];
  expect(label).toContain("min-width: 0");
  expect(label).toContain("max-width: 100%");
  expect(copy).toContain("min-width: 0");
  expect(copy).toContain("overflow: hidden");
  expect(copy).toContain("text-overflow: ellipsis");
  expect(copy).toContain("white-space: nowrap");
});
