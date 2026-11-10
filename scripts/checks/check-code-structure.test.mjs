import assert from "node:assert/strict";
import test from "node:test";
import {
  compare,
  countFindings,
  declaredPublicEntries,
  resolveSpecifier,
  scanFile,
  scanImports,
} from "./check-code-structure.mjs";

const rulesOf = (file, text) =>
  scanFile(file, text)
    .map((finding) => finding.rule)
    .sort();

test("file-lines gates only the hard ceiling; the line target is an uncounted advisory", () => {
  // tsx target 600, hard ceiling 1200.
  const [advisory] = scanFile("src/features/demo/ui/A.tsx", "export const A = 1;\n".repeat(601));
  assert.equal(advisory.rule, "file-lines-target");
  assert.equal(advisory.advisory, true);
  assert.equal(advisory.lines, 602);
  const [finding] = scanFile("src/features/demo/ui/A.tsx", "export const A = 1;\n".repeat(1200));
  assert.equal(finding.rule, "file-lines");
  assert.equal(finding.lines, 1201);
  assert.deepEqual(rulesOf("src/features/demo/ui/B.tsx", "export const B = 1;\n".repeat(599)), []);
  assert.deepEqual(rulesOf("src/features/demo/ui/B.tsx", "export const B = 1;\n".repeat(1199)), [
    "file-lines-target",
  ]);
  assert.deepEqual(rulesOf("host/tasks/launch.ts", "x;\n".repeat(801)), ["file-lines-target"]);
  assert.deepEqual(rulesOf("host/tasks/launch.ts", "x;\n".repeat(1601)), ["file-lines"]);
  assert.deepEqual(rulesOf("host/tasks/launch.test.ts", "x;\n".repeat(801)), []);
  assert.deepEqual(rulesOf("src-tauri/src/fs.rs", "fn a() {}\n".repeat(3001)), ["file-lines"]);
  assert.deepEqual(rulesOf("src-tauri/src/fs/fs_tests.rs", "fn a() {}\n".repeat(3001)), [
    "file-lines-target",
  ]);

  const { counts, details, advisories } = countFindings(["host/tasks/launch.ts"], () =>
    "x;\n".repeat(801),
  );
  assert.deepEqual(counts, {});
  assert.deepEqual(details, []);
  assert.equal(advisories.length, 1);
  assert.deepEqual(compare(counts, {}, null), []);
});

test("loose files at host and feature roots are findings; entry files and folders are not", () => {
  assert.deepEqual(rulesOf("host/social-browser-launch.ts", "export {};"), ["loose-host-file"]);
  assert.deepEqual(rulesOf("host/cli.ts", "export {};"), []);
  assert.deepEqual(rulesOf("host/social/social.ts", "export {};"), []);
  assert.deepEqual(rulesOf("src/features/devices/DevicePanel.tsx", "export {};"), [
    "loose-feature-file",
  ]);
  assert.deepEqual(rulesOf("src/features/devices/index.ts", "export {};"), []);
  assert.deepEqual(rulesOf("src/features/devices/ui/DevicePanel.tsx", "export {};"), []);
  assert.deepEqual(rulesOf("src/features/devices/DevicePanel.test.tsx", "export {};"), []);
});

test("layer imports: foundation and features may not reach app; host may not reach UI", () => {
  assert.deepEqual(
    scanImports("src/shared/ui/Modal.tsx", 'import { x } from "../../app/shell/overlay";').map(
      (f) => f.rule,
    ),
    ["foundation-imports-app"],
  );
  assert.deepEqual(
    scanImports(
      "src/shared/hooks/useColorScheme.ts",
      'import { s } from "@/features/settings/model/settings";',
    ).map((f) => f.rule),
    ["foundation-imports-app"],
  );
  assert.deepEqual(
    scanImports(
      "src/features/voice/ui/VoiceCompanion.tsx",
      'import { a } from "../../../app/App";',
    ).map((f) => f.rule),
    ["feature-imports-app"],
  );
  assert.deepEqual(
    scanImports(
      "host/server.ts",
      'import { v } from "../src/features/voice/ui/VoiceCompanion";',
    ).map((f) => f.rule),
    ["host-imports-ui"],
  );
  assert.deepEqual(
    scanImports("host/server.ts", 'import { v } from "../src/shared/model/host-contracts";'),
    [],
  );
  assert.deepEqual(
    scanImports("src/features/voice/ui/A.tsx", 'import { t } from "../../../shared/i18n";'),
    [],
  );
  assert.deepEqual(scanImports("src/features/voice/ui/A.tsx", 'import x from "react";'), []);
});

