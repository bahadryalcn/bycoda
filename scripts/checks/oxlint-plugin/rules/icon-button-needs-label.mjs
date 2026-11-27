import path from "node:path";
import { defineRule } from "../define-rule.mjs";

const iconAttributes = new Set(["startIcon", "endIcon", "iconOnly"]);
const nameProps = new Set(["label", "aria-label", "aria-labelledby"]);

const hasContent = (child) =>
  !(child.type === "JSXText" && child.value.trim() === "") &&
  !(child.type === "JSXExpressionContainer" && child.expression.type === "JSXEmptyExpression");

/** Whether an import source names the shared Button module (`@/shared/ui/Button`, `../shared/ui`, `./Button` inside it). */
function isSharedButtonSource(source, context) {
  if (typeof source !== "string") return false;
  const sharedUi = path.resolve(context.cwd, "src/shared/ui");
  let target;
  if (source.startsWith("@/")) target = path.resolve(context.cwd, "src", source.slice(2));
  else if (source.startsWith(".")) target = path.resolve(path.dirname(context.filename), source);
  else return false;
  target = target.replace(/\.(tsx?|js)$/, "");
  return target === path.join(sharedUi, "Button") || target === sharedUi;
}

const attributeName = (attribute) =>
  attribute.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier"
    ? attribute.name.name
    : undefined;

export default defineRule({
  files: ["src/**/*.tsx"],
  message:
    "Icon-only Button has no accessible name. Pass a translated `label` or `aria-label` (it names the button for assistive technology and adds no visible text or tooltip by itself), or give the Button visible text children; an icon child alone does not name it (src/shared/ui/Button.tsx).",
  create(context, report) {
    /** Local names bound to the shared Button, and namespaces that expose it. */
    const buttons = new Set();
    const namespaces = new Set();
    /** Local names of icon components imported from lucide-react. */
    const icons = new Set();

    const isButton = (name) =>
      name.type === "JSXIdentifier"
        ? buttons.has(name.name)
        : name.type === "JSXMemberExpression" &&
          name.object.type === "JSXIdentifier" &&
          namespaces.has(name.object.name) &&
          name.property.name === "Button";

    /** A child that carries no name: whitespace, or an icon element hidden from assistive technology. */
    const isDecorative = (child) => {
      if (!hasContent(child)) return true;
      if (child.type !== "JSXElement") return false;
      const { name, attributes } = child.openingElement;
      if (attributes.some((attribute) => attributeName(attribute) === "aria-hidden")) return true;
      return name.type === "JSXIdentifier" && icons.has(name.name);
    };

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (source === "lucide-react") {
          for (const specifier of node.specifiers) icons.add(specifier.local.name);
          return;
        }
        if (!isSharedButtonSource(source, context)) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
          else if (
            specifier.type === "ImportSpecifier" &&
            (specifier.imported.name ?? specifier.imported.value) === "Button"
          )
            buttons.add(specifier.local.name);
        }
      },
      JSXElement(node) {
        const opening = node.openingElement;
        if (!isButton(opening.name)) return;
        if (!node.children.every(isDecorative)) return;
        let iconic = false;
        for (const attribute of opening.attributes) {
          // A spread may carry the name; the rule cannot see it, so stay silent.
          if (attribute.type === "JSXSpreadAttribute") return;
          const name = attributeName(attribute);
          if (!name) continue;
          if (nameProps.has(name) || name === "children") return;
          if (iconAttributes.has(name)) iconic = true;
        }
        // An icon-only child counts as the icon even without a prop (`<Button><Icon/></Button>`).
        if (iconic || node.children.some(hasContent)) report(opening);
      },
    };
  },
});
