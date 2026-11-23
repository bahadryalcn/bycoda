import assert from "node:assert/strict";
import test from "node:test";
import {
  checkRuleIndex,
  engines,
  collectRules,
  parseAstGrepRule,
  renderIndex,
  validateRules,
} from "./rule-index.mjs";

test("every rule in the repository has one definition and a current list entry", () => {
  const result = checkRuleIndex();
  assert.deepEqual(result.errors, []);
  assert.equal(result.stale, false, "run `node scripts/checks/rule-index.mjs --write`");
  const rules = collectRules();
  assert.equal(
    rules.find((rule) => rule.id === "hover-only-reveal").scope,
    "TSX in src/features, src/shared (excluding tests)",
  );
  for (const id of [
    "nested-card",
    "duplicate-feedback-channel",
    "tooltip-repeats-label",
    "inline-help-text",
  ])
    assert.equal(
      rules.find((rule) => rule.id === id).scope,
      "TSX in src/app, src/features, src/shared (excluding tests)",
    );
  assert.equal(
    rules.some((rule) => rule.id === "one-primary-per-view"),
    false,
  );
  for (const id of [
    "spacing-step",
    "arbitrary-spacing",
    "feature-typography",
    "focus-outline-removed",
  ])
    assert.equal(
      rules.find((rule) => rule.id === id).scope,
      "CSS and TSX in src/app and src/features (excluding tests)",
    );
  assert.match(rules.find((rule) => rule.id === "shared-internal-selector").scope, /CSS-module/);
  assert.match(rules.find((rule) => rule.id === "native-title").text, /remove repeated copy/);
  for (const engine of Object.keys(engines))
    assert.ok(
      rules.some((rule) => rule.engine === engine),
      engine,
    );
  // Severity decides the ratchet: "error" rules are invariants, "warn" rules lint debt.
  assert.equal(rules.find((rule) => rule.id === "react/no-danger").engine, "oxlint error");
  assert.equal(rules.find((rule) => rule.id === "react/exhaustive-deps").engine, "oxlint warn");
  // Restricted-API targets banned with the same message collapse into one row.
  const imports = rules.filter((rule) => rule.id === "oxlint/no-restricted-imports");
  assert.deepEqual(imports.find((rule) => rule.targets.includes("framer-motion")).targets, [
    "framer-motion",
    "motion/react",
  ]);
});

test("an ast-grep rule yields its id, scope and unescaped message", () => {
  const rule = parseAstGrepRule(
    [
      "id: ts-demo",
      "language: tsx",
      'message: "Use `helper()` instead of \\"raw\\"."',
      "note: docs/reference/code-invariants.md",
      "files:",
      '  - "src/**"',
      '  - "host/**"',
      "ignores:",
      '  - "**/*.test.ts"',
      "rule:",
      "  pattern: raw($A)",
    ].join("\n"),
    "rules/ts-demo.yml",
  );
  assert.deepEqual(rule, {
    id: "ts-demo",
    engine: "ast-grep (Rust)",
    scope: "src/**, host/**",
    text: 'Use `helper()` instead of "raw".',
    source: "rules/ts-demo.yml",
  });
  assert.throws(() => parseAstGrepRule("language: tsx\n", "rules/broken.yml"), /id and a message/);
});

test("a second definition or a switched-off rule is rejected, and bare tags are escaped", () => {
  const rule = (overrides) => ({
    id: "demo",
    engine: "ast-grep (Rust)",
    scope: "src/**",
    text: "Use <Button> not `<button>`",
    source: "a.yml",
    ...overrides,
  });
  assert.deepEqual(validateRules([rule(), rule()]), []);
  const errors = validateRules([
    rule(),
    rule({ source: "b.json" }),
    rule({ id: "idle", enabled: false }),
  ]);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /demo is defined in a\.yml and in b\.json/);
  assert.match(errors[1], /idle \(a\.yml\) is not switched on/);
  const text = renderIndex([rule()]);
  assert.ok(
    text.includes(
      "### ast-grep (Rust)\n\n- `demo` (`src/**`)\n  - Use \\<Button> not `<button>`\n",
    ),
    text,
  );
});
