import { defineRule } from "../define-rule.mjs";

/** Props each shared container, overlay or control already offers for its appearance, quoted in the message. */
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
  Button: "`variant`, `size`, `tone`",
  Badge: "`variant`, `tone`, `size`",
  Checkbox: "its own props (the control owns box and label)",
  Switch: "its own props (the control owns track and thumb)",
  Select: "`size` and its own props (the control owns trigger and list)",
  SegmentedControl: "`size` and its own props (the control owns segments)",
  RadioGroup: "`tileLayout` and its own props (the group owns options)",
  Field: "its own props (the field owns label, control and message)",
  TextareaField: "`size` and its own props (the field owns frame and text)",
};

const MESSAGE =
  "Choose the shared variant/prop for appearance; the screen owns only layout, width and scroll. " +
  "Padding, radius, border, background, shadow, ring, backdrop, glass and text size/colour classes, style keys and " +
  "paint variables on a shared container, overlay or control fork its look. " +
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
  /^(glass|frosted?)(-\S+)?$/,
  /^font-(bold|semibold|medium|normal|light|thin|black|extrabold|\[\S+\])$/,
  /^\[--(modal|popover|sheet|surface|menu|overlay|glass|ui-floating)\S*\]$/,
];
const MEASURE_KEYS = new Set(["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight"]);
/** Style keys that paint or typeset; layout keys (margin, flex, grid, position, overflow) stay free. */
const APPEARANCE_KEYS =
  /^(background\S*|border\S*|boxShadow|outline\S*|color|fill|stroke|opacity|filter|backdropFilter|WebkitBackdropFilter|font\S*|letterSpacing|lineHeight|padding\S*)$/;
const PAINT_VARS = /^--(modal|popover|sheet|surface|menu|overlay|glass|ui-floating)/;

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

/** The initializer of the file-local `const` an identifier names, if there is one. */
function resolveConst(context, node) {
  let scope = context.sourceCode.getScope(node);
  while (scope && !scope.set.has(node.name)) scope = scope.upper;
  const def = scope?.set.get(node.name)?.defs[0];
  if (def?.type !== "Variable" || def.parent?.kind !== "const") return undefined;
  return def.node.init ?? undefined;
}

/** Class tokens written as literals inside a className expression, including `cn()` parts and local consts. */
function literalTokens(context, node, out = [], depth = 0) {
  if (!node || depth > 4) return out;
  const next = (child) => literalTokens(context, child, out, depth + 1);
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") out.push(...node.value.split(/\s+/).filter(Boolean));
      break;
    case "Identifier":
      next(resolveConst(context, node));
      break;
    case "TemplateLiteral":
      for (const quasi of node.quasis)
        out.push(...(quasi.value.cooked ?? "").split(/\s+/).filter(Boolean));
      for (const expression of node.expressions) next(expression);
      break;
    case "ConditionalExpression":
      next(node.consequent);
      next(node.alternate);
      break;
    case "LogicalExpression":
    case "BinaryExpression":
      next(node.left);
      next(node.right);
      break;
    case "ArrayExpression":
      for (const element of node.elements) next(element);
      break;
    case "ObjectExpression":
      for (const property of node.properties)
        if (property.type === "Property" && !property.computed) next(property.key);
      break;
    case "CallExpression":
      if (node.callee.type === "Identifier" && CLASS_BUILDERS.has(node.callee.name))
        for (const argument of node.arguments) next(argument);
      break;
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      next(node.expression);
      break;
    default:
  }
  return out;
}

const appearanceTokens = (context, node) => [
  ...new Set(literalTokens(context, node).filter(isAppearance)),
];

const keyName = (property) => property.key.name ?? property.key.value;

