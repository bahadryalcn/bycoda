import ts from "@typescript/typescript6";

const literal = (node) => {
  if (node && ts.isJsxExpression(node)) node = node.expression;
  return node && ts.isStringLiteralLike(node) ? node.text : null;
};
const attribute = (opening, name) =>
  opening.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.text === name);

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
  opening.tagName.getText() === "Group" && /from\s+["'][^"']*settingsControls["']/.test(source);

/** Compile-time text of a JSX child or attribute value: literal, plain template or `t("...")`. */
function staticText(node) {
  if (node && ts.isJsxExpression(node)) node = node.expression;
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isCallExpression(node) &&
    node.expression.getText() === "t" &&
    node.arguments[0] &&
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

/** Visible static strings among the children; `deep` also walks nested elements. */
function visibleTexts(element, deep) {
  const texts = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (ts.isJsxText(child)) {
        if (child.text.trim()) texts.push(child.text);
      } else if (ts.isJsxElement(child)) {
        if (deep) walk(child);
      } else {
        const text = staticText(child);
        if (text) texts.push(text);
      }
    }
  };
  if (ts.isJsxElement(element)) walk(element);
  return texts;
}

/** A hint that only restates the visible label adds nothing (owner rule: no redundant tooltips). */
function tooltipRepeatsLabel(node, opening) {
  const isTooltip = opening.tagName.getText() === "Tooltip";
  const [hint, when, extra] = isTooltip
    ? ["label", "when", ["details", "shortcut"]]
    : ["tooltip", "tooltipWhen", ["tooltipDetails", "tooltipShortcut"]];
  const text = staticText(attribute(opening, hint)?.initializer);
  if (!text || !ts.isJsxElement(node)) return false;
  if (literal(attribute(opening, when)?.initializer) === "overflow") return false;
  if (extra.some((name) => attribute(opening, name))) return false;
  const wanted = normalizedText(text);
  const shown = visibleTexts(node, isTooltip).map(normalizedText);
  if (shown.length > 1) shown.push(normalizedText(shown.join(" ")));
  return wanted.length > 0 && shown.includes(wanted);
}

/** Maximum literal primary buttons rendered together in one expression. */
function primaryCount(node) {
  if (!node || ts.isFunctionLike(node)) return 0;
  if (ts.isConditionalExpression(node))
    return Math.max(primaryCount(node.whenTrue), primaryCount(node.whenFalse));
  if (
    ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(
      node.operatorToken.kind,
    )
  )
    return Math.max(primaryCount(node.left), primaryCount(node.right));
  const opening = ts.isJsxElement(node)
    ? node.openingElement
    : ts.isJsxSelfClosingElement(node)
      ? node
      : null;
  let count =
    opening?.tagName.getText() === "Button" &&
    literal(attribute(opening, "variant")?.initializer) === "primary"
      ? 1
      : 0;
  ts.forEachChild(node, (child) => {
    count += primaryCount(child);
  });
  return count;
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

/** Narrow JSX-only guards, routed through scanFile's existing suppression and ratchet. */
export function scanViewGuards(file, source, add) {
  if (!file.endsWith(".tsx") || !/^src\/(?:app|features|shared)\//.test(file)) return;
  // Avoid parsing most source files; comments and string examples are rejected by the AST.
  if (!/primary|card|opacity-0|invisible|Group|tooltip|Tooltip/.test(source)) return;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let primaryReported = false;
  const visit = (node, cards = 0, groups = 0) => {
    if (ts.isFunctionLike(node)) cards = groups = 0;
    let returned = ts.isReturnStatement(node)
      ? node.expression
      : ts.isArrowFunction(node) && !ts.isBlock(node.body)
        ? node.body
        : null;
    while (returned && ts.isParenthesizedExpression(returned)) returned = returned.expression;
    if (!primaryReported && returned && primaryCount(returned) > 1) {
      add("one-primary-per-view", returned.getStart(tree));
      primaryReported = true;
    }
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening) {
      const card = isCard(opening);
      const group = isSettingsGroup(opening, source);
      if (card && cards > 0) add("nested-card", opening.getStart(tree));
      // A settings Group is already a framed card: no card or Group inside it, no Group in a card.
      else if ((card && groups > 0) || (group && cards + groups > 0))
        add("nested-surface", opening.getStart(tree));
      if (card) cards++;
      if (group) groups++;
      if (
        (opening.attributes.properties.length && attribute(opening, "tooltip")) ||
        opening.tagName.getText() === "Tooltip"
      )
        if (tooltipRepeatsLabel(node, opening))
          add("tooltip-repeats-label", opening.getStart(tree));
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
