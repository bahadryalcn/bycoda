import { readFileSync } from "node:fs";
import path from "node:path";
import { calleeName, defineRule } from "../define-rule.mjs";

/**
 * Files where the compiler skips a function (check-compiler-coverage.mjs counts them). Manual
 * memoization still carries the load there, so the ban starts once the file compiles in full.
 */
const skipped = new Set(
  Object.keys(
    JSON.parse(
      readFileSync(new URL("../../compiler-coverage-baseline.json", import.meta.url), "utf8"),
    ).counts,
  ),
);

const MEMO = /^(React\.)?(useMemo|useCallback|memo)$/;

export default defineRule({
  files: ["src/shared/ui/**", "src/features/sessions/ui/**", "src/app/shell/**"],
  message:
    'The React Compiler compiles every component and hook of this file and memoizes values, callbacks and components itself. Drop `useMemo`, `useCallback`, `memo()` and the `"use memo"` directive here: compute the value in render and pass plain functions. If the compiler skips this function (a `[react-compiler]` build warning names it), fix what it cannot prove safe, or keep the hook with `// oxlint-disable-next-line bycoda/compiler-owns-memo -- <why the compiler cannot memoize this>` on the line above.',
  create: (context, report) => {
    const file = path.relative(context.cwd, context.filename).replaceAll("\\", "/");
    if (skipped.has(file)) return {};
    return visitors(report);
  },
});

function visitors(report) {
  return {
    CallExpression(node) {
      if (MEMO.test(calleeName(node.callee) ?? "")) report(node);
    },
    ExpressionStatement(node) {
      if (node.expression.type === "Literal" && node.expression.value === "use memo") report(node);
    },
  };
}
