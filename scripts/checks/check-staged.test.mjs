import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { checkStaged, stagedBlobs } from "./check-staged.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "bycoda-staged-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "-q");
  return { root, git };
}
test("reads the index version and never rewrites a partially staged working file", (t) => {
  const { root, git } = fixture(t);
  writeFileSync(join(root, "file.ts"), "export const value = 1;\n");
  git("add", "file.ts");
  writeFileSync(join(root, "file.ts"), "owner's unstaged draft\n");
  const indexBefore = git("write-tree");
  const seen = [];
  const report = checkStaged({
    root,
    runTool(name, args, input) {
      seen.push({ name, input });
      return { status: 0, stdout: name === "oxfmt" ? input : "", stderr: "" };
    },
  });
  assert.equal(report.success, true);
  assert.equal(seen[0].input, "export const value = 1;\n");
  assert.equal(readFileSync(join(root, "file.ts"), "utf8"), "owner's unstaged draft\n");
  assert.equal(git("write-tree"), indexBefore);
});
test("formatter changes and lint failures remain honest failures without staging", (t) => {
  const { root, git } = fixture(t);
  writeFileSync(join(root, "file.ts"), "const value=1\n");
  git("add", "file.ts");
  assert.throws(
    () => checkStaged({ root, runTool: () => ({ status: 0, stdout: "const value = 1;\n" }) }),
    /Format the staged/,
  );
  assert.throws(
    () =>
      checkStaged({
        root,
        runTool: (name, args, input) => ({
          status: name === "oxfmt" ? 0 : 1,
          stdout: input,
          stderr: "fixture lint failure",
        }),
      }),
    /Staged lint failed/,
  );
  assert.equal(stagedBlobs(root)[0].text, "const value=1\n");
});
