import { defineRule, isMethodCall } from "../define-rule.mjs";

export default defineRule({
  files: ["src/**", "host/**"],
  ignores: ["**/*.test.ts", "**/*.test.tsx", "src/shared/lib/time/**"],
  message:
    "`new Date(value).toISOString()` throws a RangeError on an invalid date and takes the whole React tree down. Use `isoTimestamp(value)` from src/shared/lib/time/timestamps.ts, which returns undefined for invalid input.",
  create: (_context, report) => ({
    CallExpression(node) {
      if (!isMethodCall(node, "toISOString")) return;
      const date = node.callee.object;
      if (
        date.type === "NewExpression" &&
        date.callee.type === "Identifier" &&
        date.callee.name === "Date" &&
        date.arguments.length === 1
      )
        report(node);
    },
  }),
});
