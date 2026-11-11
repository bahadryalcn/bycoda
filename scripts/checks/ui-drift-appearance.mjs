/**
 * Appearance ownership rules of the UI drift ratchet (check-ui-drift.mjs runs them).
 *
 * Feature and app code places things; it does not choose how they look. Type, surfaces,
 * interaction states, control sizes, truncation, motion and scrollbars come from a shared
 * component (docs/reference/ui-components.md). Layout stays free in feature code: display, grid,
 * flex, gap, margin, width, overflow and alignment are never reported here; only a literal
 * spacing value off the scale is.
 *
 * A rule bans properties, not component names. Each one is counted per file in the baseline, so
 * existing code stays as debt and only new findings fail.
 */

export const appearanceRules = {
  "feature-typography":
    "type chosen in feature code: font-size, font-weight, line-height, letter-spacing or text color, in CSS or as text-*/font-*/leading-*/tracking-* classes (use Text; Heading for a title, SectionLabel for a group caption)",
  "surface-style":
    "surface drawn in feature code: border, outline, border-radius, background or box-shadow, in CSS or as border/rounded/bg-*/shadow/ring/outline/divide classes (use Surface, Divider, FieldGroup)",
  "interaction-state":
    "interaction state styled in feature code: :hover, :active, :focus*, [aria-selected] selectors or hover:/active:/focus*:/aria-selected: classes (use Button, Button variant=item, ActionHost, TreeRow, MenuRow, Tabs)",
  "text-truncation":
    "truncation written in feature code: text-overflow, line-clamp, truncate, text-ellipsis (one line: Text truncate; several lines: ClampText, with expandable={false} for a cut without the Show more action; a path or id: MiddleTruncate)",
  "feature-motion":
    "motion written in feature code: transition or animation, in CSS or as transition/animate-*/duration-*/ease-*/delay-* classes (use Motion; waiting states are Spinner, LoadingText, Skeleton, WorkingIndicator)",
  "scrollbar-style":
    "scrollbar styled in feature code: scrollbar-* properties, ::-webkit-scrollbar or scrollbar-* classes (use ScrollArea)",
  "inline-style-property":
    'style={{ … }} sets a CSS property directly; an inline style may only carry custom properties (style={{ "--x": value }}) that a class reads',
  "spacing-step":
    "gap, padding or margin with a literal off the spacing scale: a bare px/rem value other than 0, 4, 6, 8, 10, 12, 14, 16, 20 or 24 px, or a Tailwind step other than 0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6 (var(--space-*) is always allowed)",
};

/**
 * Surfaces that own their look by design: the transcript and its markdown output, the chat
 * composer editor, the terminal, code and diff editors, document and media viewers, the
 * appearance previews and drawn scenes. The appearance rules skip exactly these files; every other UI drift rule
 * still applies. A file is listed by path, never matched by a word in its name: a toggle, menu or
 * toolbar that sits next to a bespoke surface is an ordinary control.
 */
