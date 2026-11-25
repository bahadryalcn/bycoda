import path from "node:path";
import ts from "@typescript/typescript6";
import { scanSharedFocusClasses, sizedControls } from "./ui-drift-appearance.mjs";

const literal = (node) => {
  if (node && ts.isJsxExpression(node)) node = node.expression;
  return node && ts.isStringLiteralLike(node) ? node.text : null;
};
const attribute = (opening, name) =>
  opening.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.text === name);
const openingOf = (node) =>
  !node
    ? null
    : ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
const hasSpread = (opening) => opening.attributes.properties.some(ts.isJsxSpreadAttribute);

function expressionOf(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)))
    node = node.expression;
  return node;
}

function importBindings(file, tree) {
  const bindings = new Map();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const specifier = statement.moduleSpecifier.text;
    const source = specifier.startsWith(".")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
      : specifier.replace(/^@\//, "src/");
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name)
      bindings.set(clause.name.text, {
        source,
        name: path.posix.basename(source, path.extname(source)),
      });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings))
      for (const item of clause.namedBindings.elements)
        if (!item.isTypeOnly)
          bindings.set(item.name.text, { source, name: (item.propertyName ?? item.name).text });
  }
  return bindings;
}

const inSharedUi = (entry) => entry && /^src\/shared\/ui(?:\/|$)/.test(entry.source);
const sharedName = (imports, name) => {
  const entry = imports.get(name);
  return inSharedUi(entry) ? entry.name : null;
};

const classSlot = /^(?:className|[a-z]\w*ClassName)$/;
const additionalControls = new Set([
  "Badge",
  "ButtonGroup",
  "Chip",
  "Divider",
  "DropdownMenu",
  "EmptyState",
  "Field",
  "FieldGroup",
  "Group",
  "Heading",
  "InfoPopover",
  "Link",
  "ListRow",
  "Modal",
  "ModalActions",
  "NativeSelect",
  "PaneHeader",
  "PickerList",
  "PickerPopover",
  "Popover",
  "RadioGroup",
  "Row",
  "SearchInputGroup",
  "SectionLabel",
  "Sheet",
  "Stepper",
  "Surface",
  "Tabs",
  "Text",
  "Tooltip",
  "TreeRow",
]);

function localModuleMembers(node, imports, resolve, add, stylesheets, seen = new Set()) {
  node = expressionOf(node);
  if (!node) return;
  if (ts.isStringLiteralLike(node)) {
    for (const member of node.text.split(/\s+/).filter((part) => /^-?[A-Za-z_][\w-]*$/.test(part)))
      for (const stylesheet of stylesheets) add(stylesheet, member);
  } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const member = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : literal(node.argumentExpression);
    const receiver = node.expression;
    const entry = ts.isIdentifier(receiver) && !resolve(receiver) && imports.get(receiver.text);
    if (member && entry && /^src\/(?:app|features)\/.*\.module\.css$/.test(entry.source))
      add(entry.source, member);
  } else if (ts.isIdentifier(node)) {
    const declaration = resolve(node);
    if (
      !declaration ||
      !ts.isVariableDeclaration(declaration) ||
      !(declaration.parent.flags & ts.NodeFlags.Const) ||
      seen.has(declaration)
    )
      return;
    seen.add(declaration);
    localModuleMembers(declaration.initializer, imports, resolve, add, stylesheets, seen);
  } else if (
    ts.isCallExpression(node) &&
    /^(?:cn|clsx|twMerge|twJoin)$/.test(node.expression.getText())
  ) {
    for (const argument of node.arguments)
      localModuleMembers(argument, imports, resolve, add, stylesheets, seen);
  } else if (ts.isConditionalExpression(node)) {
    localModuleMembers(node.whenTrue, imports, resolve, add, stylesheets, seen);
    localModuleMembers(node.whenFalse, imports, resolve, add, stylesheets, seen);
  } else if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    localModuleMembers(node.right, imports, resolve, add, stylesheets, seen);
  }
}

/** Index selectors from locally imported stylesheets that are assigned to shared UI slots. */
export function sharedModuleSlots(file, source, catalogNames, add) {
  if (!file.endsWith(".tsx") || !/\.css['"]/.test(source)) return;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = importBindings(file, tree);
  const stylesheets = tree.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      return [];
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".") || !/(?<!\.module)\.css$/.test(specifier)) return [];
    return [path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))];
  });
  const resolve = lexicalBindings(tree);
  const visit = (node) => {
    const opening = openingOf(node);
    if (opening && ts.isIdentifier(opening.tagName) && !resolve(opening.tagName)) {
      const name = sharedName(imports, opening.tagName.text);
      if (catalogNames.has(name) || additionalControls.has(name) || sizedControls.has(name))
        for (const prop of opening.attributes.properties)
          if (ts.isJsxAttribute(prop) && classSlot.test(prop.name.getText()))
            localModuleMembers(
              prop.initializer,
              imports,
              resolve,
              (stylesheet, member) => add(stylesheet, member, name),
              stylesheets,
            );
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}

/** Resolve each local identifier to its binding without checking other files. */
function lexicalBindings(tree) {
  const scopes = new Map();
  function register(scope, name, declaration) {
    if (!scopes.has(scope)) scopes.set(scope, new Map());
    const bindings = scopes.get(scope);
    if (ts.isIdentifier(name))
      bindings.set(name.text, bindings.has(name.text) ? null : declaration);
    else
      for (const item of name.elements)
        if (ts.isBindingElement(item)) register(scope, item.name, item);
  }
  function visit(node, scope) {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name)
      register(scope, node.name, node);
    if (
      ts.isFunctionLike(node) ||
      ts.isBlock(node) ||
      ts.isCatchClause(node) ||
      ts.isForStatement(node) ||
      ts.isForOfStatement(node) ||
      ts.isForInStatement(node) ||
      ts.isCaseBlock(node)
    )
      scope = node;
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) register(scope, node.name, node);
    ts.forEachChild(node, (child) => visit(child, scope));
  }
  visit(tree, tree);
  return (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      const bindings = scopes.get(parent);
      if (bindings?.has(node.text)) return bindings.get(node.text);
    }
    return null;
  };
}

