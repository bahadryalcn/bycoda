import { defineRule, isString } from "../define-rule.mjs";

const isTranslation = (node, maxArguments) =>
  node.type === "CallExpression" &&
  !node.optional &&
  node.callee.type === "Identifier" &&
  node.callee.name === "t" &&
  node.arguments.length >= 1 &&
  node.arguments.length <= maxArguments;

export default defineRule({
  files: ["src/**"],
  ignores: ["**/*.test.ts", "**/*.test.tsx"],
  message:
    'Concatenating a translated string with a literal breaks word order in other languages. Put the variable part into the message with a placeholder: t("Saved {p0} files", { p0: count }).',
  create: (_context, report) => ({
    BinaryExpression(node) {
      if (node.operator !== "+") return;
      if (
        (isTranslation(node.left, 2) && isString(node.right)) ||
        (isString(node.left) && isTranslation(node.right, 1))
      )
        report(node);
    },
  }),
});
