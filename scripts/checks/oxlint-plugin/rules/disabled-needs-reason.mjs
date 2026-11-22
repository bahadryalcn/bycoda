import path from "node:path";
import { defineRule } from "../define-rule.mjs";

const explanations = new Set(["disabledReason", "loadingLabel", "loading", "title"]);

function isSharedButton(name, context) {
  const namespace = name.type === "JSXMemberExpression";
  if (namespace && name.property.name !== "Button") return false;
  const identifier = namespace ? name.object : name;
  if (identifier.type !== "JSXIdentifier") return false;

  let scope = context.sourceCode.getScope(name);
  while (scope && !scope.set.has(identifier.name)) scope = scope.upper;
  const binding = scope?.set.get(identifier.name)?.defs[0];
  if (binding?.type !== "ImportBinding") return false;
  if (
    namespace
      ? binding.node.type !== "ImportNamespaceSpecifier"
      : binding.node.imported?.name !== "Button"
  ) {
    return false;
  }

  const source = binding.parent.source.value;
  const modulePath = source.startsWith("@/")
    ? path.resolve(context.cwd, "src", source.slice(2))
    : source.startsWith(".")
      ? path.resolve(path.dirname(context.filename), source)
      : undefined;
  return (
    modulePath?.replace(/\.(tsx|js)$/, "") === path.resolve(context.cwd, "src/shared/ui/Button")
  );
}

export default defineRule({
  files: ["src/**/*.tsx"],
  message:
    "Explain why this Button is disabled through disabledReason and show the reason beside the control so it stays visible.",
  create(context, report) {
    return {
      JSXOpeningElement(node) {
        const attributes = node.attributes.filter((attribute) => attribute.type === "JSXAttribute");
        const disabled = attributes.find((attribute) => attribute.name.name === "disabled");
        if (
          disabled?.value?.type === "JSXExpressionContainer" &&
          disabled.value.expression.type !== "Literal" &&
          !attributes.some((attribute) => explanations.has(attribute.name.name)) &&
          isSharedButton(node.name, context)
        ) {
          report(disabled);
        }
      },
    };
  },
});