function isCard(opening) {
  if (
    opening.tagName.getText() === "Surface" &&
    literal(attribute(opening, "variant")?.initializer) === "card"
  )
    return true;
  return opening.attributes.properties.some((item) => {
    const call = ts.isJsxSpreadAttribute(item) && item.expression;
    if (!call || !ts.isCallExpression(call) || call.expression.getText() !== "surfaceAttributes")
      return false;
    const options = call.arguments[0];
    return (
      options &&
      ts.isObjectLiteralExpression(options) &&
      options.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          (property.name.getText() === "variant" || literal(property.name) === "variant") &&
          literal(property.initializer) === "card",
      )
    );
  });
}

const isSettingsGroup = (opening, source) =>
  opening.tagName.getText() === "Group" && /from\s+["'][^"']*shared\/ui\/settings["']/.test(source);

/** Compile-time text of a JSX child or attribute value: literal, plain template or `t("...")`. */
function staticText(node) {
  node = expressionOf(node);
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isCallExpression(node) &&
    node.expression.getText() === "t" &&
    node.arguments.length === 1 &&
    ts.isStringLiteralLike(node.arguments[0])
  )
    return node.arguments[0].text;
  return null;
}

const normalizedText = (text) =>
  text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.\u2026:]+$/u, "")
    .trim();

function boundValue(node, resolve) {
  node = expressionOf(node);
  if (!node) return null;
  if (ts.isIdentifier(node)) return resolve(node);
  if (ts.isPropertyAccessExpression(node) && !node.questionDotToken) {
    const receiver = boundValue(node.expression, resolve);
    if (receiver !== null) return `binding:${receiver.pos ?? receiver}:${node.name.text}`;
  }
  return null;
}

function textIdentity(node, resolve, normalize = normalizedText) {
  const text = node && ts.isJsxText(node) ? node.text : staticText(node);
  if (text !== null) {
    const label = normalize(text);
    return label ? `text:${label}` : null;
  }
  return boundValue(node, resolve);
}

function uncertainVisibility(opening, resolve) {
  if (
    hasSpread(opening) ||
    ["hidden", "truncate", "lineClamp", "iconOnly", "revealLabel"].some((name) => {
      const prop = attribute(opening, name);
      return prop && expressionOf(prop.initializer)?.kind !== ts.SyntaxKind.FalseKeyword;
    })
  )
    return true;
  const className = expressionOf(attribute(opening, "className")?.initializer);
  if (!className) return false;
  const classes = ts.isIdentifier(className)
    ? literal(resolve(className)?.initializer)
    : literal(className);
  return (
    classes === null ||
    /(?:^|[\s:])(?:hidden|invisible|sr-only|opacity-0|truncate|text-ellipsis|line-clamp-\S+)(?=\s|$)/.test(
      classes,
    )
  );
}

function visibleLabel(node, imports, resolve) {
  const opening = openingOf(node);
  if (opening && uncertainVisibility(opening, resolve)) return null;
  if (opening) {
    const tag = opening.tagName.getText();
    const shared = sharedName(imports, tag);
    if (["Checkbox", "Switch"].includes(shared))
      return textIdentity(attribute(opening, "label")?.initializer, resolve);
    if (ts.isJsxSelfClosingElement(node))
      return ["Button", "Link", "Text", "InlineTextAction"].includes(shared)
        ? textIdentity(attribute(opening, "children")?.initializer, resolve)
        : null;
  }
  const texts = [];
  for (const child of node.children) {
    if (
      (ts.isJsxText(child) && !child.text.trim()) ||
      (ts.isJsxExpression(child) && !child.expression)
    )
      continue;
    const childOpening = openingOf(child);
    if (childOpening) {
      const name = childOpening.tagName.getText();
      const shared = sharedName(imports, name);
      if (
        name === "svg" ||
        literal(attribute(childOpening, "aria-hidden")?.initializer) === "true" ||
        expressionOf(attribute(childOpening, "aria-hidden")?.initializer)?.kind ===
          ts.SyntaxKind.TrueKeyword ||
        imports.get(name)?.source.endsWith("/shared/ui/icons")
      )
        continue;
      if (
        ![
          "span",
          "strong",
          "em",
          "b",
          "i",
          "Text",
          "Button",
          "Link",
          "Checkbox",
          "Switch",
          "InlineTextAction",
        ].includes(shared ?? (!imports.has(name) && name))
      )
        return null;
      texts.push(visibleLabel(child, imports, resolve));
    } else if (ts.isJsxFragment(child)) texts.push(visibleLabel(child, imports, resolve));
    else texts.push(textIdentity(child, resolve));
  }
  if (texts.length === 1) return texts[0];
  return texts.length && texts.every((text) => typeof text === "string" && text.startsWith("text:"))
    ? `text:${normalizedText(texts.map((text) => text.slice(5)).join(" "))}`
    : null;
}

