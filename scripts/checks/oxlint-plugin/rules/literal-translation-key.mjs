import { defineRule, isString } from "../define-rule.mjs";

function isStatic(node) {
  return isString(node) || (node?.type === "TemplateLiteral" && node.expressions.length === 0);
}

function definitionOf(context, node) {
  for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
    const binding = scope.set.get(node.name);
    if (binding) return binding.defs[0];
  }
  return undefined;
}

function isTranslationImport(definition, name) {
  return (
    definition?.type === "ImportBinding" &&
    definition.node.imported?.name === name &&
    /(?:^|\/)i18n(?:\/|$)/.test(definition.parent.source.value)
  );
}

export default defineRule({
  files: ["src/**/*.ts", "src/**/*.tsx"],
  ignores: [
    "**/*.test.ts",
    "**/*.test.tsx",
    "**/*.spec.ts",
    "**/*.spec.tsx",
    "**/test-support/**",
    "src/shared/i18n/**",
  ],
  message:
    "Use a literal message in t() so the locale check can extract it. Translate each branch at its declaration and pass values through positional slots.",
  create: (context, report) => ({
    CallExpression(node) {
      const callee = node.callee;
      if (callee.type !== "Identifier" || isStatic(node.arguments[0])) return;
      const definition = definitionOf(context, callee);
      const hook = definition?.type === "Variable" && definition.node.init?.callee;
      if (
        isTranslationImport(definition, "t") ||
        (hook?.type === "Identifier" && isTranslationImport(definitionOf(context, hook), "useT"))
      )
        report(node.arguments[0] ?? node);
    },
  }),
});
