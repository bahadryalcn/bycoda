import { defineRule } from "../define-rule.mjs";

const FORMATTER = /^format(Bytes|FileSize|Relative|RelativeTime|Duration|Elapsed|Date|Compact)/;
const named = (node) => node?.type === "Identifier" && FORMATTER.test(node.name);
const isFunction = (node) =>
  node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";

export default defineRule({
  files: ["src/features/**", "src/app/**"],
  message:
    "Define date, number, byte and duration formatters only in src/shared/i18n. Import the shared formatter instead of defining a local format helper. Preserve existing output through shared options. (Constructing Intl formatters is rule bycoda/app-locale-formatting.)",
  create: (_context, report) => ({
    FunctionDeclaration(node) {
      if (named(node.id)) report(node);
    },
    FunctionExpression(node) {
      if (named(node.id)) report(node);
    },
    MethodDefinition(node) {
      if (!node.computed && named(node.key)) report(node);
    },
    Property(node) {
      if (node.computed || !named(node.key) || node.parent.type !== "ObjectExpression") return;
      if (node.method || isFunction(node.value)) report(node);
    },
    VariableDeclarator(node) {
      if (named(node.id) && isFunction(node.init)) report(node);
    },
  }),
});
