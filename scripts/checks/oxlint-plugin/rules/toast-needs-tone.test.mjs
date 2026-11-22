import assert from "node:assert/strict";
import test from "node:test";
import rule from "./toast-needs-tone.mjs";

const id = (name) => ({ type: "Identifier", name });
const prop = (name) => ({ type: "Property", computed: false, key: id(name), value: id("x") });
const spread = { type: "SpreadElement" };
const show = (object, properties) => ({
  type: "CallExpression",
  callee: { type: "MemberExpression", computed: false, object, property: id("show") },
  arguments: [{ type: "ObjectExpression", properties }],
});
const attribute = (name) => ({ type: "JSXAttribute", name: { type: "JSXIdentifier", name } });
const opening = (name, attributes = []) => ({
  type: "JSXOpeningElement",
  name: { type: "JSXIdentifier", name },
  attributes,
});

function run(filename, nodes) {
  const reports = [];
  const visitors = rule.create({
    cwd: "/repo",
    filename,
    report: ({ node }) => reports.push(node),
  });
  for (const node of nodes) visitors[node.type]?.(node);
  return reports;
}

const file = "/repo/src/features/a/useSave.ts";
const toast = id("toast");

test("toast-needs-tone flags toast.show without a tone", () => {
  const bare = show(toast, [prop("message")]);
  const nested = show({ type: "MemberExpression", computed: false, object: id("api"), property: id("toast") }, [
    prop("title"),
  ]);
  assert.deepEqual(run(file, [bare, nested]), [bare.arguments[0], nested.arguments[0]]);
});

test("toast-needs-tone accepts a tone, spreads and other show calls", () => {
  const reports = run(file, [
    show(toast, [prop("message"), prop("tone")]),
    show(toast, [spread]),
    show(id("dialog"), [prop("message")]),
  ]);
  assert.deepEqual(reports, []);
});

test("toast-needs-tone flags a <Toast> element without tone", () => {
  const bare = opening("Toast", [attribute("message")]);
  const reports = run("/repo/src/features/a/View.tsx", [
    bare,
    opening("Toast", [attribute("tone")]),
    opening("Toast", [{ type: "JSXSpreadAttribute" }]),
    opening("Alert", []),
  ]);
  assert.deepEqual(reports, [bare]);
});

test("toast-needs-tone skips the shared toast files and tests", () => {
  const bare = show(toast, [prop("message")]);
  assert.deepEqual(run("/repo/src/shared/ui/ToastRegion.tsx", [bare]), []);
  assert.deepEqual(run("/repo/src/features/a/x.test.ts", [bare]), []);
  assert.deepEqual(run("/repo/host/x.ts", [bare]), []);
});
