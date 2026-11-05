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
  "void tasks.tick();",
  "void tasks.tick().catch(() => {});",
  'const env = { LC_ALL: "C" };',
  'const when = stamp.toLocaleDateString("en");',
  'const text = t("Saved") + "!";',
  "",
].join("\n");

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
  write(root, "src/features/demo/sample.ts", "void tasks.tick();\n");
  assert.deepEqual(
    scanAll(root).map((finding) => [finding.file, finding.rule]),
    [["src/features/demo/sample.ts", "ts-void-promise-without-catch"]],
  );
  writeBaseline(root, { "src/features/demo/sample.ts": { "ts-void-promise-without-catch": 1 } });
  assert.ok(existsSync(join(root, baselineFile)));
  assert.equal(checkInvariants({ root }).success, true);
  write(root, "src/features/demo/sample.ts", "void tasks.tick();\nvoid other.run();\n");
  const result = checkInvariants({ root, files: ["src/features/demo/sample.ts"] });
  assert.equal(result.success, false);
  assert.deepEqual(
    result.regressions.map(({ rule, baseline, count }) => [rule, baseline, count]),
    [["ts-void-promise-without-catch", 1, 2]],
  );
  assert.match(formatRegressions(result.regressions), /other\.run\(\)/);
  assert.match(formatRegressions(result.regressions), /ast-grep-ignore/);
  write(root, "src/features/demo/sample.ts", "void tasks.tick().catch(() => {});\n");
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
