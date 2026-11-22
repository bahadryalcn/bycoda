import { defineRule, TESTS } from "../define-rule.mjs";

const textProps = new Set(["title", "description", "message", "label", "children"]);
const isError = (node) =>
  node?.type === "Identifier" &&
  (/^(e|err|error|cause|reason)$/i.test(node.name) || node.name.endsWith("Error"));

function rendersError(node, interpolated = false) {
  switch (node.type) {
    case "Identifier":
      return interpolated && isError(node);
    case "MemberExpression":
      return !node.computed && node.property.name === "message" && isError(node.object);
    case "CallExpression": {
      const { callee, arguments: args } = node;
      return (
        (callee.type === "Identifier" && callee.name === "String" && isError(args[0])) ||
        (callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.name === "toString" &&
          isError(callee.object))
      );
    }
    case "TemplateLiteral":
      return node.expressions.some((expression) => rendersError(expression, true));
    case "ConditionalExpression":
      return (
        rendersError(node.consequent, interpolated) || rendersError(node.alternate, interpolated)
      );
    case "LogicalExpression":
      return (
        (node.operator !== "&&" && rendersError(node.left, interpolated)) ||
        rendersError(node.right, interpolated)
      );
    case "ChainExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
      return rendersError(node.expression, interpolated);
    default:
      return false;
  }
}

/** `toast.show(...)` or `<anything>.toast.show(...)`, the imperative path used from .ts hooks. */
function isToastShow(node) {
  const callee = node.callee;
  if (callee.type !== "MemberExpression" || callee.computed || callee.property.name !== "show")
    return false;
  const target = callee.object;
  return (
    (target.type === "Identifier" && target.name === "toast") ||
    (target.type === "MemberExpression" && !target.computed && target.property.name === "toast")
  );
}

export default defineRule({
  files: ["src/**/*.ts", "src/**/*.tsx"],
  ignores: [...TESTS, "**/*.spec.ts", "**/*.spec.tsx", "src/shared/ui/ErrorDetails*"],
  message:
    "Show what happened in a translated title and put raw error text in the shared ErrorDetails, or use the existing describe/present error helpers. See K1.",
  create(_context, report) {
    return {
      CallExpression(node) {
        if (!isToastShow(node) || node.arguments[0]?.type !== "ObjectExpression") return;
        for (const property of node.arguments[0].properties) {
          if (
            property.type === "Property" &&
            !property.computed &&
            textProps.has(property.key.name) &&
            rendersError(property.value)
          ) {
            report(property.value);
          }
        }
      },
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (
          (parent.type === "JSXElement" ||
            parent.type === "JSXFragment" ||
            (parent.type === "JSXAttribute" && textProps.has(parent.name.name))) &&
          rendersError(node.expression)
        ) {
          report(node.expression);
        }
      },
    };
  },
});
