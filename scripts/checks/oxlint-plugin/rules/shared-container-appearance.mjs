import { defineRule } from "../define-rule.mjs";

/** Props each shared container already offers for its appearance, quoted in the message. */
const PROPS = {
  Popover: "`variant` (panel, compact, preview), `size`, `solid`, `kind`",
  PickerPopover: "`width`, `maxHeight`",
  DropdownMenu: "its own props (the menu owns frame and rows)",
  ContextMenu: "its own props (the menu owns frame and rows)",
  Modal: '`size`, `surface`, `scroll="none"`, `padding="none"`',
  Sheet: '`size`, `surface`, `scroll="none"`, `padding="none"`',
  TabList: "`scrollbar` (the tabs own their look)",
  Surface: "`variant`, `frame`, `edge`, `radius`, `padding`, `elevation`, `tone`",
  EmptyState: "`size`, `kind`, `inset`",
  LoadingText: "`size`, `tone`, `inset`",
  InlineError: "`inset`, `retry`",
  InlineMessage: "`tone`, `inset`",
  useHoverCard: "the `width`, `size`, `maxHeight` and `solid` options",
};

const MESSAGE =
  "Choose the shared variant/prop for appearance; the screen owns only layout, width and scroll. " +
  "Padding, radius, border, background, shadow, ring, backdrop and text size/colour classes on a shared container fork its look. " +
  "If no variant fits, add one to the shared component instead of styling the call site, or keep the line with " +
  "`// oxlint-disable-next-line bycoda/shared-container-appearance -- <why no variant fits>`.";

const CLASS_BUILDERS = new Set(["cn", "clsx", "cx", "classNames", "twMerge"]);
const TEXT_LAYOUT =
  /^text-(left|center|right|start|end|justify|wrap|nowrap|balance|pretty|ellipsis|clip)$/;
const APPEARANCE = [
  /^-?(p|px|py|pt|pb|pl|pr|ps|pe)-\S+$/,
  /^rounded(-\S+)?$/,
  /^border(-\S+)?$/,
  /^bg-\S+$/,
  /^shadow(-\S+)?$/,
  /^ring(-\S+)?$/,
  /^backdrop-\S+$/,
];
const MEASURE_KEYS = new Set(["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight"]);

/** The utility after its variant prefixes (`hover:`, `data-[x]:`) and `!` importance mark. */
function baseUtility(token) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i += 1) {
    const char = token[i];
    if (char === "[" || char === "(") depth += 1;
    else if (char === "]" || char === ")") depth -= 1;
    else if (char === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start).replace(/^!/, "");
}

const isAppearance = (token) => {
  const base = baseUtility(token);
  if (TEXT_LAYOUT.test(base)) return false;
  return base.startsWith("text-") || APPEARANCE.some((pattern) => pattern.test(base));
};

/** Class tokens written as literals inside a className expression, including `cn()` parts. */
function literalTokens(node, out = []) {
  if (!node) return out;
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") out.push(...node.value.split(/\s+/).filter(Boolean));
      break;
    case "TemplateLiteral":
      for (const quasi of node.quasis)
        out.push(...(quasi.value.cooked ?? "").split(/\s+/).filter(Boolean));
      for (const expression of node.expressions) literalTokens(expression, out);
      break;
    case "ConditionalExpression":
      literalTokens(node.consequent, out);
      literalTokens(node.alternate, out);
      break;
    case "LogicalExpression":
    case "BinaryExpression":
      literalTokens(node.left, out);
      literalTokens(node.right, out);
      break;
    case "ArrayExpression":
      for (const element of node.elements) literalTokens(element, out);
      break;
    case "ObjectExpression":
      for (const property of node.properties)
        if (property.type === "Property" && !property.computed) literalTokens(property.key, out);
      break;
    case "CallExpression":
      if (node.callee.type === "Identifier" && CLASS_BUILDERS.has(node.callee.name))
        for (const argument of node.arguments) literalTokens(argument, out);
      break;
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      literalTokens(node.expression, out);
      break;
    default:
  }
  return out;
}

const appearanceTokens = (node) => [...new Set(literalTokens(node).filter(isAppearance))];

export default defineRule({
  files: ["src/features/**/*.tsx", "src/app/**/*.tsx"],
  message: MESSAGE,
  create: (context) => {
    /** local name -> shared component name, for names imported from src/shared/ui only. */
    const shared = new Map();
    const flag = (node, component, detail) =>
      context.report({
        node,
        message: `${MESSAGE} <${component}> already offers ${PROPS[component]}; found ${detail}.`,
      });

    return {
      ImportDeclaration(node) {
        if (
          typeof node.source.value !== "string" ||
          !/(^|\/)shared\/ui(\/|$)/.test(node.source.value)
        )
          return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const name = specifier.imported.name ?? specifier.imported.value;
          if (name in PROPS) shared.set(specifier.local.name, name);
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier") return;
        const component = shared.get(node.name.name);
        if (!component) return;
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier")
            continue;
          const value =
            attribute.value?.type === "JSXExpressionContainer"
              ? attribute.value.expression
              : attribute.value;
          if (attribute.name.name === "className") {
            const found = appearanceTokens(value);
            if (found.length)
              flag(
                attribute,
                component,
                found
                  .slice(0, 5)
                  .map((t) => `\`${t}\``)
                  .join(" "),
              );
          } else if (attribute.name.name === "panelStyle" && component === "Modal") {
            const measured =
              value?.type === "ObjectExpression"
                ? value.properties.some(
                    (property) =>
                      property.type !== "Property" ||
                      property.computed ||
                      MEASURE_KEYS.has(property.key.name ?? property.key.value),
                  )
                : true;
            if (measured) flag(attribute, component, "a `panelStyle` size (use `size`)");
          }
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || shared.get(node.callee.name) !== "useHoverCard")
          return;
        const options = node.arguments[0];
        if (options?.type !== "ObjectExpression") return;
        for (const property of options.properties) {
          if (
            property.type !== "Property" ||
            property.computed ||
            (property.key.name ?? property.key.value) !== "className"
          )
            continue;
          const found = appearanceTokens(property.value);
          if (found.length)
            flag(
              property,
              "useHoverCard",
              found
                .slice(0, 5)
                .map((t) => `\`${t}\``)
                .join(" "),
            );
        }
      },
    };
  },
});
