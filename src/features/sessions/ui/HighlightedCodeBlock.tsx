import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import type { HighlightResult } from "@streamdown/code";
import type { BundledLanguage } from "shiki";
import { CodeBlockContainer, CodeBlockHeader } from "streamdown";
import { elapsedSince, monotonicNow } from "../../../shared/lib/time/timestamps";
import { useCodeHighlightPlugin } from "../../files/public/useCodeHighlightPlugin";

type Line = HighlightResult["tokens"][number];
// Keep a cold, large fence from committing thousands of styled spans in a single frame.
const TOKENS_PER_FRAME = 512;

const TYPING_PAUSE_MS = 180;
const MAX_PAINT_WAIT_MS = 1800;
// All fences in a document share its editor input observer.
const editorActivity = new WeakMap<Document, { lastEdit: number }>();

function observeEditorInput(doc: Document) {
  let activity = editorActivity.get(doc);
  if (!activity) {
    const record = { lastEdit: -Infinity };
    doc.addEventListener(
      "input",
      (event) => {
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          (target.tagName === "TEXTAREA" || target.isContentEditable)
        ) {
          record.lastEdit = monotonicNow();
        }
      },
      { capture: true, passive: true },
    );
    editorActivity.set(doc, record);
    activity = record;
  }
  return activity;
}

/** Leave the native selection's text nodes in place until the user finishes copying. */
function whenSelectionReleased(element: HTMLElement | null, apply: () => void) {
  const document = element?.ownerDocument;
  const selecting = () => {
    const selection = document?.getSelection();
    return (
      selection &&
      !selection.isCollapsed &&
      (element?.contains(selection.anchorNode) || element?.contains(selection.focusNode))
    );
  };
  if (!document || !selecting()) {
    apply();
    return;
  }
  const release = () => {
    if (selecting()) return;
    document.removeEventListener("selectionchange", release);
    apply();
  };
  document.addEventListener("selectionchange", release);
  return () => document.removeEventListener("selectionchange", release);
}

/** Give typing the next paint and keep native code selections intact. Continuous typing still allows progress. */
function whenCodeMayChange(element: HTMLElement | null, large: boolean, apply: () => void) {
  if (!element || !large) return whenSelectionReleased(element, apply);
  const activity = observeEditorInput(element.ownerDocument);
  const started = monotonicNow();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let release: (() => void) | undefined;
  const attempt = () => {
    const now = monotonicNow();
    const remaining = Math.min(
      TYPING_PAUSE_MS - elapsedSince(activity.lastEdit, now),
      MAX_PAINT_WAIT_MS - elapsedSince(started, now),
    );
    if (remaining > 0) {
      timer = setTimeout(() => {
        frame = requestAnimationFrame(attempt);
      }, remaining);
    } else {
      release = whenSelectionReleased(element, apply);
    }
  };
  attempt();
  return () => {
    clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    release?.();
  };
}

function tokenCount(lines: Line[]) {
  return lines.reduce((sum, line) => sum + line.length, 0);
}

function CodeLine({ tokens, numbered, count }: { tokens: Line; numbered: boolean; count: number }) {
  return (
    <span className={numbered ? "markdown-code-numbered-line" : undefined}>
      {tokens.length && !(tokens.length === 1 && tokens[0].content === "")
        ? (count === tokens.length ? tokens : tokens.slice(0, count)).map((token, index) => {
            const style: Record<string, string> = { ...token.htmlStyle };
            if (token.color) style["--sdm-c"] = token.color;
            if (token.bgColor) style["--sdm-tbg"] = token.bgColor;
            if (style.color) {
              style["--sdm-c"] = style.color;
              delete style.color;
            }
            if (style["background-color"]) {
              style["--sdm-tbg"] = style["background-color"];
              delete style["background-color"];
            }
            return (
              <span
                key={index}
                {...token.htmlAttrs}
                className="markdown-code-token"
                style={style as CSSProperties}
              >
                {token.content}
              </span>
            );
          })
        : "\n"}
      {count < tokens.length &&
        tokens
          .slice(count)
          .map((token) => token.content)
          .join("")}
    </span>
  );
}

// One element per (tokens, index, numbered); sharing the cache across blocks yields the same elements.
const codeLines = new WeakMap<Line, { index: number; numbered: boolean; element: ReactElement }>();

