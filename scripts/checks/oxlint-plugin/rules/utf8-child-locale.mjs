import { defineRule, isString } from "../define-rule.mjs";

export default defineRule({
  files: ["src/**", "host/**"],
  ignores: ["**/*.test.ts"],
  message:
    '`LC_ALL=C` makes git and grep treat input as single-byte text, so case-insensitive matching of non-ASCII letters (ş, İ, ç, ö) never succeeds and binary detection changes. Use `LC_ALL: "C.UTF-8"` (predictable messages, UTF-8 aware matching).',
  create: (_context, report) => ({
    Property(node) {
      if (node.computed || node.parent.type !== "ObjectExpression") return;
      const key = node.key;
      const isLcAll =
        (key.type === "Identifier" && key.name === "LC_ALL") ||
        (isString(key) && key.raw === '"LC_ALL"');
      if (isLcAll && isString(node.value) && node.value.value === "C") report(node);
    },
  }),
});
