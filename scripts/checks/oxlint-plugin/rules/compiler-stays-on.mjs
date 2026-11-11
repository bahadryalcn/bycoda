import { defineRule } from "../define-rule.mjs";

export default defineRule({
  files: ["src/**"],
  message:
    '`"use no memo"` hides code the React Compiler cannot prove safe instead of fixing it. Remove the directive and fix the cause the `[react-compiler]` build warning names (a mutation after render, a ref read in render, state read outside React). The build guard already opts out functions that read state the compiler cannot see. If the opt-out must stay, put `// oxlint-disable-next-line bycoda/compiler-stays-on -- <what the compiler gets wrong here>` on the line above.',
  create: (_context, report) => ({
    ExpressionStatement(node) {
      if (node.expression.type === "Literal" && node.expression.value === "use no memo")
        report(node);
    },
  }),
});
