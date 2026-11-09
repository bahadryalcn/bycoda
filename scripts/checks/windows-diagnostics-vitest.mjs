/** Exact-file Vitest child for the manual Windows diagnostic runner. */
import assert from "node:assert/strict";
import path from "node:path";
import { createVitest } from "vitest/node";
import { diagnosticPlan, repositoryRoot } from "./windows-diagnostics.mjs";

const [suite, file] = process.argv.slice(2);
const plan = diagnosticPlan({ suite, file });
assert(["host", "web"].includes(suite), "Only Host/web Vitest recipes may use this child");
const context = await createVitest({
  root: repositoryRoot,
  config: path.join(
    repositoryRoot,
    suite === "host" ? "host/vitest.config.ts" : "vitest.config.ts",
  ),
  include: [plan.file],
  watch: false,
  maxWorkers: 1,
  fileParallelism: false,
});
try {
  const specs = await context.globTestSpecifications();
  assert.equal(specs.length, 1, "Diagnostic must select exactly one test file");
  assert.equal(
    path.resolve(specs[0].moduleId),
    path.resolve(repositoryRoot, plan.file),
    "Vitest selected a different file",
  );
  const result = await context.start();
  if (
    result.unhandledErrors.length ||
    result.testModules.length !== 1 ||
    result.testModules[0].state() !== "passed"
  )
    process.exitCode = 1;
} finally {
  await context.close();
}
