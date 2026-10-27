/** Review signals, not lint errors. Boundary rules stay in the existing boundary checkers. */
import ts from "@typescript/typescript6";

export function reviewQualityPatterns(text, filename) {
  const hasSuppression =
    /\b(?:oxlint|eslint)-disable(?:-next-line|-line)?\b|@ts-(?:ignore|expect-error)\b/.test(text);
  const hasTestTimer =
    /\.(?:test|spec|e2e)\.[cm]?[jt]sx?$/.test(filename) && text.includes("setTimeout");
  if (!hasSuppression && !hasTestTimer) return [];
  const findings = [];
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const line = (position) => source.getLineAndCharacterOfPosition(position).line + 1;
  const literalEnds = new Map();
  const collectLiterals = (node) => {
    if (
      ts.isStringLiteralLike(node) ||
      [
        ts.SyntaxKind.RegularExpressionLiteral,
        ts.SyntaxKind.TemplateHead,
        ts.SyntaxKind.TemplateMiddle,
        ts.SyntaxKind.TemplateTail,
        ts.SyntaxKind.JsxText,
      ].includes(node.kind)
    )
      literalEnds.set(node.getStart(source), node.end);
    ts.forEachChild(node, collectLiterals);
  };
  collectLiterals(source);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, text);
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const literalEnd = literalEnds.get(scanner.getTokenPos());
    // Recovered/missing syntax can have zero-width literal nodes. Never rewind a scanner.
    if (literalEnd !== undefined && literalEnd > scanner.getTokenPos()) {
      scanner.setTextPos(literalEnd);
      continue;
    }
    if (
      ![ts.SyntaxKind.SingleLineCommentTrivia, ts.SyntaxKind.MultiLineCommentTrivia].includes(token)
    )
      continue;
    const comment = scanner.getTokenText();
    if (
      /\b(?:oxlint|eslint)-disable(?:-next-line|-line)?\b|@ts-(?:ignore|expect-error)\b/.test(
        comment,
      ) &&
      !/--\s*\S/.test(comment)
    )
      findings.push({
        file: filename,
        line: line(scanner.getTokenPos()),
        rule: "suppression-reason-review",
        detail:
          "No inline '-- reason' was found. Check nearby context before adding a narrow rationale or removing the suppression.",
      });
  }
  if (hasTestTimer) {
    const visit = (node) => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Promise"
      ) {
        const callback = node.arguments?.[0];
        const parameter =
          callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
            ? callback.parameters[0]?.name
            : undefined;
        if (parameter && ts.isIdentifier(parameter)) {
          const resolves = (child) =>
            (ts.isIdentifier(child) && child.text === parameter.text) ||
            ts.forEachChild(child, resolves);
          let timer = false;
          const detect = (child) => {
            if (
              ts.isCallExpression(child) &&
              ts.isIdentifier(child.expression) &&
              child.expression.text === "setTimeout" &&
              child.arguments[0] &&
              resolves(child.arguments[0])
            )
              timer = true;
            ts.forEachChild(child, detect);
          };
          detect(callback);
          if (timer)
            findings.push({
              file: filename,
              line: line(node.getStart(source)),
              rule: "timer-promise-review",
              detail:
                "Timer-backed Promise in a test: prefer an event/queue/receipt for completion, or a controlled clock for actual timer behavior. This signal alone does not establish flakiness.",
            });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return findings;
}