function sameLabel(left, right, resolve) {
  left = expressionOf(left);
  right = expressionOf(right);
  if (left && right && ts.isConditionalExpression(left) && ts.isConditionalExpression(right)) {
    const condition = boundValue(left.condition, resolve);
    return (
      condition !== null &&
      condition === boundValue(right.condition, resolve) &&
      sameLabel(left.whenTrue, right.whenTrue, resolve) &&
      sameLabel(left.whenFalse, right.whenFalse, resolve)
    );
  }
  const label = textIdentity(left, resolve);
  return label !== null && label === textIdentity(right, resolve);
}

function onlyTextChild(node) {
  if (!ts.isJsxElement(node)) return null;
  const children = node.children.filter((child) =>
    ts.isJsxText(child) ? child.text.trim() : !ts.isJsxExpression(child) || child.expression,
  );
  return children.length === 1 ? children[0] : null;
}

function accessibleLabel(node, opening, wrapped) {
  if (!wrapped) return attribute(opening, "aria-label")?.initializer;
  const child = onlyTextChild(node);
  const childOpening = child && openingOf(child);
  return childOpening && attribute(childOpening, "aria-label")?.initializer;
}

function tooltipRepeatsLabel(node, opening, imports, resolve) {
  const tag = opening.tagName.getText();
  const isTooltip = (sharedName(imports, tag) ?? (!imports.has(tag) && tag)) === "Tooltip";
  const [hint, when, extra] = isTooltip
    ? ["label", "when", ["details", "shortcut"]]
    : ["tooltip", "tooltipWhen", ["tooltipDetails", "shortcut", "disabledReason", "title"]];
  const hintProp = attribute(opening, hint);
  if (!hintProp || hasSpread(opening)) return null;
  if (literal(attribute(opening, when)?.initializer) === "overflow") return null;
  if (extra.some((name) => attribute(opening, name))) return null;
  const wanted = textIdentity(hintProp.initializer, resolve);
  const accessible = accessibleLabel(node, opening, isTooltip);
  const visibleChild = !uncertainVisibility(opening, resolve) && onlyTextChild(node);
  const repeatsVisible = wanted !== null && wanted === visibleLabel(node, imports, resolve);
  const target = isTooltip ? onlyTextChild(node) : node;
  const targetOpening = target && openingOf(target);
  const repeatsAria =
    accessible &&
    targetOpening &&
    !["iconOnly", "truncate", "lineClamp", "revealLabel"].some((prop) =>
      attribute(targetOpening, prop),
    ) &&
    sameLabel(hintProp.initializer, accessible, resolve);
  const conditionalLabel = visibleChild && sameLabel(hintProp.initializer, visibleChild, resolve);
  return repeatsVisible || repeatsAria || conditionalLabel ? hintProp : null;
}

function hoverOnly(className) {
  const strings = [];
  const collect = (node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      strings.push(node.text);
    ts.forEachChild(node, collect);
  };
  collect(className);
  const tokens = strings
    .join(" ")
    .split(/\s+/)
    .map((text) => text.split(":"));
  const hidden = (utility) => tokens.some((parts) => parts.length === 1 && parts[0] === utility);
  const reveal = (utility, focus) =>
    tokens.some((parts) => {
      const value = parts.at(-1);
      const states = parts.slice(0, -1);
      const hover = states.some((state) => /^(?:group-hover(?:\/[^:]+)?|hover)$/.test(state));
      const keyboard = states.some((state) =>
        /^(?:focus-within|focus-visible|group-focus-within(?:\/[^:]+)?)$/.test(state),
      );
      return utility.test(value) && (focus ? keyboard && !hover : hover);
    });
  return [
    ["opacity-0", /^opacity-(?:[1-9]\d?|100)$/],
    ["invisible", /^visible$/],
  ].some(([hide, show]) => hidden(hide) && reveal(show, false) && !reveal(show, true));
}

/** Only known settings slots with the same label and description. */
function inlineHelpGuard(node, opening, name, imports, resolve, add) {
  if (!["Group", "Row", "Field"].includes(name) || hasSpread(opening)) return;
  const label = textIdentity(
    attribute(opening, name === "Group" ? "title" : "label")?.initializer,
    resolve,
  );
  if (!label) return;
  const description = attribute(opening, "description");
  if (description && textIdentity(description.initializer, resolve) === label)
    add("inline-help-text", description.getStart());
  if (!ts.isJsxElement(node)) return;
  for (const child of node.children) {
    if (!ts.isJsxElement(child)) continue;
    const help = child.openingElement;
    if (
      sharedName(imports, help.tagName.getText()) === "Text" &&
      ["muted", "secondary"].includes(literal(attribute(help, "tone")?.initializer)) &&
      visibleLabel(child, imports, resolve) === label
    )
      add("inline-help-text", help.getStart());
  }
}

