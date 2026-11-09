import assert from "node:assert/strict";
import test from "node:test";
import { parseNumstat, reviewReport, summary } from "./pr-review-report.mjs";
test("preserves binary unknown counts, source/test/locale/generated burden and rename identity", () => {
  const files = parseNumstat(
    "5\t2\tsrc/a.ts\0" +
      "12\t1\tsrc/a.test.ts\0" +
      "-\t-\tpublic/logo.png\0" +
      "0\t0\t\0src/old name.ts\0src/new name.ts\0" +
      "100\t50\tpnpm-lock.yaml\0" +
      "8\t2\tsrc/shared/i18n/locales/tr.json\0",
  );
  const report = reviewReport(files, { headSha: "a".repeat(40) });
  assert.equal(report.groups.production.files, 3);
  assert.equal(report.groups.production.binary, 1);
  assert.equal(report.groups.production.renames, 1);
  assert.equal(report.groups.tests.additions, 12);
  assert.equal(report.groups.generated.additions, 100);
  assert.equal(report.groups.locales.additions, 8);
  assert.equal(files[3].oldPath, "src/old name.ts");
  assert.match(summary(report), /never decides merge eligibility/);
  assert.equal(report.advisory, true);
});
test("rejects truncated rename, invalid count and unterminated records", () => {
  for (const value of [
    "1\t2\tfile.ts",
    "1\t-\tfile.ts\0",
    "0\t0\t\0old.ts\0",
    "999999999999999999999\t0\ta.ts\0",
  ])
    assert.throws(() => parseNumstat(value));
  assert.deepEqual(parseNumstat(""), []);
});
