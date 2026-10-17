import { memo, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import type { HighlightResult } from "@streamdown/code";
import type { BundledLanguage } from "shiki";
import { CodeBlockContainer, CodeBlockHeader } from "streamdown";
import { boundedCode } from "../../files/editor/codeHighlightPlugin";

type Line = HighlightResult["tokens"][number];

const CodeLine = memo(function CodeLine({ tokens, numbered }: { tokens: Line; numbered: boolean }) {
  return (
    <span className={numbered ? "markdown-code-numbered-line" : undefined}>
      {tokens.length && !(tokens.length === 1 && tokens[0].content === "")
        ? tokens.map((token, index) => {
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
    </span>
  );
});

const CodeBody = memo(function CodeBody({
  result,
  lineNumbers,
  startLine,
}: {
  result: HighlightResult;
  lineNumbers: boolean;
  startLine?: number;
}) {
  const lines = useMemo(
    () => new WeakMap<Line, { index: number; numbered: boolean; element: ReactElement }>(),
    [],
  );
  const children = useMemo(
    () =>
      result.tokens.map((tokens, index) => {
        const cached = lines.get(tokens);
        if (cached?.index === index && cached.numbered === lineNumbers) return cached.element;
        const element = <CodeLine key={index} tokens={tokens} numbered={lineNumbers} />;
        lines.set(tokens, { index, numbered: lineNumbers, element });
        return element;
      }),
    [result, lineNumbers, lines],
  );
  return (
    <pre>
      <code style={lineNumbers ? { counterReset: `line ${(startLine ?? 1) - 1}` } : undefined}>
        {children}
      </code>
    </pre>
  );
});

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
  const source = code.replace(/\n$/, "");
  const [highlighted, setHighlighted] = useState<{
    source: string;
    language: string;
    result: HighlightResult;
  }>();
  useEffect(() => {
    let current = true;
    const apply = (result: HighlightResult) => {
      if (current) setHighlighted({ source, language, result });
    };
    const cached = boundedCode.highlight(
      { code: source, language: language as BundledLanguage, themes: boundedCode.getThemes() },
      apply,
    );
    if (cached) apply(cached);
    return () => {
      current = false;
    };
  }, [source, language]);
  const result =
    highlighted?.language === language && source.startsWith(highlighted.source)
      ? highlighted.result
      : undefined;
  const fallbackLines = useMemo(() => source.split("\n"), [source]);
  return (
    <CodeBlockContainer className={className} language={language} isIncomplete={isIncomplete}>
      <CodeBlockHeader language={language} />
      <div data-streamdown="code-block-body" data-language={language}>
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
