import { defineRule } from "../define-rule.mjs";

const attributeNames = new Set(["startIcon", "endIcon", "iconOnly"]);
const nameProps = new Set(["label", "aria-label", "aria-labelledby", "children"]);

const hasContent = (child) =>
  !(child.type === "JSXText" && child.value.trim() === "") &&
  !(child.type === "JSXExpressionContainer" && child.expression.type === "JSXEmptyExpression");

export default defineRule({
  files: ["src/**/*.tsx"],
  message:
    "Icon-only Button has no accessible name. Pass `iconOnly` with a translated `label` (it names the button and fills the tooltip), or give the Button text children (src/shared/ui/Button.tsx).",
  create: (_context, report) => ({
    JSXElement(node) {
      const opening = node.openingElement;
      if (opening.name.type !== "JSXIdentifier" || opening.name.name !== "Button") return;
      if (node.children.some(hasContent)) return;
      let iconic = false;
      for (const attribute of opening.attributes) {
        // A spread may carry the name; the rule cannot see it, so stay silent.
        if (attribute.type === "JSXSpreadAttribute") return;
        if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier") continue;
        const { name } = attribute.name;
        if (nameProps.has(name)) return;
        if (attributeNames.has(name)) iconic = true;
      }
      if (iconic) report(opening);
    },
  }),
});
