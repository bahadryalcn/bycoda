import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { baselineFile, checkUiDrift, collectDefinitions, scanFile } from "./check-ui-drift.mjs";

const arcCss = `.bycoda-arc {\n  --radius-control: 4px;\n  --space-2: 0.375rem;\n}\n`;
const indexCss = `@source "../node_modules/x/dist/*.js";\n:root { --ui-surface: red; --layer-popover: 80; --color-accent: red; --motion-duration-fast: 1s; --motion-ease-out: ease; --motion: cubic-bezier(0, 0, 1, 1); }\n.a { transition: opacity 120ms ease; z-index: 50; }\n`;

function rulesOf(file, text, extra = []) {
  const sources = new Map([
    ["src/styles/arc.css", arcCss],
    ["src/styles/index.css", indexCss],
    ...extra,
    [file, text],
  ]);
  return scanFile(file, text, collectDefinitions(sources)).map((finding) => finding.rule);
}

test("flags token drift but keeps defined, inline-set and Arc-rooted variables", () => {
  const tsx = [
    'import { X } from "../../shared/ui/icons";',
    'const a = <div className="bg-(--ui-surface) text-(--missing) rounded-(--radius-control)" />;',
    'const b = <div style={{ "--local": 1 }} className="w-(--local)" />;',
    'const c = <X className="size-3.5 text-danger bg-accent animate-spin z-[var(--layer-popover)]" strokeWidth={1.5} />;',
    '// className="text-[13px]" in a comment is ignored',
  ].join("\n");
  assert.deepEqual(rulesOf("src/features/demo/A.tsx", tsx).sort(), [
    "arc-var-outside-arc",
    "icon-size-class",
    "icon-stroke-width",
    "loading-motion",
    "undefined-var",
  ]);
  assert.deepEqual(
    rulesOf("src/features/demo/B.tsx", '<div className="bycoda-arc rounded-(--radius-control)" />'),
    [],
  );
});

test("JSX attribute rules read the whole opening tag", () => {
  const tsx = [
    '<Button\n  title={t("Save")}\n  className="h-7"\n/>',
    '<button title="">x</button>',
    '<p role="alert">{error}</p>',
    '<Popover open role="menu" />',
    '<span className="motion-safe:animate-spin" />',
  ].join("\n");
  assert.deepEqual(rulesOf("src/app/shell/C.tsx", tsx).sort(), [
    "fixed-control-size",
    "native-title",
    "popover-menu",
    "raw-native-control",
    "role-alert-text",
  ]);
});

test("component-usage rules flag raw controls, dialogs, live regions and untranslated copy", () => {
  const tsx = [
    'import { Loader2, Check } from "../../shared/ui/icons";',
    '<input type="date" value={v} />',
    '<a href="https://example.com" target="_blank">docs</a>',
    '<Alert tone="danger" role="alert">{error}</Alert>',
    '<div aria-live="polite">{status}</div>',
    '<Loader2 className="icon-sm" />',
    '<Check className="icon-sm" />',
    '<span className="font-semibold outline-none p-[13px]">x</span>',
    "<div style={{ width: 240, color: tone }} />",
    '<TextField label="Enter the project name" />',
    "<p>Nothing to show here yet.</p>",
    '<p>{t("Nothing to show here yet.")}</p>',
    "<code>git push origin main</code>",
  ].join("\n");
  assert.deepEqual(rulesOf("src/features/demo/E.tsx", tsx).sort(), [
    "alert-role-prop",
    "arbitrary-spacing",
    "focus-outline-removed",
    "font-weight",
    "inline-style-layout",
    "loader-icon-spinner",
    "native-date-input",
    "raw-anchor",
    "raw-aria-live",
    "raw-native-control",
    "target-blank",
    "untranslated-jsx-text",
    "untranslated-prop",
  ]);
  // Shared UI owns the primitives, so the same text is clean there.
  assert.deepEqual(rulesOf("src/shared/ui/Demo.tsx", '<button aria-live="polite" />'), []);
  const css = ".x { font-weight: 600; outline: none; }\n.y { font-weight: 500; }";
  assert.deepEqual(rulesOf("src/features/demo/e.css", css).sort(), [
    "focus-outline-removed",
    "font-weight",
  ]);
});

test("semantic status utilities pass; raw base hue vars and literal layers/motion are flagged", () => {
  assert.deepEqual(
    rulesOf(
      "src/features/demo/D.tsx",
      '<div className="text-danger bg-warning border-success z-(--layer-popover) z-[50]" />',
    ),
    ["layer"],
  );
  const css = [
    ".a { color: var(--color-accent); z-index: var(--layer-popover); }",
    ".b { transition: opacity var(--motion-duration-fast) var(--motion-ease-out); z-index: 50; }",
  ].join("\n");
  assert.deepEqual(rulesOf("src/features/demo/d.css", css).sort(), ["color-base-hue", "layer"]);
});

test("shared stylesheet scan skips :root tokens and string globs", () => {
  assert.deepEqual(rulesOf("src/styles/index.css", indexCss).sort(), ["layer", "motion-literal"]);
});

test("only counts above the baseline fail, per file and rule", (t) => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-ui-drift-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  write("src/styles/arc.css", arcCss);
  write("src/features/demo/A.tsx", '<p className="text-xs" />\n');
  write(
    baselineFile,
    JSON.stringify({ schemaVersion: 1, counts: { "src/features/demo/A.tsx": { typography: 1 } } }),
  );
  assert.equal(checkUiDrift({ root }).success, true);
  const added = new Map([["src/features/demo/A.tsx", '<p className="text-xs text-[13px]" />\n']]);
  const result = checkUiDrift({ root, overrides: added, files: ["src/features/demo/A.tsx"] });
  assert.equal(result.success, false);
  assert.deepEqual(
    result.regressions.map(({ rule, baseline, count }) => [rule, baseline, count]),
    [["typography", 1, 2]],
  );
  const fixed = new Map([["src/features/demo/A.tsx", '<p className="text-ui-caption" />\n']]);
  assert.equal(checkUiDrift({ root, overrides: fixed }).improvements.length, 1);
});
