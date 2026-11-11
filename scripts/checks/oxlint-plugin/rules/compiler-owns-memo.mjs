import { calleeName, defineRule } from "../define-rule.mjs";

const MEMO = /^(React\.)?(useMemo|useCallback|memo)$/;

export default defineRule({
  files: [
    "src/shared/ui/**",
    "src/features/sessions/ui/**",
    "src/features/sync/**",
    "src/features/terminal/**",
    "src/features/projects/**",
    "src/features/notifications/**",
    "src/app/shell/**",
  ],
  message:
    'The React Compiler compiles the components and hooks of this folder and memoizes values, callbacks and components itself. Drop `useMemo`, `useCallback`, `memo()` and the `"use memo"` directive here: compute the value in render and pass plain functions. If the compiler skips this function (a `[react-compiler]` build warning names it), fix what it cannot prove safe, or keep the hook with `// oxlint-disable-next-line bycoda/compiler-owns-memo -- <why the compiler cannot memoize this>` on the line above.',
  create: (_context, report) => visitors(report),
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
