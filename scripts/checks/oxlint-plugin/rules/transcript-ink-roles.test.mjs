import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import rule from "./transcript-ink-roles.mjs";

const cwd = process.cwd();
const lit = (value) => ({ type: "Literal", value });
const tpl = (raw) => ({ type: "TemplateElement", value: { raw, cooked: raw } });
const prop = (name, value) => ({
  type: "Property",
  key: { type: "Identifier", name },
  value,
  computed: false,
});

/** Runs the rule on `nodes` as if they were parsed from `file`; returns the reported nodes. */
function run(file, nodes) {
  const reports = [];
  const visitors = rule.create({
    cwd,
    filename: join(cwd, file),
    report: ({ node }) => reports.push(node),
  });
  for (const node of nodes) visitors[node.type]?.(node);
  return reports;
}

const ui = "src/features/sessions/ui/AgentTranscriptActivity.tsx";

test("transcript-ink-roles reports every full-ink text color spelling", () => {
  for (const cls of [
    "text-(--color-content)",
    "text-content",
    "font-mono text-(--color-content) px-1",
    "text-[var(--color-content)]",
    "text-[color:var(--color-content)]",
    "hover:text-(--color-content)",
  ]) {
    const nodes = [lit(cls)];
    assert.equal(run(ui, nodes).length, 1, cls);
  }
  assert.equal(run(ui, [tpl("px-1 text-(--color-content) ")]).length, 1);
  assert.equal(run(ui, [prop("color", lit("var(--color-content)"))]).length, 1);
  const templateStyle = {
    type: "TemplateLiteral",
    quasis: [tpl("var(--color-content)")],
    expressions: [],
  };
  assert.equal(run(ui, [prop("color", templateStyle)]).length, 1);
});

test("transcript-ink-roles accepts the chrome roles and other properties", () => {
  for (const cls of [
    "text-(--ui-text-secondary)",
    "text-(--ui-text-muted)",
    "text-content-strong",
    "bg-(--color-content)",
    "border-(--color-content)",
    "text-ui-secondary",
  ]) {
    assert.equal(run(ui, [lit(cls)]).length, 0, cls);
  }
  assert.equal(run(ui, [prop("color", lit("var(--ui-text-secondary)"))]).length, 0);
  assert.equal(run(ui, [prop("background", lit("var(--color-content)"))]).length, 0);
  assert.equal(run(ui, [prop("color", { type: "Identifier", name: "x" })]).length, 0);
});

test("transcript-ink-roles applies only to transcript UI files, not tests", () => {
  const nodes = [lit("text-(--color-content)")];
  assert.equal(run("src/features/chat/ui/Other.tsx", nodes).length, 0);
  assert.equal(run("src/features/sessions/model/x.ts", nodes).length, 0);
  assert.equal(run("src/features/sessions/ui/AgentTranscript.test.tsx", nodes).length, 0);
});
