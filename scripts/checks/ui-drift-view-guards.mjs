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
  opening.tagName.getText() === "Group" && /from\s+["'][^"']*shared\/ui\/settings["']/.test(source);

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

/** Only known shared labels and direct translated copy: no prose-length guesses. */
function inlineHelpGuard(tree, add) {
  const names = new Map();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const path = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      const imported = (item.propertyName ?? item.name).text;
      if (
        (/settingsControls$|shared\/ui\/settings(?:\/index)?$/.test(path) && imported === "Row") ||
        (/shared\/ui\/(?:Text|Field|Heading|SectionLabel|SectionHeader|InfoPopover)$/.test(path) &&
          ["Text", "Field", "Heading", "SectionLabel", "SectionHeader", "InfoPopover"].includes(
            imported,
          ))
      )
        names.set(item.name.text, imported);
    }
  }
  const openingOf = (node) =>
    ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
  const kindOf = (node) => {
    const opening = openingOf(node);
    return opening
      ? (names.get(opening.tagName.getText()) ??
          (/^(?:p|h[1-6])$/.test(opening.tagName.getText()) ? opening.tagName.getText() : null))
      : null;
  };
  const label = (node) =>
    [
      "Row",
      "Field",
      "Heading",
      "SectionLabel",
      "SectionHeader",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
    ].includes(kindOf(node));
  const insideInfo = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isJsxAttribute(parent) && parent.name.getText() === "info") return true;
      const opening = openingOf(parent);
      if (
        kindOf(parent) === "InfoPopover" ||
        (opening && literal(attribute(opening, "slot")?.initializer) === "info")
      )
        return true;
    }
    return false;
  };
  const visit = (node) => {
    if (ts.isJsxElement(node) && ["Text", "p"].includes(kindOf(node))) {
      const tone = literal(attribute(node.openingElement, "tone")?.initializer);
      const translated = node.children.some((child) => {
        const expression = ts.isJsxExpression(child) && child.expression;
        return (
          expression &&
          ts.isCallExpression(expression) &&
          expression.expression.getText() === "t" &&
          expression.arguments[0] &&
          ts.isStringLiteralLike(expression.arguments[0]) &&
          expression.arguments[0].text.length > 100
        );
      });
      const parent = node.parent;
      const siblings =
        ts.isJsxElement(parent) || ts.isJsxFragment(parent)
          ? parent.children
              .filter((child) => !ts.isJsxText(child) || child.text.trim())
              .filter((child) => !ts.isJsxExpression(child) || child.expression)
          : [];
      const previous = siblings[siblings.indexOf(node) - 1];
      if (
        ["muted", "secondary"].includes(tone) &&
        translated &&
        !insideInfo(node) &&
        (["Row", "Field"].includes(kindOf(parent)) || (previous && label(previous)))
      )
        add("inline-help-text", node.getStart(tree));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}

/** Narrow JSX-only guards, routed through scanFile's existing suppression and ratchet. */
export function scanViewGuards(file, source, add) {
  if (!file.endsWith(".tsx") || !/^src\/(?:app|features|shared)\//.test(file)) return;
  // Avoid parsing most source files; comments and string examples are rejected by the AST.
  if (!/primary|card|opacity-0|invisible|Group|tooltip|Tooltip|muted|secondary/.test(source))
    return;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  inlineHelpGuard(tree, add);
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
