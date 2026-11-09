import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  astGrepConfig,
  baselineFile,
  checkInvariants,
  formatRegressions,
  oxlintConfig,
  parseOxlintOutput,
  scanAll,
  writeBaseline,
} from "./check-invariants.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** A throwaway repository with the real rule set, configs and installed tools. */
function fixtureRoot(t) {
  // Exercise direct process invocation with spaces in the working directory.
  const root = mkdtempSync(join(tmpdir(), "bycoda invariants-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(repoRoot, dirname(astGrepConfig)), join(root, dirname(astGrepConfig)), {
    recursive: true,
  });
  cpSync(join(repoRoot, oxlintConfig), join(root, oxlintConfig));
  mkdirSync(join(root, "scripts", "checks"), { recursive: true });
  cpSync(
    join(repoRoot, "scripts", "checks", "privacy-writer-exceptions.json"),
    join(root, "scripts", "checks", "privacy-writer-exceptions.json"),
  );
  symlinkSync(
    join(repoRoot, "node_modules"),
    join(root, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  return root;
}

const write = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};

const tsFixture = [
  'import { listen } from "@tauri-apps/api/event";',
  "const iso = new Date(value).toISOString();",
  'const label = title.slice(0, 40) + "…";',
  'const env = { LC_ALL: "C" };',
  'const when = stamp.toLocaleDateString("en");',
  'const text = t("Saved") + "!";',
  "",
].join("\n");

test("K-FORMAT rejects feature and app formatter definitions and Intl construction", (t) => {
  const root = fixtureRoot(t);
  const rejected = [
    "function formatBytes(value: number) { return String(value); }",
    "export function formatFileSize(value: number) { return String(value); }",
    "async function formatRelativeTimeLabel() { return ''; }",
    "function formatRelative() { return ''; }",
    "function formatDuration() { return ''; }",
    "function formatElapsed() { return ''; }",
    "function formatDate() { return ''; }",
    "function formatCompactCount() { return ''; }",
    "const formatBytes = (value: number) => String(value);",
    "const formatDuration = function(value: number) { return String(value); };",
    "const helpers = { formatElapsed() { return ''; } };",
    "class Labels { formatDate() { return ''; } }",
    "const helpers = { formatCompactCount: () => '' };",
    "const value = new Intl.RelativeTimeFormat('en');",
    "const value = new Intl.NumberFormat('en');",
    "const value = new Intl.DateTimeFormat('en');",
    "const value = new Intl.RelativeTimeFormat;",
    "const value = new Intl.NumberFormat;",
    "const value = new Intl.DateTimeFormat;",
  ];
  for (const [index, source] of rejected.entries()) {
    write(root, `src/features/demo/reject-${index}.tsx`, source);
  }
  write(root, "src/app/reject.ts", "function formatDateLabel() { return ''; }");
  const findings = scanAll(root).filter(({ rule }) => rule === "ts-feature-local-format");
  assert.equal(findings.length, rejected.length + 1);
  for (const [index] of rejected.entries()) {
    assert.equal(findings.filter(({ file }) => file.endsWith(`reject-${index}.tsx`)).length, 1);
  }
});

test("K-FORMAT accepts shared imports, re-exports, calls and non-formatter functions", (t) => {
  const root = fixtureRoot(t);
  write(
    root,
    "src/features/demo/accepted.ts",
    [
      'import { formatBytes } from "../../../shared/i18n/format";',
      'export { formatElapsed } from "../../../shared/i18n/format";',
      "const formatCompact = formatBytes;",
      "const label = formatBytes(1024);",
      "function reformatDate() { return ''; }",
      "function formatModel() { return ''; }",
      "const compare = new Intl.Collator();",
    ].join("\n"),
  );
  for (const file of [
    "src/shared/i18n/format.ts",
    "host/demo/format.ts",
    "src/features/demo/format.test.ts",
  ]) {
    write(root, file, "function formatBytes() {}\nconst format = new Intl.NumberFormat();");
  }
  assert.deepEqual(
    scanAll(root).filter(({ rule }) => rule === "ts-feature-local-format"),
    [],
  );
});

const rustFixture = [
  "fn serve(listener: &std::net::TcpListener) {",
  "    match listener.accept() {",
  "        Ok((socket, _)) => handle(socket),",
  "        Err(_) => {}",
  "    }",
  "}",
  "fn save(next: &std::path::Path, file: &std::path::Path) -> std::io::Result<()> {",
  '    std::fs::write(next, b"x")?;',
  "    std::fs::rename(next, file)",
  "}",
  "fn read<R: std::io::Read>(r: R) { for _ in std::io::BufReader::new(r).lines() {} }",
  "fn run(mut cmd: std::process::Command) { let _ = cmd.output(); }",
  'fn notify(app: &tauri::AppHandle) { let _ = app.emit("x", ()); }',
  "",
].join("\n");

test("the rule set flags each defect class once and names its rule", (t) => {
  const root = fixtureRoot(t);
  write(root, "src/features/demo/sample.ts", tsFixture);
  write(root, "src-tauri/src/sample.rs", rustFixture);
  write(
    root,
    "host/demo/sample.ts",
    ["void tasks.tick();", "void tasks.tick().catch(() => {});", ""].join("\n"),
  );
  const findings = scanAll(root);
  const rules = findings.map((finding) => finding.rule).sort();
  assert.deepEqual(rules, [
    "oxlint/no-restricted-imports",
    "rust-accept-inherits-nonblocking",
    "rust-bufreader-lines-on-stream",
    "rust-command-output-without-timeout",
    "rust-emit-broadcast",
    "rust-rename-without-fsync",
    "ts-date-toisostring-unguarded",
    "ts-i18n-concat",
    "ts-lc-all-c",
    "ts-locale-format-outside-shared",
    "ts-text-truncate-utf16",
    "ts-void-promise-without-catch",
  ]);
  for (const finding of findings) {
    assert.ok(finding.message.length > 20, `${finding.rule} explains the alternative`);
    assert.ok(finding.line > 0);
  }
});

test("shared helpers and tests are exempt, and only counts above the baseline fail", (t) => {
  const root = fixtureRoot(t);
  write(
    root,
    "src/shared/lib/time/timestamps.ts",
    "export const iso = new Date(v).toISOString();\n",
  );
  write(root, "src/features/demo/sample.test.ts", tsFixture);
  write(root, "host/demo/sample.ts", "void tasks.tick();\n");
  assert.deepEqual(
    scanAll(root).map((finding) => [finding.file, finding.rule]),
    [["host/demo/sample.ts", "ts-void-promise-without-catch"]],
  );
  writeBaseline(root, { "host/demo/sample.ts": { "ts-void-promise-without-catch": 1 } });
  assert.ok(existsSync(join(root, baselineFile)));
  assert.equal(checkInvariants({ root }).success, true);
  write(root, "host/demo/sample.ts", "void tasks.tick();\nvoid other.run();\n");
  const result = checkInvariants({ root, files: ["host/demo/sample.ts"] });
  assert.equal(result.success, false);
  assert.deepEqual(
    result.regressions.map(({ rule, baseline, count }) => [rule, baseline, count]),
    [["ts-void-promise-without-catch", 1, 2]],
  );
  assert.match(formatRegressions(result.regressions), /other\.run\(\)/);
  assert.match(formatRegressions(result.regressions), /ast-grep-ignore/);
  write(root, "host/demo/sample.ts", "void tasks.tick().catch(() => {});\n");
  assert.equal(checkInvariants({ root }).improvements.length, 1);
});

test("oxlint tool diagnostics and malformed output fail with useful detail", () => {
  const global = { message: "Failed to open file: invalid UTF-8", severity: "error", labels: [] };
  assert.throws(
    () => parseOxlintOutput(JSON.stringify({ diagnostics: [global] }), 1),
    /Failed to open file: invalid UTF-8/,
  );
  assert.throws(() => parseOxlintOutput("{", 1), /invalid JSON/);
  assert.throws(() => parseOxlintOutput("{}", 1), /missing diagnostics array/);
  assert.throws(() => parseOxlintOutput('{"diagnostics":[]}', 1), /without diagnostics/);
  assert.throws(
    () => parseOxlintOutput('{"diagnostics":[{"filename":"x.ts"}]}', 1),
    /tool diagnostic/,
  );
  assert.deepEqual(
    parseOxlintOutput(
      JSON.stringify({
        diagnostics: [{ filename: "src\\x.ts", code: "eslint(no-test)", message: "finding" }],
      }),
      1,
    ),
    [{ file: "src/x.ts", rule: "oxlint/no-test", line: 0, text: "finding", message: "finding" }],
  );
});

test("privacy writer violations fail the invariant pipeline even with an empty baseline", (t) => {
  const root = fixtureRoot(t);
  write(root, "src/features/demo/privacy.ts", "setProjectGroupAssignment('/private', null);\n");
  writeBaseline(root, {});
  const result = checkInvariants({ root });
  assert.equal(result.success, false);
  assert.ok(result.regressions.some((item) => item.rule === "privacy-writer-outside-fence"));
});

const scanRule = (root, rule) => scanAll(root).filter((finding) => finding.rule === rule);

test("K-ASYNC applies to the Host and packages, and a finally alone does not handle a rejection", (t) => {
  const root = fixtureRoot(t);
  write(root, "host/demo/rejected.ts", "void p.finally(g);\nvoid p.then(a).finally(g);\n");
  write(
    root,
    "host/demo/accepted.ts",
    [
      "void p.catch(f).finally(g);",
      "void p.finally(g).catch(f);",
      "void p.then(a, b);",
      "void p.then(a, b).finally(g);",
    ].join("\n"),
  );
  write(root, "packages/demo/src/rejected.ts", "void p.finally(g);\n");
  // The renderer only logs an unhandled rejection, so the rule does not reach it.
  write(root, "src/features/demo/renderer.ts", "void p.finally(g);\nvoid tasks.tick();\n");
  assert.deepEqual(
    scanRule(root, "ts-void-promise-without-catch").map(({ file, line }) => [file, line]),
    [
      ["host/demo/rejected.ts", 1],
      ["host/demo/rejected.ts", 2],
      ["packages/demo/src/rejected.ts", 1],
    ],
  );
});

test("K-SUPPRESS requires a reason in the same comment and ignores prose", (t) => {
  const root = fixtureRoot(t);
  write(
    root,
    "src/features/demo/rejected.ts",
    [
      "// eslint-disable-next-line react-hooks/exhaustive-deps",
      "// oxlint-disable-next-line no-console",
      "// ast-grep-ignore: ts-i18n-concat",
      "// @ts-expect-error",
      "// @ts-ignore",
      "/* eslint-disable no-console */",
      "const x = 1; // eslint-disable-line no-console",
    ].join("\n"),
  );
  write(
    root,
    "host/demo/accepted.ts",
    [
      "// oxlint-disable-next-line no-console -- startup banner",
      "// ast-grep-ignore: ts-i18n-concat -- label is not user text",
      "// @ts-expect-error -- upstream typing gap",
      "/* eslint-disable no-console -- generated file */",
      "// Prefer a typed guard over an eslint-disable comment.",
      "// see @ts-ignore in the migration notes",
      'const text = "eslint-disable";',
    ].join("\n"),
  );
  write(root, "src/features/demo/rejected.test.ts", "// @ts-ignore\n");
  assert.deepEqual(
    scanRule(root, "ts-suppression-without-reason").map(({ file, line }) => [file, line]),
    [1, 2, 3, 4, 5, 6, 7].map((line) => ["src/features/demo/rejected.ts", line]),
  );
});

test("K-CLOCK covers Host scheduler, budget and watchdog modules by name", (t) => {
  const root = fixtureRoot(t);
  const source = "const started = Date.now();\n";
  for (const file of [
    "host/demo/job-scheduler.ts",
    "host/demo/run-budget.ts",
    "host/demo/turn-watchdog.ts",
  ]) {
    write(root, file, source);
  }
  write(root, "host/demo/plain.ts", source);
  assert.deepEqual(
    scanRule(root, "oxlint/no-restricted-properties")
      .map(({ file }) => file)
      .sort(),
    ["host/demo/job-scheduler.ts", "host/demo/run-budget.ts", "host/demo/turn-watchdog.ts"],
  );
});
