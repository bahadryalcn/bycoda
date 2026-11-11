import { defineRule, isMethodCall, isString } from "../define-rule.mjs";

const ELLIPSIS = /[…]|\.\.\.`$/;
const isSliceFromStart = (node) =>
  isMethodCall(node, "slice") &&
  node.arguments.length === 2 &&
  node.arguments[0].type === "Literal" &&
  node.arguments[0].value === 0;

export default defineRule({
  files: ["src/**", "host/**"],
  ignores: ["**/*.test.ts", "**/*.test.tsx", "src/shared/lib/text/**"],
  message:
    "`slice(0, n)` cuts UTF-16 code units and can leave half of an emoji; native (Rust) JSON parsing then rejects the string. Use `truncateGraphemes(text, n)` from src/shared/lib/text/truncate.ts for user-visible or IPC-bound text.",
  create: (context, report) => ({
    BinaryExpression(node) {
      if (node.operator !== "+" || !isString(node.right)) return;
      const suffix = node.right.value;
      if (suffix !== "…" && suffix !== "...") return;
      const trimmed =
        suffix === "…" &&
        (isMethodCall(node.left, "trim") || isMethodCall(node.left, "trimEnd")) &&
        node.left.arguments.length === 0;
      if (isSliceFromStart(trimmed ? node.left.callee.object : node.left)) report(node);
    },
    TemplateLiteral(node) {
      if (!node.expressions.some(isSliceFromStart)) return;
      const text = context.sourceCode.text.slice(node.range[0], node.range[1]);
      if (ELLIPSIS.test(text)) report(node);
    },
  }),
});
