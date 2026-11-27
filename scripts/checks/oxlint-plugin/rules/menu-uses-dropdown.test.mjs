import assert from "node:assert/strict";
import test from "node:test";
import rule from "./menu-uses-dropdown.mjs";

const literal = (value) => ({ type: "Literal", value });
const attribute = (name, value) => ({
  type: "JSXAttribute",
  name: { type: "JSXIdentifier", name },
  value: value === undefined ? null : literal(value),
});
const opening = (name, ...attributes) => ({
  type: "JSXOpeningElement",
  name: { type: "JSXIdentifier", name },
  attributes,
});
const el = (name, ...attributes) => ({
  type: "JSXElement",
  openingElement: opening(name, ...attributes),
});

/** Walks a tree of { el, children } like the linter would and returns the reported nodes. */
function run(filename, root) {
  const reports = [];
  const visitors = rule.create({
    cwd: "/repo",
    filename,
    report: ({ node }) => reports.push(node),
  });
  if (!Object.keys(visitors).length) return reports;
  const walk = ({ node, children = [] }) => {
    visitors.JSXElement(node);
    visitors.JSXOpeningElement(node.openingElement);
    children.forEach(walk);
    visitors["JSXElement:exit"](node);
  };
  walk(root);
  return reports;
}

const FILE = "/repo/src/features/a/Tools.tsx";

test("menu-uses-dropdown reports a Popover holding MenuRow once", () => {
  const popover = el("Popover");
  const reports = run(FILE, {
    node: popover,
    children: [{ node: el("MenuRow") }, { node: el("MenuRow") }],
  });
  assert.deepEqual(reports, [popover.openingElement]);
});

test("menu-uses-dropdown reports literal role=menu and role=menuitem", () => {
  const menu = el("div", attribute("role", "menu"));
  const item = el("button", attribute("role", "menuitem"));
  const reports = run(FILE, { node: menu, children: [{ node: item }] });
  assert.equal(reports.length, 2);
});

test("menu-uses-dropdown accepts MenuRow outside Popover, other roles and DropdownMenu", () => {
  assert.deepEqual(run(FILE, { node: el("div"), children: [{ node: el("MenuRow") }] }), []);
  assert.deepEqual(run(FILE, { node: el("div", attribute("role", "option")) }), []);
  assert.deepEqual(
    run(FILE, { node: el("DropdownMenu"), children: [{ node: el("MenuRow") }] }),
    [],
  );
});

test("menu-uses-dropdown ignores MenuRow after the Popover closed", () => {
  const reports = run(FILE, {
    node: el("div"),
    children: [{ node: el("Popover") }, { node: el("MenuRow") }],
  });
  assert.deepEqual(reports, []);
});

test("menu-uses-dropdown skips src/shared/ui and non-tsx files", () => {
  const menu = el("div", attribute("role", "menu"));
  assert.deepEqual(run("/repo/src/shared/ui/DropdownMenu.tsx", { node: menu }), []);
  assert.deepEqual(run("/repo/src/features/a/x.ts", { node: menu }), []);
});