const fieldNames = new Set([
  "Field",
  "TextField",
  "TextareaField",
  "NumberField",
  "PasswordField",
  "NativeSelect",
  "Select",
  "Checkbox",
  "RadioGroup",
  "Switch",
  "Input",
]);
const controlNames = new Set(["Button", "Row", "Checkbox", "InlineAction"]);
const rowNames = new Set(["ListRow", "Row", "TreeRow", "PickerRow"]);
const helpContainers = new Set(["Field", "FieldGroup", "form"]);
const reasonNames = new Set(["InlineMessage", "InlineError", "SettingsFeedback", "Alert", "Text"]);
const hintClass = /(?:^|[\s"'\x60.[])[\w-]+(?:-hint|Hint)(?![\w-])/;
const loadingGate =
  /^(?:(?:is)(?:Loading|Pending|Busy|Saving|Checking|Submitting)|loading|pending|busy|saving|checking|submitting)(?:[A-Z]\w*)?$/;
const emptyFieldGate = /^!(?:[\w.]+\.(?:trim\(\)(?:\.length)?|length))$/;

function obviousGate(node) {
  if (!node) return false;
  if (ts.isParenthesizedExpression(node)) return obviousGate(node.expression);
  if (
    ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(
      node.operatorToken.kind,
    )
  )
    return obviousGate(node.left) && obviousGate(node.right);
  const text = node.getText();
  const value = text.replace(/^!+/, "").split(".").at(-1);
  return (
    (!text.startsWith("!") && loadingGate.test(value)) ||
    (text.startsWith("!!") && loadingGate.test(value)) ||
    emptyFieldGate.test(text)
  );
}

function semanticName(opening, imports, resolve) {
  const tag = opening?.tagName;
  if (!tag || !ts.isIdentifier(tag) || resolve(tag)) return null;
  return sharedName(imports, tag.text) ?? (/^[a-z]/.test(tag.text) ? tag.text : null);
}

function neighbors(node) {
  if (!ts.isJsxElement(node.parent) && !ts.isJsxFragment(node.parent)) return [];
  const siblings = node.parent.children.filter((child) =>
    ts.isJsxText(child) ? child.text.trim() : !ts.isJsxExpression(child) || child.expression,
  );
  const index = siblings.indexOf(node);
  return [siblings[index - 1], siblings[index + 1]].filter(Boolean);
}

function gateReason(node, opening, imports, resolve) {
  if (attribute(opening, "aria-describedby")) return true;
  for (const sibling of neighbors(node)) {
    const candidate =
      ts.isJsxExpression(sibling) &&
      sibling.expression &&
      ts.isBinaryExpression(sibling.expression) &&
      sibling.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        ? expressionOf(sibling.expression.right)
        : sibling;
    const adjacent = openingOf(candidate);
    if (!adjacent || !reasonNames.has(semanticName(adjacent, imports, resolve))) continue;
    const disabled = expressionOf(attribute(opening, "disabled")?.initializer);
    const linked =
      candidate !== sibling &&
      boundValue(sibling.expression.left, resolve) !== null &&
      boundValue(sibling.expression.left, resolve) === boundValue(disabled, resolve);
    const shown =
      ["InlineError", "SettingsFeedback"].includes(semanticName(adjacent, imports, resolve)) &&
      candidate === sibling &&
      !attribute(adjacent, "hidden");
    if (
      linked ||
      shown ||
      /(?:reason|disabled)/i.test(attribute(adjacent, "id")?.initializer?.getText() ?? "")
    )
      return true;
  }
  for (let parent = node.parent; parent && !ts.isFunctionLike(parent); parent = parent.parent) {
    if (!ts.isJsxElement(parent)) continue;
    const group = parent.openingElement;
    const name = semanticName(group, imports, resolve);
    if (name === "ModalActions" && attribute(group, "reason")) return true;
    if (
      ["Row", "FieldGroup", "Group"].includes(name) &&
      (attribute(group, "disabledReason") || attribute(group, "aria-describedby"))
    )
      return true;
  }
  return false;
}

function gateProperty(opening, name, resolve) {
  const direct = attribute(opening, name);
  if (direct) return direct.initializer;
  for (const prop of opening.attributes.properties) {
    if (!ts.isJsxSpreadAttribute(prop)) continue;
    const value = expressionOf(prop.expression);
    const object = ts.isIdentifier(value) ? resolve(value)?.initializer : value;
    const property = objectValue(object, name);
    if (property) return property;
  }
  return null;
}

const isSocialGate = (entry, name) =>
  entry?.name === name && entry.source.endsWith("/social/ui/common/DisabledReason");

function gateReasons(node, imports, resolve, adapter) {
  const opening = openingOf(node);
  const reasons = [gateProperty(opening, adapter ? "reason" : "disabledReason", resolve)];
  for (const prop of opening.attributes.properties) {
    if (!ts.isJsxSpreadAttribute(prop)) continue;
    const call = expressionOf(prop.expression);
    if (
      !call ||
      !ts.isCallExpression(call) ||
      !ts.isIdentifier(call.expression) ||
      resolve(call.expression)
    )
      continue;
    const adapter = imports.get(call.expression.text);
    if (
      adapter?.name !== "gateProps" ||
      !adapter.source.endsWith("/social/ui/common/DisabledReason")
    )
      continue;
    const collect = (value) => {
      value = expressionOf(value);
      if (value && ts.isConditionalExpression(value)) {
        collect(value.whenTrue);
        collect(value.whenFalse);
      } else {
        const reason = objectValue(value, "disabledReason");
        if (reason) reasons.push(reason);
      }
    };
    collect(call.arguments[0]);
  }
  return reasons.filter(Boolean);
}

function labelBranches(node, resolve, conditions = new Map()) {
  node = expressionOf(node);
  if (node && ts.isConditionalExpression(node)) {
    const binding = boundValue(node.condition, resolve);
    return [node.whenTrue, node.whenFalse].flatMap((branch, index) => {
      if (binding === null) return labelBranches(branch, resolve, conditions);
      const positive = index === 0;
      if (conditions.has(binding) && conditions.get(binding) !== positive) return [];
      return labelBranches(branch, resolve, new Map([...conditions, [binding, positive]]));
    });
  }
  const label = textIdentity(node, resolve);
  return label === null ? [] : [{ label, conditions }];
}

function matchedGateLabel(reason, label, resolve) {
  if (sameLabel(reason, label, resolve)) return true;
  const branches = labelBranches(label, resolve);
  return labelBranches(reason, resolve).some((hint) =>
    branches.some((child) => {
      if (hint.label !== child.label) return false;
      const common = [...hint.conditions].filter(([binding]) => child.conditions.has(binding));
      return (
        common.length > 0 &&
        common.every(([binding, positive]) => child.conditions.get(binding) === positive)
      );
    }),
  );
}

function hasReason(value) {
  const node = expressionOf(value);
  return Boolean(
    node &&
    literal(node) !== "" &&
    node.kind !== ts.SyntaxKind.NullKeyword &&
    node.kind !== ts.SyntaxKind.FalseKeyword &&
    node.getText() !== "undefined",
  );
}

function rowHasBadge(node, name, imports, resolve) {
  const opening = openingOf(node);
  if (name === "Badge" && ["count", "icon"].some((prop) => attribute(opening, prop))) return false;
  const body = onlyTextChild(node) ?? attribute(opening, "children")?.initializer;
  const label = body && (ts.isJsxText(body) ? body.text.trim() : staticText(body));
  if (name === "Badge" && (!label || /^\d+[+%]?$/.test(label))) return false;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) {
      const owner = semanticName(parent.parent.parent, imports, resolve);
      if (
        rowNames.has(owner) &&
        /^(?:action|aside|end|meta|trailing|right|description)$/.test(parent.name.getText())
      )
        return true;
      if (!rowNames.has(owner)) return false;
    }
    if (ts.isJsxElement(parent)) {
      const tag = semanticName(parent.openingElement, imports, resolve);
      if (rowNames.has(tag) || tag === "tr" || tag === "li") return true;
      if (
        ["Button", "ActionHost"].includes(tag) &&
        (attribute(parent.openingElement, "role") ||
          attribute(parent.openingElement, "className")
            ?.initializer?.getText()
            .match(/(?:row|item)/i))
      )
        return true;
      if (["form", "Field", "Modal", "Popover", "TagEditor"].includes(tag)) return false;
    }
  }
  return false;
}

