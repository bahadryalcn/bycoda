import { defineRule } from "../define-rule.mjs";

const attributeOf = (element, name) =>
  element.attributes.find(
    (attribute) => attribute.type === "JSXAttribute" && attribute.name?.name === name,
  );

// `reveal="interaction"` as a plain string or as `{"interaction"}`.
const isInteractionReveal = (attribute) => {
  const value = attribute?.value;
  const literal = value?.type === "JSXExpressionContainer" ? value.expression : value;
  return literal?.type === "Literal" && literal.value === "interaction";
};

export default defineRule({
  files: ["src/features/sessions/ui/**/*.tsx"],
  message:
    'Transcript rows open and close through `Disclosure variant="step"` (src/shared/ui/Disclosure.tsx), which owns the trigger, `aria-expanded`, the keyboard path and the hit area. A `Button expanded=`, a raw `aria-expanded` element, `InlineAction reveal="interaction"` or an `onClick` on a `div` makes a second trigger that drifts from the step row. Use `<Disclosure variant="step" ...>` instead.',
  create: (_context, report) => ({
    JSXOpeningElement(node) {
      if (node.name.type !== "JSXIdentifier") return;
      const { name } = node.name;
      if (name === "Button" && attributeOf(node, "expanded")) report(node);
      if (/^[a-z]/.test(name) && attributeOf(node, "aria-expanded")) report(node);
      if (name === "InlineAction" && isInteractionReveal(attributeOf(node, "reveal")))
        report(node);
      if (name === "div" && attributeOf(node, "onClick")) report(node);
    },
  }),
});