export const bespokeSurfaces = new Set([
  // Transcript and markdown output
  "src/features/sessions/ui/AgentTranscript.tsx",
  "src/features/sessions/ui/AgentTranscriptActivity.tsx",
  "src/features/sessions/ui/TranscriptVirtualRows.tsx",
  "src/features/sessions/ui/AgentMarkdown.tsx",
  "src/features/sessions/ui/MarkdownDocumentPreview.tsx",
  "src/features/voice/ui/companion/VoiceChatTranscript.tsx",
  // Chat composer editor
  "src/features/sessions/ui/Composer.tsx",
  "src/features/sessions/ui/ComposerHighlight.tsx",
  "src/features/sessions/ui/ComposerHighlight.module.css",
  "src/features/sessions/ui/ComposerAttachmentHighlight.tsx",
  "src/features/sessions/ui/ComposerAttachmentHighlight.module.css",
  // Terminal
  "src/features/terminal/ui/TerminalView.tsx",
  "src/features/terminal/ui/TerminalGhostText.tsx",
  "src/features/terminal/ui/terminal.css",
  "src/features/connections/ui/ServerTerminalSession.tsx",
  "src/features/connections/ui/ServerTerminalSession.module.css",
  // Code and diff editors
  "src/features/files/ui/CodeMirrorEditor.tsx",
  "src/features/notes/ui/NoteMarkdownEditor.tsx",
  "src/features/source-control/ui/MergeConflictEditor.tsx",
  "src/features/source-control/ui/GitGraphConflictEditor.tsx",
  "src/features/source-control/ui/UnifiedDiffView.tsx",
  "src/features/source-control/ui/UnifiedDiffView.css",
  "src/features/source-control/ui/DiffOverviewRuler.tsx",
  "src/features/sessions/ui/ToolDiffPreview.tsx",
  // Document and media viewers
  "src/features/files/ui/DocxViewer.tsx",
  "src/features/files/ui/PdfViewer.tsx",
  "src/features/files/ui/SheetViewer.tsx",
  "src/features/files/ui/pdfTextLayer.css",
  "src/features/files/ui/MediaView.tsx",
  "src/features/files/ui/HtmlPreview.tsx",
  "src/features/sessions/ui/LocalMedia.tsx",
  "src/features/sessions/ui/TranscriptImagePreview.tsx",
  "src/features/inbox/ui/InboxMedia.tsx",
  // Canvas and scene drawing
  "src/features/sessions/ui/CrewScene.tsx",
  "src/features/sessions/ui/CrewScene.css",
  "src/features/sessions/ui/PacingUncle.tsx",
  // Appearance previews
  "src/features/settings/ui/AppearancePreviews.tsx",
  "src/features/settings/ui/AppearancePreviews.css",
  "src/features/settings/ui/LiveBackgroundCanvas.tsx",
  "src/features/settings/ui/LiveBackgroundCanvas.css",
  "src/features/settings/ui/appearance/controls/BackgroundPreview.tsx",
  "src/features/settings/ui/appearance/controls/BackgroundPreview.module.css",
  "src/features/settings/ui/appearance/controls/SidebarRowPreview.tsx",
  "src/features/settings/ui/appearance/controls/ThemePreview.tsx",
  "src/features/settings/ui/appearance/controls/TypographyPreview.tsx",
  "src/features/settings/ui/appearance/controls/SceneStrip.tsx",
  "src/features/settings/ui/appearance/controls/SceneStrip.module.css",
  // Drawn scenes
  "src/features/sessions/ui/CrewScene.tsx",
  "src/features/sessions/ui/CrewScene.css",
  "src/features/sessions/ui/PacingUncle.tsx",
]);

export const isBespokeSurface = (file) => bespokeSurfaces.has(file);

// Variant prefixes may carry `/` (named containers/groups: @max-[950px]/main-row:) and `(` `)`
// (arbitrary values: has-(--x):); a narrower charset lets those classes escape every Tailwind rule.
export const variantChars = String.raw`[\w\-\[\]&@*=/().,%]`;
const variant = String.raw`(?<![\w\-\[(:/])((?:${variantChars}+:)*)`;
/** Lookahead that ends a Tailwind utility name. */
export const end = String.raw`(?![\w.\-])`;
/** A Tailwind utility with any variant prefix; the match starts at the first variant. */
export const tw = (body, flags = "g") => new RegExp(variant + body, flags);

const value = String.raw`[\w\[(]`;
const stateVariant = String.raw`(?:(?:group|peer)-)?(?:hover|active|focus(?:-visible|-within)?|aria-selected)(?:\/[\w-]+)?:`;
const spacingUtility = String.raw`-?(?:p|px|py|ps|pe|pt|pb|pl|pr|m|mx|my|ms|me|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)`;