function scanClassTokens(node, handle) {
  if (!node) return;
  if (
    ts.isStringLiteralLike(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    for (const token of node.text.split(/\s+/)) handle(token);
  }
  ts.forEachChild(node, (child) => scanClassTokens(child, handle));
}

function auditView(node, opening, name, imports, resolve, add, file) {
  const disabled = attribute(opening, "disabled");
  const disabledValue = expressionOf(disabled?.initializer);
  if (
    controlNames.has(name) &&
    disabled &&
    disabledValue?.kind !== ts.SyntaxKind.FalseKeyword &&
    !obviousGate(disabledValue) &&
    !hasReason(gateProperty(opening, "disabledReason", resolve)) &&
    !gateReason(node, opening, imports, resolve)
  )
    add("disabled-without-reason", disabled.getStart());
  const adapter =
    ts.isIdentifier(opening.tagName) &&
    !resolve(opening.tagName) &&
    isSocialGate(imports.get(opening.tagName.text), "DisabledReason");
  if (controlNames.has(name) || adapter) {
    const label = onlyTextChild(node);
    if (
      label &&
      gateReasons(node, imports, resolve, adapter).some((reason) =>
        matchedGateLabel(reason, label, resolve),
      )
    )
      add("duplicate-feedback-channel", opening.getStart());
  }
  if (["Badge", "BadgeList"].includes(name) && rowHasBadge(node, name, imports, resolve))
    add("row-text-badge", opening.getStart());

  if (
    name === "div" &&
    attribute(opening, "aria-label") &&
    !attribute(opening, "role") &&
    !hasSpread(opening)
  )
    add("aria-label-without-role", opening.getStart());

  const className = attribute(opening, "className");
  if (className && /^src\/(?:app|features)\//.test(file)) {
    const findings = new Set();
    scanClassTokens(className.initializer, (token) => {
      if (/(?:^|:)!?\[--ui-[\w-]+:[^\]]+\]!?$/.test(token))
        findings.add("arbitrary-ui-token-override");
      if (
        file.startsWith("src/features/") &&
        /(?:^|:)!?-?(?:(?:ml|mr|pl|pr)-\S+|text-(?:left|right))!?$/.test(token)
      )
        findings.add("physical-direction-utility");
    });
    for (const rule of findings) add(rule, className.getStart());
  }

  if (
    !ts.isJsxElement(node) ||
    !["Text", "p"].includes(name) ||
    ["danger", "warning", "success", "error"].includes(
      literal(attribute(opening, "tone")?.initializer),
    ) ||
    attribute(opening, "role") ||
    attribute(opening, "aria-live")
  )
    return;
  const child = onlyTextChild(node);
  const copy = child && (ts.isJsxText(child) ? child.text.trim() : staticText(child));
  if (!copy) return;

  // A hint can be the final branch of a status expression immediately preceding a form.
  let location = node;
  while (
    ts.isConditionalExpression(location.parent) ||
    ts.isJsxExpression(location.parent) ||
    ts.isParenthesizedExpression(location.parent)
  )
    location = location.parent;
  const parent = ts.isJsxElement(location.parent) && location.parent.openingElement;
  const adjacent = neighbors(location).map(openingOf).filter(Boolean);
  const nextToField = adjacent.some(
    (item) =>
      fieldNames.has(semanticName(item, imports, resolve)) ||
      semanticName(item, imports, resolve) === "form",
  );
  const related = [parent, ...adjacent].filter(Boolean);
  if (
    related.some(
      (item) => semanticName(item, imports, resolve) === "InfoPopover" || attribute(item, "info"),
    )
  )
    return;
  const caption =
    name === "Text" &&
    (literal((attribute(opening, "size") ?? attribute(opening, "variant"))?.initializer) ===
      "caption" ||
      ["muted", "secondary"].includes(literal(attribute(opening, "tone")?.initializer)));
  const fieldHelp =
    nextToField || (parent && helpContainers.has(semanticName(parent, imports, resolve)));
  const optionalInstruction =
    /^(?:add|choose|copy|enter|find|look|open|paste|pick|select|use|you can)\b/i.test(copy);
  const repeatsField =
    parent &&
    copy &&
    textIdentity(child, resolve) === textIdentity(attribute(parent, "label")?.initializer, resolve);
  if (
    hintClass.test(className?.initializer?.getText() ?? "") ||
    (caption && fieldHelp && (optionalInstruction || repeatsField))
  )
    add("inline-help-text", opening.getStart());
}

