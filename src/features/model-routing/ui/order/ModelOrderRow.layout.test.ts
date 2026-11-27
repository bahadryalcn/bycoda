import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

/**
 * Regression for #1282: the tag and quota column fixed at 14rem used to let a
 * "Next" badge, a skip badge and a nowrap quota label overflow toward the
 * profile badge column. happy-dom has no layout engine, so this checks the
 * declared classes: the column must be allowed to wrap inside its width and
 * the quota label must be allowed to break, which keeps it inside the column.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/features/model-routing/ui/order/ModelOrderRow.tsx"),
  "utf8",
);

it("wraps the tag and quota column inside its grid column", () => {
  const column = source.match(/<div className="([^"]*model-order:col-start-6\b[^"]*)"/)?.[1] ?? "";
  expect(column.split(/\s+/)).toEqual(expect.arrayContaining(["flex-wrap", "max-w-full"]));
});

it("lets the quota label break instead of forcing one line", () => {
  expect(source).not.toMatch(/whitespace-nowrap/);
});
