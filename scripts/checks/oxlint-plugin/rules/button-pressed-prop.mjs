import { defineRule } from "../define-rule.mjs";

const hasAttribute = (element, name) =>
  element.attributes.some(
    (attribute) => attribute.type === "JSXAttribute" && attribute.name.name === name,
  );

export default defineRule({
  files: ["src/**/*.tsx"],
  message:
    "Button with both `selected` and `aria-pressed` sets the ARIA state by hand next to the visual state, and the two can drift apart. Use `pressed` on Button instead: it sets `aria-pressed` and the selected look together (src/shared/ui/Button.tsx).",
  create: (_context, report) => ({
    JSXOpeningElement(node) {
      if (node.name.type !== "JSXIdentifier" || node.name.name !== "Button") return;
      if (hasAttribute(node, "selected") && hasAttribute(node, "aria-pressed")) report(node);
    },
  }),
});
