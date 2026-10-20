import { getIndentUnit, language, StreamLanguage, syntaxTree } from "@codemirror/language";
import { forEachDiagnostic, setDiagnosticsEffect, type Diagnostic } from "@codemirror/lint";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { editorMatching } from "./editorEditing";

const MAX_CHARS = 512 * 1024;
const MAX_LINE = 10_000;
const tones = ["warning", "info", "feature", "success"] as const;
const commentNode = /comment/i;
const brackets = new Set([
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "${",
  "InterpolationStart",
  "InterpolationEnd",
]);
const severityRank: Record<Diagnostic["severity"], number> = {
  hint: 0,
  info: 1,
  warning: 2,
  error: 3,
};

class ColorSwatch extends WidgetType {
  constructor(readonly color: string) {
    super();
  }
  eq(other: ColorSwatch) {
    return this.color === other.color;
  }
  toDOM() {
    const swatch = document.createElement("span");
    swatch.className = "cm-colorSwatch";
    // This is document content, not an application theme color. The entire
    // value is validated as a CSS color; never inject source into a style sheet.
    swatch.style.backgroundColor = this.color;
    swatch.title = this.color;
    swatch.setAttribute("aria-hidden", "true");
    return swatch;
  }
}

class DiagnosticLabel extends WidgetType {
  constructor(
    readonly message: string,
    readonly severity: string,
  ) {
    super();
  }
  eq(other: DiagnosticLabel) {
    return this.message === other.message && this.severity === other.severity;
  }
  toDOM() {
    const label = document.createElement("span");
    label.className = `cm-diagnosticLabel cm-readability-${this.severity}`;
    label.textContent = ` ${this.severity}: ${this.message}`;
    label.title = this.message;
    return label;
  }
}

function mark(ranges: Range<Decoration>[], from: number, to: number, className: string) {
  if (to > from) ranges.push(Decoration.mark({ class: className }).range(from, to));
}

function bracketDepth(node: SyntaxNode) {
  let depth = -1;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (brackets.has(parent.firstChild?.name ?? "")) depth++;
  }
  return Math.max(0, depth) % tones.length;
}

/** Stream parsers omit punctuation nodes. Scan their parsed gaps, excluding
 * comment/string tokens, once per document/tree change rather than per scroll. */