/** Order matters: a class reported by an earlier rule is not reported again by a later one. */
const classRules = [
  [
    "interaction-state",
    new RegExp(String.raw`(?<![\w\-\[(:/])(?:${variantChars}+:)*${stateVariant}[\w\-\[(!]`, "g"),
  ],
  ["feature-typography", tw(String.raw`text-(?:xs|sm|base|lg|xl|\dxl)` + end)],
  ["feature-typography", tw(String.raw`text-[\[(]`)],
  [
    "feature-typography",
    tw(
      String.raw`text-(?!left\b|center\b|right\b|justify\b|start\b|end\b|wrap\b|nowrap\b|balance\b|pretty\b|ellipsis\b|clip\b|xs\b|sm\b|base\b|lg\b|xl\b|\dxl\b)[a-z]`,
    ),
  ],
  [
    "feature-typography",
    tw(
      String.raw`font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)` + end,
    ),
  ],
  ["feature-typography", tw(String.raw`(?:leading|tracking)-${value}`)],
  ["text-truncation", tw(String.raw`(?:truncate|text-ellipsis|text-clip)` + end)],
  ["text-truncation", tw(String.raw`line-clamp-${value}`)],
  ["surface-style", tw(String.raw`border(?!-collapse|-separate|-spacing)(?:-[\w\[(/.]+)*` + end)],
  ["surface-style", tw(String.raw`(?:rounded|shadow|ring|outline)(?:-[\w\[(/.]+)*` + end)],
  ["surface-style", tw(String.raw`(?:bg|divide)-${value}`)],
  ["feature-motion", tw(String.raw`transition(?:-[\w\[(]+)*` + end)],
  ["feature-motion", tw(String.raw`(?:animate|duration|ease|delay)-${value}`)],
  ["scrollbar-style", tw(String.raw`scrollbar-${value}`)],
  ["scrollbar-style", tw(String.raw`\[(?:&::-webkit-scrollbar|scrollbar-)`)],
];

