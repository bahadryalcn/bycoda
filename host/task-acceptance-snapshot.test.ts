import { afterEach, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { acceptanceOutputFingerprint } from "./task-acceptance-snapshot";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), "acceptance-output-snapshot-"));
  folders.push(cwd);
  writeFileSync(join(cwd, ".gitignore"), "/temp/\n");
  return cwd;
}
function output(cwd: string, path: string, content = "verified output") {
  const file = join(cwd, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

it("detects changes in declared ignored local and verification outputs", async () => {
  const cwd = workspace();
  const local = output(cwd, "temp/local/report/result.md", "draft one");
  const verification = output(cwd, "temp/verification/report/check.log", "first check");
  const deliverables = ["temp/local/report/result.md", "temp/verification/report/check.log"];
  const first = await acceptanceOutputFingerprint(cwd, deliverables);
  expect(first?.paths).toEqual(deliverables);
  writeFileSync(local, "draft two");
  const second = await acceptanceOutputFingerprint(cwd, deliverables);
  expect(second?.fingerprint).not.toBe(first?.fingerprint);
  writeFileSync(verification, "second check");
  expect((await acceptanceOutputFingerprint(cwd, deliverables))?.fingerprint).not.toBe(
    second?.fingerprint,
  );
  expect(readFileSync(local, "utf8")).toBe("draft two");
});

it("records missing outputs so later file creation changes the snapshot", async () => {
  const cwd = workspace();
  const missing = await acceptanceOutputFingerprint(cwd, ["temp/local/report/result.md"]);
  expect(missing?.paths).toEqual(["temp/local/report/result.md"]);
  output(cwd, "temp/local/report/result.md");
  expect(
    (await acceptanceOutputFingerprint(cwd, ["temp/local/report/result.md"]))?.fingerprint,
  ).not.toBe(missing?.fingerprint);
});

it("normalizes and sorts references and includes directory contents recursively", async () => {
  const cwd = workspace();
  const file = output(cwd, "temp/local/report/b.md");
  output(cwd, "temp/local/report/nested/a.md");
  output(cwd, "README", "stable plain filename");
  const first = await acceptanceOutputFingerprint(cwd, ["`temp/local/report`", "README"]);
  const second = await acceptanceOutputFingerprint(cwd, [
    "README",
    "./temp\\local\\report",
    "README",
  ]);
  expect(first).toEqual(second);
  expect(first?.paths).toEqual(["README", "temp/local/report"]);
  writeFileSync(file, "changed");
  expect(
    (await acceptanceOutputFingerprint(cwd, ["README", "temp/local/report"]))?.fingerprint,
  ).not.toBe(first?.fingerprint);
});

it("ignores prose and remote references without claiming to inspect their evidence", async () => {
  const cwd = workspace();
  const empty = await acceptanceOutputFingerprint(cwd, []);
  expect(
    await acceptanceOutputFingerprint(cwd, [
      "A readable report with checked sources",
      "Write report.md",
      "UI/host integration is complete",
      "https://example.com/report.md",
      "All checks pass",
    ]),
  ).toEqual(empty);
  expect(empty?.paths).toEqual([]);
});

it("includes recorded artifact paths and quoted missing paths with spaces", async () => {
  const cwd = workspace();
  const result = await acceptanceOutputFingerprint(
    cwd,
    ['"temp/local/My report.md"'],
    ["temp/verification/My check.log"],
  );
  expect(result?.paths).toEqual(["temp/local/My report.md", "temp/verification/My check.log"]);
});

it.each([
  "../outside.txt",
  "temp/local/../../../outside.txt",
  "temp\\..\\..\\outside.txt",
  "/outside.txt",
  "C:\\outside.txt",
  "C:outside.txt",
  "\\\\server\\share\\outside.txt",
  "~/outside.txt",
  ".env",
  "temp/local/.env.production",
  "temp/local/private.key",
  ".git/config",
])("refuses unsafe or credential output reference %s", async (path) => {
  expect(await acceptanceOutputFingerprint(workspace(), [path])).toBeUndefined();
});

it("refuses symlink or junction segments and links nested under selected directories", async () => {
  const cwd = workspace();
  const outside = workspace();
  output(outside, "report.md", "must not be read");
  mkdirSync(join(cwd, "temp/local"), { recursive: true });
  symlinkSync(outside, join(cwd, "temp/local/linked"), "junction");
  expect(await acceptanceOutputFingerprint(cwd, ["temp/local/linked/report.md"])).toBeUndefined();
  expect(await acceptanceOutputFingerprint(cwd, ["temp/local"])).toBeUndefined();
  expect(readFileSync(join(outside, "report.md"), "utf8")).toBe("must not be read");
});

it("fails closed when selected directories contain credential files", async () => {
  const cwd = workspace();
  output(cwd, "temp/local/report/.env", "secret");
  expect(await acceptanceOutputFingerprint(cwd, ["temp/local/report"])).toBeUndefined();
});

it("bounds input entries, recursive entries and total file bytes", async () => {
  const cwd = workspace();
  expect(
    await acceptanceOutputFingerprint(
      cwd,
      Array.from({ length: 2001 }, () => "a.md"),
    ),
  ).toBeUndefined();
  const path = output(cwd, "temp/local/large.bin");
  writeFileSync(path, Buffer.alloc(16 * 1024 * 1024 + 1));
  expect(await acceptanceOutputFingerprint(cwd, ["temp/local/large.bin"])).toBeUndefined();
  for (let index = 0; index < 2000; index++) output(cwd, `temp/local/many/${index}.txt`, "");
  expect(await acceptanceOutputFingerprint(cwd, ["temp/local/many"])).toBeUndefined();
});
