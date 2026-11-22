import assert from "node:assert/strict";
import test from "node:test";
import rule from "./translation-slot-names.mjs";

const literal = (value) => ({ type: "Literal", value });
const call = (name, ...args) => ({
  type: "CallExpression",
  optional: false,
  callee: { type: "Identifier", name },
  arguments: args,
});

/** Runs the rule's visitors over the given nodes and returns the reported nodes. */
function run(filename, nodes) {
  const reports = [];
  const visitors = rule.create({
    cwd: "/repo",
    filename,
    report: ({ node }) => reports.push(node),
  });
  if (!Object.keys(visitors).length) return reports;
  for (const node of nodes) visitors.CallExpression(node);
  return reports;
}

test("translation-slot-names rejects named placeholders in t() and translateAt()", () => {
  const add = literal("Add {name}");
  const saved = {
    type: "TemplateLiteral",
    expressions: [],
    quasis: [{ value: { cooked: "Saved {text}" } }],
  };
  const reports = run("/repo/src/features/a/Dialog.tsx", [
    call("t", add, { type: "ObjectExpression", properties: [] }),
    call("translateAt", { type: "Identifier", name: "locale" }, saved),
  ]);
  assert.deepEqual(reports, [add, saved]);
});

test("translation-slot-names accepts positional slots, plain text and non-translation calls", () => {
  const reports = run("/repo/src/features/a/Dialog.tsx", [
    call("t", literal("Add {p0}")),
    call("t", literal("Hide {p0} of {p12}")),
    call("t", literal("Literal {} braces")),
    call("t", { type: "Identifier", name: "message" }),
    call("format", literal("Add {name}")),
    call("translateAt", { type: "Identifier", name: "locale" }, { type: "Identifier", name: "m" }),
  ]);
  assert.deepEqual(reports, []);
});

test("translation-slot-names skips files outside src/ and test files", () => {
  const nodes = [call("t", literal("Add {name}"))];
  assert.deepEqual(run("/repo/host/x.ts", nodes), []);
  assert.deepEqual(run("/repo/src/features/a/x.test.tsx", nodes), []);
});