const spacingClass = tw(String.raw`${spacingUtility}-(\d+(?:\.\d+)?|px)` + end);
const spacingSteps = new Set(["0", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6"]);
/** The same steps in px: 4 px per Tailwind step. */
const spacingPixels = new Set([...spacingSteps].map((step) => step * 4));
/** A bare px/rem length off the spacing scale; tokens, percentages and keywords are not lengths. */
const offScale = (part) => {
  const length = /^-?(\d*\.?\d+)(px|rem)$/.exec(part);
  return length !== null && !spacingPixels.has(length[1] * (length[2] === "rem" ? 16 : 1));
};

/** The balanced `{…}` (or `(…)`) that opens at `start`; returns the offset after its close. */
function balancedEnd(text, start, open, close) {
  let depth = 0;
  let quote = null;
  const limit = Math.min(text.length, start + 8000);
  for (let index = start; index < limit; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === open) depth++;
    else if (char === close && --depth === 0) return index + 1;
  }
  return limit;
}

/**
 * Offsets of the class lists in a TSX source: values of `className`-like attributes, properties
 * and variables, and the arguments of class-joining calls (`cn(…)`, `clsx(…)`) whatever the
 * result is named. Bare utility names (border, shadow, truncate) are ordinary words elsewhere.
 * Ranges do not overlap, so a class is read once.
 */
export function classRanges(source) {
  const ranges = [];
  for (const match of source.matchAll(/(?<![\w$.])(?:cn|clsx|twMerge|twJoin|cva)\(/g)) {
    const open = match.index + match[0].length - 1;
    ranges.push([open + 1, balancedEnd(source, open, "(", ")")]);
  }
  for (const match of source.matchAll(/\b[\w$]*[cC]lass(?:Name|Names|es)?\s*[=:]\s*/g)) {
    const start = match.index + match[0].length;
    const char = source[start];
    let stop;
    if (char === '"' || char === "'" || char === "`") {
      stop = start + 1;
      while (stop < source.length && source[stop] !== char) stop += source[stop] === "\\" ? 2 : 1;
    } else if (char === "{") stop = balancedEnd(source, start, "{", "}");
    else {
      // An expression: a ternary or a call on the same statement.
      const line = source.indexOf("\n", start);
      stop = line < 0 ? source.length : line;
    }
    ranges.push([start, stop]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}

/** Appearance findings in the class lists and inline styles of a feature TSX file. */
export function scanAppearanceTsx(source, add) {
  for (const [start, stop] of classRanges(source)) {
    const text = source.slice(start, stop);
    for (const [rule, pattern] of classRules)
      for (const match of text.matchAll(pattern)) add(rule, start + match.index);
    for (const match of text.matchAll(spacingClass))
      // An arbitrary length (p-[7px]) is the narrower arbitrary-spacing rule's finding.
      if (!spacingSteps.has(match[2])) add("spacing-step", start + match.index);
  }
  for (const match of source.matchAll(/\bstyle=\{\{/g)) {
    const open = match.index + match[0].length - 1;
    const body = source
      .slice(open + 1, balancedEnd(source, open, "{", "}") - 1)
      // Nested objects, calls and strings hold values, never keys of this object.
      .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, (text) => (text.includes("--") ? '"--"' : '""'))
      .replace(/\{[^{}]*\}|\([^()]*\)/g, "");
    if (/(?:^|,)\s*(?:[A-Za-z_$][\w$]*|"")\s*(?::|,|$)/.test(body))
      add("inline-style-property", match.index);
  }
}

const stateSelector = /:hover|:active|:focus|\[aria-selected/;
const controlSelector =
  /(?:^|[\s>+~,(])(?:button|input|select|textarea)(?![\w-])|\[role=["']?button/;
const spacingProperty = /^(?:gap|row-gap|column-gap|(?:padding|margin)(?:-[a-z-]+)?)$/;

/** The appearance rule a feature CSS declaration breaks, if any. */
export function appearanceRuleOfDeclaration({ property, value: raw, selectors }) {
  if (property.startsWith("--")) return null;
  if (selectors.some((selector) => /::-webkit-scrollbar/.test(selector))) return "scrollbar-style";
  // One finding per declaration: a state block is reported as a state, not as its contents.
  if (selectors.some((selector) => stateSelector.test(selector))) return "interaction-state";
  if (/^(?:font-size|font-weight|line-height|letter-spacing|color|font)$/.test(property))
    return "feature-typography";
  if (/^(?:text-overflow|-webkit-line-clamp|line-clamp)$/.test(property)) return "text-truncation";
  if (
    /^(?:border(?!-collapse|-spacing)|outline|background|box-shadow)/.test(property) &&
    property !== "background-clip"
  )
    return "surface-style";
  if (/^(?:transition|animation)/.test(property)) return "feature-motion";
  if (property.startsWith("scrollbar-")) return "scrollbar-style";
  if (
    /^(?:height|min-height|block-size|min-block-size)$/.test(property) &&
    controlSelector.test(selectors.at(-1) ?? "")
  )
    return "fixed-control-size";
  if (spacingProperty.test(property)) {
    // Tokens and computed values (var(--space-*), calc(), clamp()) are never compared; only the
    // bare lengths beside them are.
    const text = raw.replace(/[\w-]+\((?:[^()]|\([^()]*\))*\)/g, " ");
    if (text.split(/\s+/).some(offScale)) return "spacing-step";
  }
  return null;
}

/** Shared controls that take their size from a `size` prop, never from classes. */
export const sizedControls = new Set([
  "Button",
  "ActionHost",
  "InlineAction",
  "InlineTextAction",
  "InlineMoreAction",
  "SplitButton",
  "TextField",
  "TextareaField",
  "PasswordField",
  "NumberField",
  "SearchInput",
  "Select",
  "SearchableSelect",
  "Combobox",
  "SegmentedControl",
  "Checkbox",
  "Switch",
]);
/** Height, minimum height, square size or padding set by class on a control. */
export const controlSizeClass = tw(
  String.raw`(?:(?:h|min-h|size)-${value}|(?:p|px|py|ps|pe|pt|pb|pl|pr)-(?:\d|\[))`,
  "",
);