function streamBrackets(state: EditorState): Range<Decoration>[] {
  if (!(state.facet(language) instanceof StreamLanguage) || state.doc.length > MAX_CHARS) return [];
  const tree = syntaxTree(state);
  const excluded: { from: number; to: number }[] = [];
  tree.iterate({
    enter(node) {
      if (/comment|string|regexp|character/i.test(node.name)) {
        excluded.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  const text = state.sliceDoc(0, tree.length);
  const ranges: Range<Decoration>[] = [];
  const stack: { char: string; depth: number }[] = [];
  let skipped = 0;
  for (let pos = 0; pos < text.length; pos++) {
    while (skipped < excluded.length && excluded[skipped].to <= pos) skipped++;
    if (skipped < excluded.length && excluded[skipped].from <= pos) {
      pos = excluded[skipped].to - 1;
      continue;
    }
    const char = text[pos];
    const open = "([{",
      close = ")]}",
      closing = close.indexOf(char);
    if (open.includes(char)) {
      const depth = stack.length % tones.length;
      stack.push({ char, depth });
      mark(ranges, pos, pos + 1, `cm-rainbowBracket-${depth}`);
    } else if (closing !== -1) {
      const pair = stack[stack.length - 1];
      if (pair?.char === open[closing]) {
        stack.pop();
        mark(ranges, pos, pos + 1, `cm-rainbowBracket-${pair.depth}`);
      } else mark(ranges, pos, pos + 1, "cm-readability-error");
    }
  }
  return ranges;
}

/** Viewport-only presentation: source text, selection, history and diff ranges stay intact. */
export function editorReadability(path: string): Extension {
  const log = /(?:\.(?:log|out)|(?:^|[/\\])(?:output|logs?))$/i.test(path);
  return [
    editorMatching,
    EditorView.editorAttributes.of({ class: "cm-readableCodeEditor" }),
    readabilityTheme,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        stream: Range<Decoration>[];
        constructor(view: EditorView) {
          this.stream = streamBrackets(view.state);
          this.decorations = buildDecorations(view, log, this.stream);
        }
        update(update: ViewUpdate) {
          if (
            update.docChanged ||
            syntaxTree(update.state) !== syntaxTree(update.startState) ||
            update.state.facet(language) !== update.startState.facet(language)
          ) {
            this.stream = streamBrackets(update.state);
          }
          // Diagnostic transactions don't necessarily change the document or tree.
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.state.tabSize !== update.startState.tabSize ||
            getIndentUnit(update.state) !== getIndentUnit(update.startState) ||
            update.transactions.some((tr) =>
              tr.effects.some((effect) => effect.is(setDiagnosticsEffect)),
            ) ||
            syntaxTree(update.state) !== syntaxTree(update.startState)
          ) {
            this.decorations = buildDecorations(update.view, log, this.stream);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
  ];
}

function buildDecorations(
  view: EditorView,
  log: boolean,
  stream: Range<Decoration>[],
): DecorationSet {
  const { state } = view;
  if (state.doc.length > MAX_CHARS) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  const unit = getIndentUnit(state);
  const seen = new Set<number>();
  for (const visible of view.visibleRanges) {
    for (const bracket of stream) {
      if (bracket.from >= visible.from && bracket.to <= visible.to) ranges.push(bracket);
      if (bracket.from > visible.to) break;
    }
    for (
      let number = state.doc.lineAt(visible.from).number;
      number <= state.doc.lineAt(visible.to).number;
      number++
    ) {
      if (seen.has(number)) continue;
      seen.add(number);
      const line = state.doc.line(number);
      if (line.length > MAX_LINE) continue;
      const whitespace = line.text.match(/^[\t ]*/)?.[0] ?? "";
      let column = 0,
        start = 0,
        level = 0;
      for (let i = 0; i < whitespace.length && level < 64; i++) {
        column += whitespace[i] === "\t" ? state.tabSize - (column % state.tabSize) : 1;
        if (column >= (level + 1) * unit || i === whitespace.length - 1) {
          mark(
            ranges,
            line.from + start,
            line.from + i + 1,
            `cm-indentBand cm-indentBand-${level % tones.length}`,
          );
          start = i + 1;
          level = Math.floor(column / unit);
        }
      }
      if (log) {
        const severity =
          /\b(FATAL|ERROR|FAIL(?:ED|URE)?|WARN(?:ING)?|INFO|DEBUG|TRACE|SUCCESS|PASS(?:ED)?)\b/i.exec(
            line.text,
          );
        if (severity) {
          const word = severity[0].toUpperCase();
          const tone = /^(FATAL|ERROR|FAIL)/.test(word)
            ? "error"
            : word.startsWith("WARN")
              ? "warning"
              : /^(SUCCESS|PASS)/.test(word)
                ? "success"
                : "info";
          ranges.push(Decoration.line({ class: `cm-logLine cm-logLine-${tone}` }).range(line.from));
          mark(
            ranges,
            line.from + severity.index,
            line.from + severity.index + severity[0].length,
            `cm-readability-${tone}`,
          );
        }
      }
      // Tokens are bounded and validated; malformed source remains plain text.
      const colors =
        /#[\da-f]{8}\b|#[\da-f]{6}\b|#[\da-f]{4}\b|#[\da-f]{3}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lch|lab|color)\([^()\n]{1,160}\)|\b[a-z]+\b/gi;
      for (const match of line.text.matchAll(colors)) {
        if (/^[a-z]+$/i.test(match[0])) {
          const node = syntaxTree(state).resolveInner(line.from + match.index!, 1);
          if (!/^(ValueName|ColorLiteral|String|AttributeValue)$/.test(node.name)) continue;
          // A CSS identifier such as red-spinner, or prose inside a string,
          // is not a standalone color even when one of its words is a color.
          const token = state.sliceDoc(node.from, node.to).replace(/^['"]|['"]$/g, "");
          if (token !== match[0]) continue;
        }
        if (!globalThis.CSS?.supports("color", match[0])) continue;
        ranges.push(
          Decoration.widget({ widget: new ColorSwatch(match[0]), side: -1 }).range(
            line.from + match.index!,
          ),
        );
      }
    }
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (commentNode.test(node.name)) {
          const from = Math.max(node.from, visible.from),
            to = Math.min(node.to, visible.to);
          const text = state.sliceDoc(from, to);
          let offset = 0;
          for (const line of text.split("\n")) {
            const body = line.trimStart().replace(/^(?:\/\/|\/\*+|#|--|<!--|\*(?!\/))[\t ]*/, "");
            const annotation = /^([!?*])/.exec(body);
            if (annotation)
              mark(
                ranges,
                from + offset,
                from + offset + line.length,
                `cm-readability-${annotation[1] === "!" ? "error" : annotation[1] === "?" ? "info" : "success"}`,
              );
            offset += line.length + 1;
          }
          for (const match of text.matchAll(/\b(TODO|FIXME|BUG|HACK|XXX|NOTE|IMPORTANT)\b:?/g)) {
            const tone = /^(FIXME|BUG|XXX)/.test(match[0])
              ? "error"
              : /^(NOTE)/.test(match[0])
                ? "info"
                : "warning";
            mark(
              ranges,
              from + match.index!,
              from + match.index! + match[0].length,
              `cm-commentAnnotation cm-readability-${tone}`,
            );
          }
          return false;
        }
        if (stream.length === 0 && brackets.has(node.name))
          mark(ranges, node.from, node.to, `cm-rainbowBracket-${bracketDepth(node.node)}`);
      },
    });
  }
  const diagnostics = new Map<number, { severity: Diagnostic["severity"]; messages: string[] }>();
  forEachDiagnostic(state, (diagnostic, from) => {
    const line = state.doc.lineAt(from);
    if (!seen.has(line.number)) return;
    const current = diagnostics.get(line.to);
    if (current) {
      if (current.messages.length < 3) current.messages.push(diagnostic.message);
      if (severityRank[diagnostic.severity] > severityRank[current.severity])
        current.severity = diagnostic.severity;
    } else
      diagnostics.set(line.to, { severity: diagnostic.severity, messages: [diagnostic.message] });
  });
  for (const [pos, diagnostic] of diagnostics) {
    ranges.push(
      Decoration.widget({
        widget: new DiagnosticLabel(diagnostic.messages.join(" · "), diagnostic.severity),
        side: 1,
      }).range(pos),
    );
  }
  return Decoration.set(ranges, true);
}

const readabilityTheme = EditorView.baseTheme({
  "&.cm-readableCodeEditor .cm-content": {
    backgroundImage:
      "var(--ui-code-ruler-line), var(--ui-code-ruler-line), var(--ui-code-ruler-line)",
    backgroundSize: "1px 100%",
    backgroundPosition: "calc(6px + 80ch) 0, calc(6px + 100ch) 0, calc(6px + 120ch) 0",
    backgroundRepeat: "no-repeat",
  },
  ".cm-indentBand": {
    borderInlineStart: "1px solid var(--ui-code-indent-border)",
    boxSizing: "border-box",
    paddingBlock: "0.2em",
  },
  ...Object.fromEntries(
    tones.flatMap((_, i) => [
      [`.cm-indentBand-${i}`, { backgroundColor: `var(--ui-code-indent-${i})` }],
      [`.cm-rainbowBracket-${i}`, { color: `var(--ui-code-bracket-${i}) !important` }],
    ]),
  ),
  ...Object.fromEntries(
    ["error", "warning", "info", "success", "hint"].map((tone) => [
      `.cm-readability-${tone}, .cm-readability-${tone} span, .cm-commentAnnotation.cm-readability-${tone}, .cm-commentAnnotation.cm-readability-${tone} span`,
      { color: `var(--ui-code-${tone}) !important` },
    ]),
  ),
  ".cm-commentAnnotation": {
    backgroundColor: "var(--ui-code-annotation)",
    fontWeight: "700",
    borderRadius: "2px",
  },
  ".cm-colorSwatch": {
    display: "inline-block",
    inlineSize: "0.8em",
    blockSize: "0.8em",
    marginInline: "0.2em",
    border: "1px solid var(--color-stroke)",
    borderRadius: "2px",
    verticalAlign: "baseline",
  },
  ".cm-diagnosticLabel": {
    marginInlineStart: "1.5em",
    fontStyle: "italic",
    fontSize: "0.9em",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  ...Object.fromEntries(
    ["error", "warning", "info", "success"].map((tone) => [
      `.cm-logLine-${tone}`,
      { backgroundColor: `var(--ui-code-log-${tone})` },
    ]),
  ),
});
