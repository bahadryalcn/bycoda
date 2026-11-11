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