const feedbackChannels = new Map([
  ["Alert", "banner"],
  ["FailureState", "banner"],
  ["InlineMessage", "inline"],
  ["InlineError", "inline"],
  ["Toast", "toast"],
]);

function renderContext(node) {
  let child = node;
  for (let parent = child.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isJsxElement(parent)) {
      if (parent.openingElement === child || uncertainRenderParent(parent.openingElement))
        return child;
      continue;
    }
    if (
      ts.isJsxFragment(parent) ||
      ts.isParenthesizedExpression(parent) ||
      ts.isJsxExpression(parent)
    )
      continue;
    if (ts.isConditionalExpression(parent) || ts.isBinaryExpression(parent)) return child;
    return parent;
  }
  return child;
}

// A component can choose to hide or rearrange its children. Compare ordinary wrappers only.
function uncertainRenderParent(opening) {
  return (
    !/^[a-z]/.test(opening.tagName.getText()) ||
    hasSpread(opening) ||
    Boolean(attribute(opening, "hidden"))
  );
}

function footerReason(node, opening, imports, resolve) {
  const reason = attribute(opening, "disabledReason");
  if (!reason || hasSpread(opening)) return null;
  const exact = (prop) => textIdentity(prop?.initializer, resolve, (text) => text);
  const value = exact(reason);
  if (!value) return null;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxFragment(parent)) continue;
    if (!ts.isJsxElement(parent)) return null;
    const footer = parent.openingElement;
    if (sharedName(imports, footer.tagName.getText()) === "ModalActions")
      return !hasSpread(footer) && value === exact(attribute(footer, "reason")) ? reason : null;
    if (uncertainRenderParent(footer)) return null;
  }
  return null;
}

function feedbackMessage(node, opening, name) {
  const message =
    name === "FailureState"
      ? (attribute(opening, "descriptionText") ?? attribute(opening, "description"))
      : attribute(opening, "message");
  if (message) return [message.initializer, message];
  if (ts.isJsxElement(node)) {
    const children = node.children.filter(
      (child) =>
        (ts.isJsxExpression(child) && child.expression) ||
        (!ts.isJsxExpression(child) && (!ts.isJsxText(child) || child.text.trim())),
    );
    if (children.length === 1) return [children[0], children[0]];
  }
  return [];
}

function objectValue(node, name) {
  if (!node || !ts.isObjectLiteralExpression(node) || node.properties.some(ts.isSpreadAssignment))
    return null;
  const prop = node.properties.find(
    (item) =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) &&
      (literal(item.name) ?? item.name.getText()) === name,
  );
  return prop && (ts.isShorthandPropertyAssignment(prop) ? prop.name : prop.initializer);
}

