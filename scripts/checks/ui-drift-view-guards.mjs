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
  if (!/primary|card|opacity-0|invisible/.test(source)) return;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let primaryReported = false;
  const visit = (node, cards = 0) => {
    if (ts.isFunctionLike(node)) cards = 0;
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
      if (isCard(opening)) {
        if (cards > 0) add("nested-card", opening.getStart(tree));
        cards++;
      }
      if (/^src\/(?:features|shared)\//.test(file)) {
        const className = attribute(opening, "className");
        if (className?.initializer && hoverOnly(className.initializer))
          add("hover-only-reveal", className.getStart(tree));
      }
    }
    ts.forEachChild(node, (child) => visit(child, cards));
  };
  visit(tree);
}
