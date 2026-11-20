// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Regression for #1180: the hover-node index must be rebuilt only when the mounted
// DOM can change, not after every commit (the effect used to have no dependency list).
const source = readFileSync(new URL("./UnifiedDiffView.tsx", import.meta.url), "utf8");

it("indexes hover nodes with an explicit dependency list, not on every commit", () => {
  const start = source.indexOf("hoverNodes.current = nodes;");
  expect(start).toBeGreaterThan(-1);
  const closing = source.indexOf("\n  }, [", start);
  expect(closing).toBeGreaterThan(start);
  const line = source.slice(closing + 1, source.indexOf("\n", closing + 1));
  expect(line).toBe("  }, [commentTarget, near, range.end, range.start, rows, splitRows]);");
});