function duplicateFeedbackGuard(tree, imports, resolve, add) {
  const rendered = new Map();
  const stateSinks = new Map();
  const calls = [];
  const record = (groups, context, channel, value, diagnostic) => {
    if (!groups.has(context)) groups.set(context, new Map());
    const messages = groups.get(context);
    const previous = messages.get(value);
    if (!previous) messages.set(value, { channel, reported: false });
    else if (previous.channel !== channel && !previous.reported) {
      previous.reported = true;
      add("duplicate-feedback-channel", diagnostic.getStart(tree));
    }
  };
  const visit = (node) => {
    const opening = openingOf(node);
    if (opening && !hasSpread(opening)) {
      const name =
        ts.isIdentifier(opening.tagName) && !resolve(opening.tagName)
          ? sharedName(imports, opening.tagName.text)
          : null;
      const channel = feedbackChannels.get(name);
      if (name === "Button") {
        const reason = footerReason(node, opening, imports, resolve);
        if (reason) add("duplicate-feedback-channel", reason.getStart(tree));
      }
      if (channel && !attribute(opening, "hidden")) {
        const [message, diagnostic] = feedbackMessage(node, opening, name);
        const value = boundValue(message, resolve);
        if (value) {
          record(rendered, renderContext(node), channel, value, diagnostic);
          if (
            channel !== "toast" &&
            value.kind === ts.SyntaxKind.BindingElement &&
            ts.isArrayBindingPattern(value.parent) &&
            value.parent.elements[0] === value
          ) {
            const [state, setter] = value.parent.elements;
            const hook = state.parent.parent.initializer;
            const callee = hook && ts.isCallExpression(hook) && hook.expression;
            const imported = callee && ts.isIdentifier(callee) && imports.get(callee.text);
            if (
              imported?.source === "react" &&
              imported.name === "useState" &&
              !resolve(callee) &&
              setter &&
              ts.isBindingElement(setter)
            )
              stateSinks.set(setter, channel);
          }
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isExpressionStatement(node.parent) &&
      ts.isBlock(node.parent.parent)
    )
      calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);

  const operations = new Map();
  const runStarts = new Map();
  for (const call of calls) {
    const callee = call.expression;
    let channel;
    let message;
    if (ts.isIdentifier(callee)) {
      channel = stateSinks.get(resolve(callee));
      message = call.arguments[0];
    } else if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === "show" &&
      ts.isIdentifier(callee.expression)
    ) {
      const receiver = callee.expression;
      const local = resolve(receiver);
      const hook = local?.initializer;
      const entry = !local
        ? imports.get(receiver.text)
        : hook &&
          ts.isCallExpression(hook) &&
          ts.isIdentifier(hook.expression) &&
          !resolve(hook.expression) &&
          imports.get(hook.expression.text);
      if (inSharedUi(entry) && entry.name === (local ? "useToast" : "toast")) {
        channel = "toast";
        message = objectValue(call.arguments[0], "message");
      }
    }
    const value = boundValue(message, resolve);
    // Equal translation keys alone cannot identify the operation.
    if (channel && value) {
      const statement = call.parent;
      const statements = statement.parent.statements;
      const preceding = statements[statements.indexOf(statement) - 1];
      const start = runStarts.get(preceding) ?? statement;
      runStarts.set(statement, start);
      record(operations, start, channel, value, message);
    }
  }
}

/** Narrow JSX-only guards, routed through scanFile's existing suppression and ratchet. */
export function scanViewGuards(file, source, add) {
  if (!file.endsWith(".tsx") || !/^src\/(?:app|features|shared)\//.test(file)) return;
  // Avoid parsing most source files; comments and string examples are rejected by the AST.
  if (
    !/card|opacity-0|invisible|Group|(?:t|T)ooltip|description|muted|secondary|className|aria-label|role|disabled|Badge|caption|title|ModalActions|InlineMessage|InlineError|Alert|FailureState|Toast|(?:focus|outline)[-:]/.test(
      source,
    )
  )
    return;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = importBindings(file, tree);
  const resolve = lexicalBindings(tree);
  duplicateFeedbackGuard(tree, imports, resolve, add);
  const visit = (node, cards = 0, groups = 0) => {
    if (ts.isFunctionLike(node)) cards = groups = 0;
    const opening = openingOf(node);
    if (opening) {
      const card = isCard(opening);
      const group = isSettingsGroup(opening, source);
      if (card && cards > 0) add("nested-card", opening.getStart(tree));
      // A settings Group is already a framed card: no card or Group inside it, no Group in a card.
      else if ((card && groups > 0) || (group && cards + groups > 0))
        add("nested-surface", opening.getStart(tree));
      if (card) cards++;
      if (group) groups++;
      const name = sharedName(imports, opening.tagName.getText());
      inlineHelpGuard(node, opening, name, imports, resolve, add);
      if (/^src\/(?:app|features)\//.test(file)) {
        const semantic = semanticName(opening, imports, resolve);
        auditView(node, opening, semantic, imports, resolve, add, file);
        if (
          /^[A-Z]/.test(opening.tagName.getText()) &&
          (semantic ?? opening.tagName.getText()) !== "Alert" &&
          literal(attribute(opening, "role")?.initializer) === "status"
        )
          add("role-status-banner", opening.getStart(tree));
        const title = attribute(opening, "title");
        if (semantic === "TreeRow" && title && literal(title.initializer) !== "")
          add("native-title", title.getStart(tree));
      }
      const hint = tooltipRepeatsLabel(node, opening, imports, resolve);
      if (hint) add("tooltip-repeats-label", hint.getStart(tree));
      if (
        /^src\/(?:app|features)\//.test(file) &&
        (sizedControls.has(name) || additionalControls.has(name)) &&
        ts.isIdentifier(opening.tagName) &&
        !resolve(opening.tagName)
      )
        for (const prop of opening.attributes.properties)
          if (ts.isJsxAttribute(prop) && classSlot.test(prop.name.getText()))
            scanSharedFocusClasses(prop.getText(tree), prop.getStart(tree), add);
      if (/^src\/(?:features|shared)\//.test(file)) {
        const className = attribute(opening, "className");
        if (className?.initializer && hoverOnly(className.initializer))
          add("hover-only-reveal", className.getStart(tree));
      }
    }
    ts.forEachChild(node, (child) => visit(child, cards, groups));
  };
  visit(tree);
}

/* ---------- CSS selector guards (feature and app CSS) ---------- */

/*
 * Shared component internals that feature CSS must not select. Derived from the global
 * (non-module) classes and data hooks that src/shared/ui and src/styles define or set:
 *   Modal.tsx / Sheet.tsx / Popover.tsx   .modal, .modal-panel, .modal-backdrop, .sheet,
 *                                         .popover, .popover-open|backdrop|solid
 *   shared/ui/settings/settings.css       the settings-group / settings-row family (exact names, so a
 *                                         feature's own settings-* class is not caught)
 *   Tabs.tsx                              tab-motion|opening|closing and role=tablist|tab
 *   Button / PaneHeader / ActionHost      data-slot, data-button-*, data-pane-header-*, data-action-host
 *   arc components                        .bycoda-arc-* (the bare .bycoda-arc root is an allowed scope)
 * Change the shared component (a prop, a slot, a variant) instead of reaching into it.
 */
const sharedClasses = [
  "modal",
  "modal-panel",
  "modal-backdrop",
  "sheet",
  "popover",
  "popover-open",
  "popover-backdrop",
  "popover-solid",
  "settings",
  "settings-advanced",
  "settings-advanced-toggle",
  "settings-dependency",
  "settings-feedback",
  "settings-group",
  "settings-group-action",
  "settings-group-content",
  "settings-group-feedback",
  "settings-group-heading",
  "settings-group-title",
  "settings-help-text",
  "settings-hint",
  "settings-row",
  "settings-row-control",
  "settings-row-feedback",
  "settings-row-label",
  "settings-row-title",
  "settings-scope",
  "settings-subheading",
  "settings-title-line",
  "settings-topics",
  "tab-motion",
  "tab-opening",
  "tab-closing",
];
const sharedInternalSelector = new RegExp(
  String.raw`\.(?:${sharedClasses.join("|")})(?![\w-])|\.bycoda-arc-[\w-]+` +
    String.raw`|\[\s*data-(?:slot|button-[\w-]+|pane-header[\w-]*|action-host|fbg-item)\b` +
    String.raw`|\[\s*role\s*=\s*["']?(?:tablist|tab)["']?\s*\]`,
);

/** Rules a CSS selector prelude breaks (one entry per rule). */
export function cssSelectorRules(selector) {
  const found = [];
  if (sharedInternalSelector.test(selector)) found.push("shared-internal-selector");
  // .x.x doubles the specificity to win a cascade fight: fix the order or the owner instead.
  if (/(\.-?[\w-]+)\1(?![\w-])/.test(selector)) found.push("specificity-doubling");
  return found;
}

/** A global selector or an attribute value with the same spelling is not a module member. */
export function selectsSharedModuleSlot(selectors, members) {
  const components = new Set();
  if (!members?.size) return components;
  for (const selector of selectors) {
    if (selector.startsWith("@")) continue;
    const local = selector
      .replace(/:global\((?:[^()]|\([^()]*\))*\)/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/:global\s+[^,]+/g, "");
    for (const match of local.matchAll(/\.([\w-]+)/g))
      for (const component of members.get(match[1]) ?? []) components.add(component);
  }
  return components;
}

/** Selector text of an ink rule: the transcript's reading surfaces own their text roles. */
const transcriptSelector = /\.agent-markdown|\[data-chat-message-surface\b|\.transcript-/;
/** A text color read straight from the content base (K12): use --ui-text-* or a transcript ink role. */
const baseContentInk = /var\(\s*--color-content(?![\w-])/;

/**
 * True for a `color` declaration in transcript CSS that takes its ink from var(--color-content),
 * directly or through color-mix(). Transcript CSS is src/features/sessions/ui/**, and the
 * .agent-markdown, [data-chat-message-surface] and .transcript-* rules in the shared stylesheets.
 */
export function transcriptBaseInk(file, { property, value, selectors }, tokenBlock = false) {
  // The transcript ink and surface roles are defined once, in transcript-surface.css.
  if (/^--transcript-(?:ink|surface)-/.test(property))
    return !file.endsWith("/transcript-surface.css");
  if (tokenBlock || property !== "color" || !baseContentInk.test(value)) return false;
  if (file.startsWith("src/features/sessions/ui/")) return true;
  return (
    (file === "src/styles/index.css" || file === "src/styles/bycoda.css") &&
    selectors.some((selector) => transcriptSelector.test(selector))
  );
}

/** Selector text of a workbench pane root: the rail, the session sidebar and framed panes. */
const paneRootSelector =
  /\[data-side-pane\b|\.bycoda-sidebar\b|\.bycoda-project-rail\b|\.sidebar-pane\b|\.sidebar-glass\b|\.body-glass\b|\[data-surface-frame=["']?pane["']?\]/;

/**
 * True for a declaration that erases the 1px edge between workbench panes: a border, border-width
 * or border-color on a pane root that is 0, none, hidden or transparent. The edge colour and
 * width are owned by --ui-pane-border (src/styles/index.css, pinned by paneBorderContrast.test.ts);
 * a pane that must not show an edge drops the frame via its Surface edge prop, not by hiding it.
 */
export function paneEdgeErased({ property, value, selectors }, tokenBlock = false) {
  if (
    tokenBlock ||
    !/^border(?:-(?:inline|block)-(?:start|end)|-top|-right|-bottom|-left)?(?:-color|-width)?$/.test(
      property,
    )
  )
    return false;
  if (!selectors.some((selector) => paneRootSelector.test(selector))) return false;
  return /^\s*(?:0(?:px)?|none|hidden|transparent)\b/.test(value);
}
