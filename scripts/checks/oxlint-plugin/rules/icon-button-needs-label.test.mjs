import assert from "node:assert/strict";
import test from "node:test";
import rule from "./icon-button-needs-label.mjs";

const attribute = (name) => ({ type: "JSXAttribute", name: { type: "JSXIdentifier", name } });
const spread = { type: "JSXSpreadAttribute" };
const element = (name, attributes = [], children = []) => ({
  type: "JSXElement",
  openingElement: { type: "JSXOpeningElement", name: { type: "JSXIdentifier", name }, attributes },
  children,
});
const text = (value) => ({ type: "JSXText", value });

/** Runs the rule's visitors over the given elements and returns the reported opening elements. */
function run(filename, elements) {
  const reports = [];
  const visitors = rule.create({
    cwd: "/repo",
    filename,
    report: ({ node }) => reports.push(node),
  });
  if (!Object.keys(visitors).length) return reports;
  for (const node of elements) visitors.JSXElement(node);
  return reports;
}

const file = "/repo/src/features/a/Toolbar.tsx";

test("icon-button-needs-label rejects icon Buttons without text or a name", () => {
  const start = element("Button", [attribute("startIcon")]);
  const only = element("Button", [attribute("iconOnly")], [text("  \n ")]);
  const end = element("Button", [attribute("endIcon")]);
  assert.deepEqual(run(file, [start, only, end]), [
    start.openingElement,
    only.openingElement,
    end.openingElement,
  ]);
});

test("icon-button-needs-label accepts label, aria-label, text children, spreads and other elements", () => {
  const reports = run(file, [
    element("Button", [attribute("iconOnly"), attribute("label")]),
    element("Button", [attribute("startIcon"), attribute("aria-label")]),
    element("Button", [attribute("startIcon")], [text("Save")]),
    element("Button", [attribute("startIcon"), spread]),
    element("Button", [attribute("variant")]),
    element("IconButton", [attribute("iconOnly")]),
  ]);
  assert.deepEqual(reports, []);
});

test("icon-button-needs-label only scans .tsx files under src/", () => {
  const bare = element("Button", [attribute("iconOnly")]);
  assert.deepEqual(run("/repo/src/shared/x.ts", [bare]), []);
  assert.deepEqual(run("/repo/host/x.tsx", [bare]), []);
});