/** Keys of an object literal (or the local const holding one) that pass `test`; unresolved values yield none. */
function styleKeys(context, node, test) {
  const object = node?.type === "Identifier" ? resolveConst(context, node) : node;
  if (object?.type !== "ObjectExpression") return [];
  return object.properties
    .filter((property) => property.type === "Property" && !property.computed)
    .map(keyName)
    .filter((key) => typeof key === "string" && test(key));
}

const ticks = (items) =>
  items
    .slice(0, 5)
    .map((item) => `\`${item}\``)
    .join(" ");

const isClassSlot = (name) => name === "className" || /[a-z]ClassName$/.test(name);
const isStyleSlot = (name) => name === "style" || /[a-z]Style$/.test(name);

export default defineRule({
  files: ["src/features/**/*.tsx", "src/app/**/*.tsx"],
  message: MESSAGE,
  create: (context) => {
    /** local name -> shared component name, for names imported from src/shared/ui only. */
    const shared = new Map();
    /** Local names of `import * as UI from ".../shared/ui/..."`. */
    const namespaces = new Set();
    const flag = (node, component, detail) =>
      context.report({
        node,
        message: `${MESSAGE} <${component}> already offers ${PROPS[component]}; found ${detail}.`,
      });

    const componentOf = (name) => {
      if (name.type === "JSXIdentifier") return shared.get(name.name);
      if (
        name.type === "JSXMemberExpression" &&
        name.object.type === "JSXIdentifier" &&
        namespaces.has(name.object.name) &&
        Object.hasOwn(PROPS, name.property.name)
      )
        return name.property.name;
      return undefined;
    };

    /** Reports appearance in one className-like or style-like slot of a shared component. */
    const inspectSlot = (node, component, prop, value) => {
      if (isClassSlot(prop)) {
        const found = appearanceTokens(context, value);
        if (found.length) flag(node, component, ticks(found));
        return;
      }
      if (!isStyleSlot(prop)) return;
      // Sizes of a Modal panel belong to `size`; paint and typography keys belong to the component everywhere.
      const sizesFlagged = component === "Modal" && prop === "panelStyle";
      const keys = styleKeys(
        context,
        value,
        (key) => PAINT_VARS.test(key) || APPEARANCE_KEYS.test(key) || (sizesFlagged && MEASURE_KEYS.has(key)),
      );
      const opaque =
        sizesFlagged &&
        value?.type !== "ObjectExpression" &&
        !(value?.type === "Identifier" && resolveConst(context, value));
      if (keys.length) {
        const sizesOnly = keys.every((key) => MEASURE_KEYS.has(key));
        flag(
          node,
          component,
          sizesOnly ? `a \`${prop}\` size (use \`size\`)` : `\`${prop}\` keys ${ticks(keys)}`,
        );
      } else if (opaque) {
        flag(node, component, `a \`${prop}\` size (use \`size\`)`);
      }
    };

    return {
      ImportDeclaration(node) {
        if (
          typeof node.source.value !== "string" ||
          !/(^|\/)shared\/ui(\/|$)/.test(node.source.value)
        )
          return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            namespaces.add(specifier.local.name);
            continue;
          }
          if (specifier.type !== "ImportSpecifier") continue;
          const name = specifier.imported.name ?? specifier.imported.value;
          if (Object.hasOwn(PROPS, name)) shared.set(specifier.local.name, name);
        }
      },
      JSXOpeningElement(node) {
        const component = componentOf(node.name);
        if (!component) return;
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier")
            continue;
          const value =
            attribute.value?.type === "JSXExpressionContainer"
              ? attribute.value.expression
              : attribute.value;
          inspectSlot(attribute, component, attribute.name.name, value);
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || shared.get(node.callee.name) !== "useHoverCard")
          return;
        const options = node.arguments[0];
        if (options?.type !== "ObjectExpression") return;
        for (const property of options.properties) {
          if (property.type !== "Property" || property.computed) continue;
          const name = keyName(property);
          if (typeof name === "string") inspectSlot(property, "useHoverCard", name, property.value);
        }
      },
    };
  },
});
