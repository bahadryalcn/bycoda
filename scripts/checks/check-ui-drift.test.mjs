import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  baselineFile,
  checkUiDrift,
  collectDefinitions,
  loadCatalog,
  rules,
  scanFile,
} from "./check-ui-drift.mjs";

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

test("alert container findings use a separate budget from p and span", (t) => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-ui-alert-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = "src/features/demo/A.tsx";
  mkdirSync(dirname(join(root, file)), { recursive: true });
  mkdirSync(join(root, "src/styles"), { recursive: true });
  writeFileSync(join(root, "src/styles/arc.css"), arcCss);
  writeFileSync(
    join(root, file),
    '<p role="alert" />\n<span role="alert" />\n<div role="alert" />\n<small role="alert" />\n<li role="alert" />\n<section role="alert" />\n',
  );
  mkdirSync(dirname(join(root, baselineFile)), { recursive: true });
  writeFileSync(
    join(root, baselineFile),
    JSON.stringify({ schemaVersion: 1, counts: { [file]: { "role-alert-text": 2 } } }),
  );
  const result = checkUiDrift({ root });
  assert.deepEqual(
    result.regressions.map(({ rule, baseline, count }) => [rule, baseline, count]),
    [["role-alert-container", 0, 4]],
  );
});

const fakeCatalog = [
  {
    name: "Disclosure",
    file: "src/shared/ui/Disclosure.tsx",
    replaces: ["details", "summary"],
    status: "stable",
  },
  {
    name: "Switch",
    file: "src/shared/ui/Switch.tsx",
    replaces: ["role=switch"],
    status: "stable",
  },
  {
    name: "Old",
    file: "src/shared/ui/MorphSelect.tsx",
    replaces: ["dl"],
    status: "deprecated",
    instead: "Select",
  },
  {
    name: "MorphSelect",
    file: "src/shared/ui/MorphSelect.tsx",
    replaces: [],
    status: "deprecated",
    instead: "Select",
  },
];

function catalogRulesOf(file, text, catalog = fakeCatalog) {
  const definitions = collectDefinitions(new Map([["src/styles/arc.css", arcCss]]), "", catalog);
  return scanFile(file, text, definitions).map((finding) => finding.rule);
}

test("catalog tokens become raw-tag and raw-role rules in app scope only", () => {
  const tsx =
    '<details><summary>x</summary></details>\n<div role="switch" />\n<dl />\n<span role="tab" />';
  assert.deepEqual(catalogRulesOf("src/features/demo/F.tsx", tsx).sort(), [
    "raw-details",
    "raw-role-switch",
    "raw-summary",
  ]);
  assert.deepEqual(catalogRulesOf("src/shared/ui/F.tsx", tsx), []);
  assert.match(rules["raw-details"], /use Disclosure/);
  assert.match(rules["raw-role-switch"], /use Switch/);
  assert.deepEqual(catalogRulesOf("src/features/demo/F.tsx", tsx, []), []);
});

test("deprecated catalog exports flag named imports from their shared/ui module", () => {
  const bad = 'import { MorphSelect, Select } from "../../shared/ui/MorphSelect";';
  assert.deepEqual(catalogRulesOf("src/features/demo/G.tsx", bad), ["deprecated-import"]);
  const aliased = 'import { MorphSelect as M } from "../../shared/ui/MorphSelect";';
  assert.deepEqual(catalogRulesOf("src/features/demo/G.tsx", aliased), ["deprecated-import"]);
  assert.deepEqual(
    catalogRulesOf("src/features/demo/G.tsx", 'import { Select } from "../../shared/ui/Select";'),
    [],
  );
});

