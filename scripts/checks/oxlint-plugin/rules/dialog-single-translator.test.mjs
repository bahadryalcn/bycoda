import assert from "node:assert/strict";
import test from "node:test";
import rule from "./dialog-single-translator.mjs";

const str = (value) => ({ type: "Literal", value });
const importT = (source) => ({
  type: "ImportDeclaration",
  source: str(source),
  specifiers: [{ type: "ImportSpecifier", local: { name: "t" } }],
});
const prop = (name) => ({ type: "Property", computed: false, key: { name } });
const call = (name, ...properties) => ({
  type: "CallExpression",
  callee: { type: "Identifier", name },
  arguments: [{ type: "ObjectExpression", properties }],
});

function run(filename, imports, calls) {
  const reports = [];
  const visitors = rule.create({ cwd: "/repo", filename, report: ({ node }) => reports.push(node) });
  if (!Object.keys(visitors).length) return reports;
  for (const node of imports) visitors.ImportDeclaration(node);
  for (const node of calls) visitors.CallExpression(node);
  return reports;
}

test("dialog-single-translator rejects a Git-translated confirmInApp without cancelLabel", () => {
  const bad = call("confirmInApp", prop("title"));
  const reports = run("/repo/src/features/source-control/model/x.ts", [importT("../../../shared/i18n/git")], [bad]);
  assert.deepEqual(reports, [bad]);
});

test("dialog-single-translator accepts cancelLabel and non-Git translators", () => {
  const git = [importT("../../../shared/i18n/git")];
  assert.deepEqual(
    run("/repo/src/features/a/x.ts", git, [call("confirmInApp", prop("title"), prop("cancelLabel"))]),
    [],
  );
  assert.deepEqual(
    run("/repo/src/features/a/x.ts", [importT("../../../shared/i18n")], [call("confirmInApp", prop("title"))]),
    [],
  );
});

test("dialog-single-translator rejects interface-worded callers of the Git confirmations", () => {
  const bad = call("confirmGitAction", prop("title"));
  const ui = [importT("../../../shared/i18n")];
  assert.deepEqual(run("/repo/src/features/skills/ui/P.tsx", ui, [bad]), [bad]);
  assert.deepEqual(run("/repo/src/features/skills/ui/P.tsx", [importT("../i18n/git")], [bad]), []);
});