function renderLines(lines: Line[], numbered: boolean, budget: number) {
  const children: ReactElement[] = [];
  for (const [index, tokens] of lines.entries()) {
    const count = Math.min(budget, tokens.length);
    budget -= count;
    const cached = codeLines.get(tokens);
    if (count === tokens.length && cached?.index === index && cached.numbered === numbered) {
      children.push(cached.element);
      continue;
    }
    const element = <CodeLine key={index} tokens={tokens} numbered={numbered} count={count} />;
    if (count === tokens.length) codeLines.set(tokens, { index, numbered, element });
    children.push(element);
  }
  return children;
}

function CodeBody({
  result,
  lineNumbers,
  startLine,
}: {
  result: HighlightResult;
  lineNumbers: boolean;
  startLine?: number;
}) {
  const [progress, setProgress] = useState({ result, count: TOKENS_PER_FRAME });
  const pre = useRef<HTMLPreElement>(null);
  const budget = progress.result === result ? progress.count : TOKENS_PER_FRAME;
  const total = tokenCount(result.tokens);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- schedules the next batch of colored tokens on a browser frame and waits for native selection to finish
  useEffect(() => {
    if (budget >= total) return;
    let cancel: (() => void) | undefined;
    const frame = requestAnimationFrame(() => {
      cancel = whenCodeMayChange(pre.current, true, () =>
        setProgress({ result, count: budget + TOKENS_PER_FRAME }),
      );
    });
    return () => {
      cancelAnimationFrame(frame);
      cancel?.();
    };
  }, [budget, total, result]);
  const children = renderLines(result.tokens, lineNumbers, budget);
  return (
    <pre ref={pre}>
      <code style={lineNumbers ? { counterReset: `line ${(startLine ?? 1) - 1}` } : undefined}>
        {children}
      </code>
    </pre>
  );
}

export function HighlightedCodeBlock({
  code,
  language,
  isIncomplete,
  lineNumbers,
  startLine,
  className,
}: {
  code: string;
  language: string;
  isIncomplete: boolean;
  lineNumbers: boolean;
  startLine?: number;
  className?: string;
}) {
  // Match Streamdown's removal of the closing-fence newline without dropping
  // meaningful empty lines in the source.
  const source = code.endsWith("\n") ? code.slice(0, -1) : code;
  const settledSource = isIncomplete ? null : source;
  const boundedCode = useCodeHighlightPlugin();
  const body = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState<{
    plugin: typeof boundedCode;
    source: string;
    language: string;
    result: HighlightResult;
  }>();
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- subscribes the settled source to the highlighter and discards superseded responses
  useEffect(() => {
    const grammar = language as BundledLanguage;
    if (body.current) observeEditorInput(body.current.ownerDocument);
    if (settledSource === null) {
      // Load the grammar once, while the reply is arriving. Partial source never reaches the worker.
      if (typeof Worker !== "undefined" && boundedCode.supportsLanguage(grammar))
        boundedCode.highlight({
          code: "",
          language: grammar,
          themes: boundedCode.getThemes(),
          isIncomplete: false,
        });
      return;
    }
    let current = true;
    let cancel: (() => void) | undefined;
    const apply = (result: HighlightResult) => {
      if (current)
        cancel = whenCodeMayChange(body.current, tokenCount(result.tokens) > TOKENS_PER_FRAME, () =>
          setHighlighted({ source: settledSource, language, result, plugin: boundedCode }),
        );
    };
    const cached = boundedCode.highlight(
      {
        code: settledSource,
        language: grammar,
        isIncomplete: false,
        themes: boundedCode.getThemes(),
      },
      apply,
    );
    if (cached) apply(cached);
    return () => {
      current = false;
      cancel?.();
    };
  }, [settledSource, language, boundedCode]);
  const result =
    !isIncomplete &&
    highlighted?.language === language &&
    source === highlighted.source &&
    highlighted.plugin === boundedCode
      ? highlighted.result
      : undefined;
  // Keep copying, line numbers and selection available while the fence grows.
  const fallbackLines = result ? [] : source.split("\n");
  return (
    <CodeBlockContainer className={className} language={language} isIncomplete={isIncomplete}>
      <CodeBlockHeader language={language} />
      <div ref={body} data-streamdown="code-block-body" data-language={language}>
        {result ? (
          <CodeBody result={result} lineNumbers={lineNumbers} startLine={startLine} />
        ) : (
          <pre>
            <code
              style={lineNumbers ? { counterReset: `line ${(startLine ?? 1) - 1}` } : undefined}
            >
              {fallbackLines.map((line, index) => (
                <span
                  key={index}
                  className={lineNumbers ? "markdown-code-numbered-line" : undefined}
                >
                  {line || "\n"}
                </span>
              ))}
            </code>
          </pre>
        )}
      </div>
    </CodeBlockContainer>
  );
}
