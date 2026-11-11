/**
 * Review signals, not lint errors. Enforced rules live in the rule set
 * (docs/reference/rules.md); an unexplained suppression, for example, is rule bycoda/suppression-has-reason.
 */
import ts from "@typescript/typescript6";

export function reviewQualityPatterns(text, filename) {
  if (!/\.(?:test|spec|e2e)\.[cm]?[jt]sx?$/.test(filename) || !text.includes("setTimeout"))
    return [];
  const findings = [];
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const line = (position) => source.getLineAndCharacterOfPosition(position).line + 1;
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
  return findings;
}
