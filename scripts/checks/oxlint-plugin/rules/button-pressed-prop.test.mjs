import assert from "node:assert/strict";
import test from "node:test";
import rule from "./button-pressed-prop.mjs";

const attribute = (name) => ({ type: "JSXAttribute", name: { type: "JSXIdentifier", name } });
const element = (name, ...attributes) => ({
  type: "JSXOpeningElement",
  name: { type: "JSXIdentifier", name },
  attributes,
});

/** Runs the rule's visitors over the given opening elements and returns the reported nodes. */
function run(filename, elements) {
  const reports = [];
  const visitors = rule.create({
    cwd: "/repo",
    filename,
    report: ({ node }) => reports.push(node),
  });
  if (!Object.keys(visitors).length) return reports;
  for (const node of elements) visitors.JSXOpeningElement(node);
  return reports;
}

test("button-pressed-prop rejects Button with both selected and aria-pressed", () => {
  const both = element("Button", attribute("selected"), attribute("aria-pressed"));
  const reports = run("/repo/src/features/a/Toolbar.tsx", [both]);
  assert.deepEqual(reports, [both]);
});

test("button-pressed-prop accepts pressed, lone selected or aria-pressed and other elements", () => {
  const reports = run("/repo/src/features/a/Toolbar.tsx", [
    element("Button", attribute("pressed")),
    element("Button", attribute("selected")),
    element("Button", attribute("aria-pressed")),
    element("Button.Icon", attribute("selected"), attribute("aria-pressed")),
    element("IconButton", attribute("selected"), attribute("aria-pressed")),
  ]);
  assert.deepEqual(reports, []);
});

test("button-pressed-prop only scans .tsx files under src/", () => {
  const both = element("Button", attribute("selected"), attribute("aria-pressed"));
  assert.deepEqual(run("/repo/src/shared/x.ts", [both]), []);
  assert.deepEqual(run("/repo/host/x.tsx", [both]), []);
});