test("modal-padded-child flags a padded first child unless padding or scroll is none", () => {
  const modal = (open, child) => `<Modal ${open}>\n  ${child}\n</Modal>`;
  const padded = '<div className="flex px-4 py-2">x</div>';
  const run = (text) => catalogRulesOf("src/features/demo/H.tsx", text, []);
  assert.deepEqual(run(modal("open", padded)), ["modal-padded-child"]);
  assert.deepEqual(
    run(`<Sheet open>\n<Form className={cn("grid", "hover:pt-2")}>x</Form></Sheet>`),
    ["modal-padded-child"],
  );
  assert.deepEqual(run(modal('open padding="none"', padded)), []);
  assert.deepEqual(run(modal('open scroll="none"', padded)), []);
  assert.deepEqual(run(modal("open", '<div className="flex gap-2 scroll-pt-4">x</div>')), []);
  assert.deepEqual(run(modal("open {...rest} padding={padding}", padded)), []);
  assert.deepEqual(run(modal('open scroll={fill ? "none" : "auto"}', padded)), []);
  assert.deepEqual(run(modal('open padding="md"', padded)), ["modal-padded-child"]);
  assert.deepEqual(run(modal("open", "<p>text</p>")), []);
  assert.deepEqual(run(`<Modal open>{body}</Modal>`), []);
});

test("a missing or throwing catalog degrades to no catalog rules", () => {
  const definitions = collectDefinitions(new Map(), "", undefined);
  assert.equal(definitions.catalog.tags.size, 0);
  assert.deepEqual(scanFile("src/features/demo/I.tsx", "<details />", definitions), []);
  assert.equal(loadCatalog("/definitely/not/a/repo") instanceof Array, true);
});

test("ui-drift-ignore on the line above suppresses only the named rule and needs a reason", () => {
  const file = "src/features/x/ui/Box.tsx";
  const ignored = [
    "{/* ui-drift-ignore: raw-native-control -- bespoke composer editor */}",
    "<textarea value={v} />",
  ].join("\n");
  assert.ok(!rulesOf(file, ignored).includes("raw-native-control"));
  const noReason = ["{/* ui-drift-ignore: raw-native-control */}", "<textarea value={v} />"].join(
    "\n",
  );
  assert.ok(rulesOf(file, noReason).includes("raw-native-control"));
  const otherRule = [
    "{/* ui-drift-ignore: raw-label -- wrong rule */}",
    "<textarea value={v} />",
  ].join("\n");
  assert.ok(rulesOf(file, otherRule).includes("raw-native-control"));
});

test("variant prefixes with a named container or arbitrary value no longer hide Tailwind drift", () => {
  const classes = [
    "@max-[950px]/main-row:z-30",
    "group-has-(--x):text-xs",
    "@container/main:hover:bg-red-500",
    "has-[>svg]:p-[13px]",
    "supports-[display:grid]:font-bold",
  ];
  for (const name of classes) {
    const found = rulesOf("src/features/demo/V.tsx", `const a = <div className="${name}" />;`);
    assert.ok(found.length > 0, `${name} should be flagged`);
  }
  assert.deepEqual(
    rulesOf("src/features/demo/V.tsx", '<div className="@max-[950px]/main-row:flex" />'),
    [],
  );
});

test("CSS font weights above 500 are flagged, including 501 to 599", () => {
  for (const weight of ["501", "550", "599", "600", "700", "bold"])
    assert.deepEqual(rulesOf("src/features/demo/w.css", `.x { font-weight: ${weight}; }`), [
      "font-weight",
    ]);
  for (const weight of ["400", "500", "normal"])
    assert.deepEqual(rulesOf("src/features/demo/w.css", `.x { font-weight: ${weight}; }`), []);
});

test("themePalette literals are flagged in feature and app code only", () => {
  const code = "const c = themePalette.hexf59e0b + themePalette.oklch12 + themePalette.danger;";
  assert.deepEqual(rulesOf("src/features/demo/P.tsx", code), [
    "theme-palette-literal",
    "theme-palette-literal",
  ]);
  assert.deepEqual(rulesOf("src/shared/theme/P.tsx", code), []);
  assert.deepEqual(rulesOf("src/features/demo/P.tsx", "const c = themePalette.dangerDark;"), []);
});
