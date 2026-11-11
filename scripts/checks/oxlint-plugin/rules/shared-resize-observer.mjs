import { defineRule, TESTS } from "../define-rule.mjs";

export default defineRule({
  files: ["src/**"],
  ignores: [...TESTS, "src/shared/lib/observeResize.ts"],
  message:
    "Every `new ResizeObserver` adds its own observer and callback; a list of measuring rows then runs one per row on each layout. Use `observeResize(element, listener)` from src/shared/lib/observeResize.ts, which shares one observer per window and returns the unsubscribe function for the effect cleanup. If this caller needs observer options the helper lacks, keep it with `// oxlint-disable-next-line bycoda/shared-resize-observer -- <which option and why>` on the line above.",
  create: (_context, report) => ({
    NewExpression(node) {
      if (node.callee.type === "Identifier" && node.callee.name === "ResizeObserver") report(node);
    },
  }),
});
