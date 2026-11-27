import { defineRule, TESTS } from "../define-rule.mjs";

const hasTone = (properties, isTone) => properties.some((property) => isTone(property));

/** `toast.show(...)` or `<anything>.toast.show(...)`. */
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
  ignores: [...TESTS, "**/*.spec.ts", "**/*.spec.tsx", "src/shared/ui/Toast*"],
  message:
    'Toast has no tone, so it falls back to "info" and a failure shows as a neutral notice. Pass tone="danger", "warning", "success" or "info" explicitly (src/shared/ui/ToastRegion.tsx).',
  create: (_context, report) => ({
    CallExpression(node) {
      if (!isToastShow(node)) return;
      const options = node.arguments[0];
      if (options?.type !== "ObjectExpression") return;
      // A spread may carry the tone; the rule cannot see it, so stay silent.
      if (options.properties.some((property) => property.type === "SpreadElement")) return;
      const named = hasTone(
        options.properties,
        (property) => !property.computed && property.key?.name === "tone",
      );
      if (!named) report(options);
    },
    JSXOpeningElement(node) {
      if (node.name.type !== "JSXIdentifier" || node.name.name !== "Toast") return;
      for (const attribute of node.attributes) {
        if (attribute.type === "JSXSpreadAttribute") return;
        if (attribute.type === "JSXAttribute" && attribute.name.name === "tone") return;
      }
      report(node);
    },
  }),
});
