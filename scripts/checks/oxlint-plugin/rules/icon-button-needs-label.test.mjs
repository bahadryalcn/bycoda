import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

/** Lints scratch files with only this rule enabled; returns [file, line] per report. */
function lint(t, files) {
  const root = mkdtempSync(join(tmpdir(), "bycoda icon-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, contents) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), contents);
  };
  const ruleUrl = new URL("./icon-button-needs-label.mjs", import.meta.url).href;
  write("package.json", JSON.stringify({ name: "fixture", private: true }));
  write(
    "plugin.mjs",
    `import rule from ${JSON.stringify(ruleUrl)};
export default { meta: { name: "bycoda" }, rules: { "icon-button-needs-label": rule } };`,
  );
  write(
    "vite.config.mjs",
    `export default { lint: { categories: { correctness: "off" },
jsPlugins: ["./plugin.mjs"], rules: { "bycoda/icon-button-needs-label": "error" } } };`,
  );
  for (const [file, lines] of Object.entries(files)) write(file, lines.join("\n"));
  const vp = join(dirname(require.resolve("vite-plus/package.json")), "bin", "vp");
  const result = spawnSync(
    process.execPath,
    [vp, "lint", "--format", "json", ...Object.keys(files)],
    { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000 },
  );
  if (result.error) throw result.error;
  assert.ok(result.stdout.trim(), result.stderr);
  const { diagnostics } = JSON.parse(result.stdout);
  return diagnostics
    .map(({ filename, labels }) => [filename.replaceAll("\\", "/"), labels[0].span.line])
    .sort((a, b) => a[1] - b[1]);
}

const file = "src/features/a/Toolbar.tsx";

test("icon-button-needs-label flags nameless icon Buttons resolved to the shared Button", (t) => {
  const found = lint(t, {
    [file]: [
      "import { Button } from '@/shared/ui/Button';", // 1
      "import { Button as Action } from '../../shared/ui/Button';", // 2
      "import * as UI from '@/shared/ui/Button';", // 3
      "import { Trash } from 'lucide-react';", // 4
      "const a = <Button iconOnly />;", // 5 rejected
      "const b = <Action startIcon={x} />;", // 6 rejected
      "const c = <UI.Button endIcon={x}> </UI.Button>;", // 7 rejected: whitespace is no text
      "const d = <Button iconOnly><Trash aria-hidden /></Button>;", // 8 rejected: decorative child
      "const e = <Button startIcon={x}><Trash /></Button>;", // 9 rejected: lucide icon is not a name
      "const f = <Button iconOnly label={t('Delete')} />;", // 10 allowed
      "const g = <Action startIcon={x} aria-label={t('Delete')} />;", // 11 allowed
      "const h = <Button startIcon={x}>{t('Save')}</Button>;", // 12 allowed: text child
      "const i = <Button iconOnly {...props} />;", // 13 allowed: spread may carry a name
      "const j = <Button variant='ghost' />;", // 14 allowed: not an icon Button
    ],
  });
  assert.deepEqual(
    found.map(([, line]) => line),
    [5, 6, 7, 8, 9],
  );
});

test("icon-button-needs-label ignores local Button homonyms and other modules", (t) => {
  const found = lint(t, {
    "src/features/a/Local.tsx": [
      "import { Button } from './Button';",
      "const a = <Button iconOnly />;",
    ],
    "src/features/a/Lib.tsx": [
      "import { Button } from 'some-lib';",
      "const a = <Button iconOnly />;",
    ],
    "src/features/a/Own.tsx": ["const Button = () => null;", "const a = <Button iconOnly />;"],
    "src/features/a/Missing.tsx": ["const a = <Button iconOnly />;"],
  });
  assert.deepEqual(found, []);
});

test("icon-button-needs-label resolves ./Button inside src/shared/ui and skips tests and non-src files", (t) => {
  const found = lint(t, {
    "src/shared/ui/Row.tsx": [
      "import { Button } from './Button';",
      "const a = <Button iconOnly />;",
    ],
    "src/features/a/Toolbar.test.tsx": [
      "import { Button } from '@/shared/ui/Button';",
      "const a = <Button iconOnly />;",
    ],
    "host/Screen.tsx": [
      "import { Button } from '@/shared/ui/Button';",
      "const a = <Button iconOnly />;",
    ],
  });
  assert.deepEqual(found, [["src/shared/ui/Row.tsx", 2]]);
});
