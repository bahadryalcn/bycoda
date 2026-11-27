import assert from "node:assert/strict";
import test from "node:test";
import rule from "./transcript-row-trigger.mjs";

const attribute = (name, value) => ({
  type: "JSXAttribute",
  name: { type: "JSXIdentifier", name },
  value,
});
const string = (value) => ({ type: "Literal", value });
const wrapped = (value) => ({ type: "JSXExpressionContainer", expression: string(value) });
const element = (name, ...attributes) => ({
  type: "JSXOpeningElement",
  name: { type: "JSXIdentifier", name },
  attributes,
});

/** Runs the rule over the given opening elements as if parsed from `filename`. */
function run(filename, elements) {
  const reports = [];
  const visitors = rule.create({
    cwd: "/repo",
    filename,
    report: ({ node }) => reports.push(node),
  });
  for (const node of elements) visitors.JSXOpeningElement?.(node);
  return reports;
}

const ui = "/repo/src/features/sessions/ui/AgentTranscriptActivity.tsx";

test("transcript-row-trigger rejects a second trigger on transcript rows", () => {
  const cases = [
    element("Button", attribute("expanded", { type: "JSXExpressionContainer" })),
    element("button", attribute("aria-expanded", { type: "JSXExpressionContainer" })),
    element("InlineAction", attribute("reveal", string("interaction"))),
    element("InlineAction", attribute("reveal", wrapped("interaction"))),
    element("div", attribute("onClick", { type: "JSXExpressionContainer" })),
  ];
  assert.deepEqual(run(ui, cases), cases);
});

test("transcript-row-trigger accepts Disclosure and other elements", () => {
  const reports = run(ui, [
    element("Disclosure", attribute("variant", string("step"))),
    element("Button", attribute("pressed", {})),
    element("InlineAction", attribute("reveal", string("hover"))),
    element("button", attribute("onClick", {})),
    element("div", attribute("className", string("x"))),
  ]);
  assert.deepEqual(reports, []);
});

test("transcript-row-trigger only scans sessions UI files, not tests", () => {
  const cases = [element("Button", attribute("expanded", {}))];
  assert.deepEqual(run("/repo/src/features/chat/ui/X.tsx", cases), []);
  assert.deepEqual(run("/repo/src/features/sessions/ui/X.test.tsx", cases), []);
});