test("cross-feature imports require declared public entries and gate deep paths", () => {
  const publicEntries = new Set(["src/features/sessions/public/questionDrafts"]);
  const deep = scanImports(
    "src/features/tasks/ui/A.tsx",
    'import { s } from "../../sessions/data/sessionStore";',
  );
  assert.deepEqual(
    deep.map((f) => f.rule),
    ["cross-feature-deep-import"],
  );
  assert.deepEqual(
    scanImports("src/features/tasks/ui/A.tsx", 'import { s } from "../../sessions";'),
    [],
  );
  assert.deepEqual(
    scanImports("src/features/tasks/ui/A.tsx", 'import { s } from "../../sessions/index";'),
    [],
  );
  assert.deepEqual(
    scanImports(
      "src/features/tasks/ui/A.tsx",
      'import { s } from "../../sessions/public/questionDrafts";',
      publicEntries,
    ),
    [],
  );
  assert.deepEqual(
    scanImports(
      "src/features/tasks/ui/A.tsx",
      'import { s } from "../../sessions/public/unlisted";',
      publicEntries,
    ).map((finding) => finding.rule),
    ["cross-feature-deep-import"],
  );
  assert.deepEqual(
    scanImports("src/features/tasks/ui/A.tsx", 'import { s } from "../model/tasks";'),
    [],
  );
  const { counts, details } = countFindings(
    ["src/features/tasks/ui/A.tsx"],
    () => 'import { s } from "../../sessions/data/sessionStore";',
  );
  assert.deepEqual(counts, {
    "src/features/tasks/ui/A.tsx": { "cross-feature-deep-import": 1 },
  });
  assert.equal(details.length, 1);
  assert.deepEqual(compare(counts, {}, null), [
    {
      file: "src/features/tasks/ui/A.tsx",
      rule: "cross-feature-deep-import",
      count: 1,
      allowed: 0,
      tolerance: 0,
    },
  ]);
  const accepted = countFindings(
    ["src/features/tasks/ui/A.tsx"],
    () => 'import { s } from "../../sessions/public/questionDrafts";',
    publicEntries,
  );
  assert.deepEqual(accepted.counts, {});
});

test("public entries come only from explicit feature index declarations", () => {
  const entries = declaredPublicEntries(
    ["src/features/sessions/index.ts", "src/features/tasks/ui/A.tsx"],
    () =>
      [
        'export type * as modelQuestionDraftsApi from "./public/questionDrafts";',
        'export type * as notPublicApi from "./model/notPublic";',
        'export type * as headlessApi from "./headless";',
      ].join("\n"),
  );
  assert.deepEqual([...entries], ["src/features/sessions/public/questionDrafts"]);
});

test("compare reports only counts above the baseline and honours the file scope", () => {
  const counts = {
    "host/server.ts": { "file-lines": 8299 },
    "host/new-thing.ts": { "loose-host-file": 1 },
    "src/shared/ui/X.tsx": { "foundation-imports-app": 2 },
  };
  const baseline = {
    "host/server.ts": { "file-lines": 8248 },
    "src/shared/ui/X.tsx": { "foundation-imports-app": 2 },
  };
  assert.deepEqual(
    compare(counts, baseline, null).map((i) => `${i.file}:${i.rule}`),
    ["host/server.ts:file-lines", "host/new-thing.ts:loose-host-file"],
  );
  assert.deepEqual(compare(counts, baseline, ["src/shared/ui/X.tsx"]), []);
});

test("a baselined file over the hard ceiling may grow by the tolerance, a new one may not", () => {
  const over = (file, count, allowed) =>
    compare({ [file]: { "file-lines": count } }, { [file]: { "file-lines": allowed } }, null);
  assert.deepEqual(over("src/features/a/ui/A.tsx", 1250, 1300), []);
  assert.deepEqual(over("src/features/a/ui/A.tsx", 1350, 1300), []);
  assert.equal(over("src/features/a/ui/A.tsx", 1351, 1300).length, 1);
  assert.equal(over("src/features/a/ui/A.tsx", 1351, 1300)[0].tolerance, 50);
  // A file absent from the baseline that crosses its hard ceiling fails with no tolerance.
  assert.equal(over("src/features/a/ui/B.tsx", 1201, 0).length, 1);
});

test("specifiers resolve through the @ alias and relative paths", () => {
  assert.equal(
    resolveSpecifier("src/features/a/ui/A.tsx", "@/shared/ui/Button"),
    "src/shared/ui/Button",
  );
  assert.equal(
    resolveSpecifier("src/features/a/ui/A.tsx", "../../b/model/x"),
    "src/features/b/model/x",
  );
  assert.equal(resolveSpecifier("src/features/a/ui/A.tsx", "zustand"), null);
});
