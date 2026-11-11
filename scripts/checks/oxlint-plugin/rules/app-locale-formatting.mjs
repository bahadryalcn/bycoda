import { calleeName, defineRule, isMethodCall } from "../define-rule.mjs";

const LOCALE_METHODS = ["toLocaleDateString", "toLocaleTimeString", "toLocaleString"];
const INTL_FORMATTERS = new Set([
  "Intl.DateTimeFormat",
  "Intl.RelativeTimeFormat",
  "Intl.NumberFormat",
]);

export default defineRule({
  files: ["src/**"],
  ignores: [
    "**/*.test.ts",
    "**/*.test.tsx",
    "src/shared/lib/intl.ts",
    "src/shared/lib/numbers.ts",
    "src/shared/lib/time/**",
    "src/shared/ui/**",
    "src/shared/i18n/**",
  ],
  message:
    "Format dates, times, numbers, byte sizes and durations through the shared helpers so every surface agrees on locale, calendar day and density: formatDate / formatNumber (src/shared/i18n/core.ts), formatRelativeTime / formatBytes / formatDuration (src/shared/i18n/format.ts), dateTimeFormat / relativeTimeFormat (src/shared/lib/intl.ts) or the <Timestamp> component. Direct toLocale*String / new Intl.*Format calls belong only in those helpers.",
  create: (_context, report) => ({
    CallExpression(node) {
      if (
        LOCALE_METHODS.some((name) => isMethodCall(node, name)) ||
        INTL_FORMATTERS.has(calleeName(node.callee))
      )
        report(node);
    },
    NewExpression(node) {
      if (INTL_FORMATTERS.has(calleeName(node.callee))) report(node);
    },
  }),
});
