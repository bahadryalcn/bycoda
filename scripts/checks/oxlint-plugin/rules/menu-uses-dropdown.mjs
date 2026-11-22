import { defineRule } from "../define-rule.mjs";

const MENU_ROLES = new Set(["menu", "menuitem", "menuitemcheckbox", "menuitemradio"]);

const elementName = (opening) =>
  opening.name.type === "JSXIdentifier" ? opening.name.name : undefined;

/**
 * Two hand-built menu shapes: a `MenuRow` list rendered inside a `Popover` (reported once, on
 * the Popover), and a literal `role="menu"` / `role="menuitem"` attribute.
 */
export default defineRule({
  files: ["src/app/**/*.tsx", "src/features/**/*.tsx"],
  message:
    "Menus are not built by hand: a Popover holding MenuRow items, or a literal role=menu/menuitem, has no menu role wiring and no arrow-key navigation. Use DropdownMenu from src/shared/ui (items/content) or ContextMenu, which own the role, focus and keyboard behavior.",
  create: (_context, report) => {
    const popovers = [];
    return {
      JSXElement(node) {
        if (elementName(node.openingElement) === "Popover") popovers.push({ node, reported: false });
      },
      "JSXElement:exit"(node) {
        if (popovers.at(-1)?.node === node) popovers.pop();
      },
      JSXOpeningElement(node) {
        if (elementName(node) === "MenuRow") {
          const popover = popovers.at(-1);
          if (popover && !popover.reported) {
            popover.reported = true;
            report(popover.node.openingElement);
          }
        }
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute" || attribute.name.name !== "role") continue;
          const value = attribute.value;
          if (value?.type === "Literal" && MENU_ROLES.has(value.value)) report(attribute);
        }
      },
    };
  },
});
