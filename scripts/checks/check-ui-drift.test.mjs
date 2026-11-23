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
import { appearanceRules } from "./ui-drift-appearance.mjs";

// The appearance ownership rules have their own tests (ui-drift-appearance.test.mjs).
const notAppearance = (rule) => !(rule in appearanceRules);

test("primary actions are no longer counted lexically across independent groups", () => {
  assert.deepEqual(
    rulesOf(
      "src/features/demo/View.tsx",
      'const View = () => <><Group><Button variant="primary" /></Group><Group><Button variant="primary" /></Group></>;',
    ),
    [],
  );
});

test("nested card guard follows JSX ancestry including surfaceAttributes spreads", () => {
  const count = (source) =>
    rulesOf("src/features/demo/View.tsx", source).filter((rule) => rule === "nested-card").length;
  assert.equal(
    count('<Surface variant="card"><div><Surface variant={"card"} /></div></Surface>'),
    1,
  );
  assert.equal(
    count('<div {...surfaceAttributes({ variant: "card" })}><Surface variant="card" /></div>'),
    1,
  );
  assert.equal(
    count(
      '<Surface variant="card"><div {...surfaceAttributes({ "variant": "card" })} /></Surface>',
    ),
    1,
  );
  assert.equal(
    count(
      '<Surface variant="card"><Surface variant="card"><Surface variant="card" /></Surface></Surface>',
    ),
    2,
  );
  assert.equal(count('<><Surface variant="card" /><Surface variant="card" /></>'), 0);
  assert.equal(count('<Surface variant="card"><Surface variant="inset" /></Surface>'), 0);
  assert.equal(count('<Surface variant="card">{() => <Surface variant="card" />}</Surface>'), 0);
  assert.equal(
    count('const example = `<Surface variant="card"><Surface variant="card" /></Surface>`;'),
    0,
  );
  assert.equal(
    count(
      '<Surface variant="card">\n{/* ui-drift-ignore: nested-card -- embedded preview */}\n<Surface variant="card" /></Surface>',
    ),
    0,
  );
});

test("nested surface guard treats a settings Group as a framed card", () => {
  const imported = 'import { Group } from "../../shared/ui/settings";\n';
  const count = (source) =>
    rulesOf("src/features/demo/View.tsx", imported + source).filter(
      (rule) => rule === "nested-surface",
    ).length;
  assert.equal(count("<Group><Group /></Group>"), 1);
  assert.equal(count('<Group><Surface variant="card" /></Group>'), 1);
  assert.equal(count('<Surface variant="card"><Group /></Surface>'), 1);
  assert.equal(count("<><Group /><Group /></>"), 0);
  assert.equal(count('<Group><Surface variant="inset" /></Group>'), 0);
  assert.equal(
    rulesOf("src/features/demo/View.tsx", "<Group><Group /></Group>").includes("nested-surface"),
    false,
  );
  assert.equal(
    count("<Group>\n{/* ui-drift-ignore: nested-surface -- embedded editor */}\n<Group /></Group>"),
    0,
  );
});

test("tooltip guard flags hints that only restate the visible label", () => {
  const count = (source) =>
    rulesOf("src/features/demo/View.tsx", source).filter((rule) => rule === "tooltip-repeats-label")
      .length;
  assert.equal(count('<Button tooltip="Delete">Delete</Button>'), 1);
  assert.equal(count('<Button tooltip={t("Delete")}>{t("Delete…")}</Button>'), 1);
  assert.equal(count('<Tooltip label="Copy link"><Button>Copy link</Button></Tooltip>'), 1);
  assert.equal(count('<Button tooltip="Delete" />'), 0);
  assert.equal(count('<Button tooltip="Delete this note">Delete</Button>'), 0);
  assert.equal(count('<Button tooltip="Delete" tooltipDetails={[name]}>Delete</Button>'), 0);
  assert.equal(count('<Button tooltip="Delete" tooltipWhen="overflow">Delete</Button>'), 0);
  assert.equal(count('<Tooltip label="Copy" shortcut="Mod+C"><Button>Copy</Button></Tooltip>'), 0);
  assert.equal(count('<Button tooltip="Copy" shortcut="Mod+C">Copy</Button>'), 0);
  assert.equal(
    count(
      'import { Button as Action } from "@/shared/ui/Button"; <Action tooltip="Copy" children="Copy" />;',
    ),
    1,
  );
  assert.equal(
    count(
      'import { Tooltip as Hint } from "@/shared/ui/Tooltip"; const View = ({ label }) => <Hint label={label}><Button><span>{label}</span></Button></Hint>;',
    ),
    1,
  );
  assert.equal(
    count("const View = ({ label }) => <Button tooltip={label}><span>{label}</span></Button>;"),
    1,
  );
  for (const source of [
    "const View = ({ label }) => <Button iconOnly aria-label={label} tooltip={label}><svg /></Button>;",
    'const View = ({ label }) => <Button tooltip={label}><span className="sr-only md:inline">{label}</span></Button>;',
    'const View = ({ label }) => <Button tooltip={label}><span className="truncate">{label}</span></Button>;',
    '<Tooltip label="Copy"><Button><Text truncate>Copy</Text></Button></Tooltip>',
    '<Tooltip label="Copy"><Button>Copy link</Button></Tooltip>',
    '<Button tooltip="Copy">{ready ? "Copy" : "Wait"}</Button>',
  ])
    assert.equal(count(source), 0, source);
  assert.equal(
    count(
      '{/* ui-drift-ignore: tooltip-repeats-label -- clipped label */}\n<Button tooltip="Delete">Delete</Button>',
    ),
    0,
  );
});

test("feedback guard requires one bound failure or matching footer reason", () => {
  const imports = [
    'import { useState } from "react";',
    'import { Alert as Banner } from "@/shared/ui/Alert";',
    'import { InlineError as ErrorLine } from "@/shared/ui/InlineError";',
    'import { Toast, toast as notifications } from "@/shared/ui/ToastRegion";',
    'import { ModalActions as Actions } from "@/shared/ui/Modal";',
    'import { Button as Action } from "@/shared/ui/Button";',
  ].join("\n");
  const findings = (source) => {
    const file = "src/features/demo/View.tsx";
    const text = `${imports}\n${source}`;
    return scanFile(file, text, collectDefinitions(new Map([[file, text]]))).filter(
      (item) => item.rule === "duplicate-feedback-channel",
    );
  };
  for (const [source, line] of [
    [
      `const View = ({ failure }) => <>
  <ErrorLine>{failure}</ErrorLine>
  <Banner>{failure}</Banner>
  <Toast message={failure} />
</>;`,
      "<Banner>{failure}</Banner>",
    ],
    [
      `const View = ({ reason }) => <Actions reason={reason}>
  <Action
    disabledReason={reason}
  />
</Actions>;`,
      "disabledReason={reason}",
    ],
    [
      `const View = () => <Actions reason={t("Required")}><Action disabledReason={t("Required")} /></Actions>;`,
      "disabledReason",
    ],
    [
      `function View() {
  const [error, setError] = useState(null);
  function onRetry() {
    try { retry(); } catch (failure) {
      setError(failure);
      notifications.show({
        message: failure,
      });
    }
  }
  return <ErrorLine>{error}</ErrorLine>;
}`,
      "message: failure",
    ],
  ]) {
    const result = findings(source);
    assert.equal(result.length, 1, source);
    assert.ok(result[0].text.includes(line), source);
  }
  for (const source of [
    "const View = ({ failure }) => retrying ? <ErrorLine>{failure}</ErrorLine> : <Banner>{failure}</Banner>;",
    "const View = ({ failure }) => <>{retrying && <ErrorLine>{failure}</ErrorLine>}{!retrying && <Banner>{failure}</Banner>}</>;",
    'const View = () => <><ErrorLine>{t("Retry failed")}</ErrorLine><Banner>{t("Retry failed")}</Banner></>;',
    "const View = ({ failure, detail }) => <><ErrorLine>{failure}</ErrorLine><Banner>{detail}</Banner><Toast historyMessage={failure} /></>;",
    "const View = ({ reason }) => <Actions reason={reason}>{confirming && <Action disabledReason={reason} />}</Actions>;",
    "const View = ({ reason }) => <Actions reason={reason}><Action {...props} disabledReason={reason} /></Actions>;",
    'function View() { const [error, setError] = useState(null); function retryA() { setError(t("Retry failed")); } function retryB() { notifications.show({message: t("Retry failed")}); } return <ErrorLine>{error}</ErrorLine>; }',
    "function View({ failure }) { const [error, setError] = useState(null); function retryA() { setError(failure); } function retryB() { notifications.show({message: failure}); } return <ErrorLine>{error}</ErrorLine>; }",
    "function View({ failure }) { const [error, setError] = useState(null); function retry() { setError(failure); anotherOperation(); notifications.show({message: failure}); } return <ErrorLine>{error}</ErrorLine>; }",
  ])
    assert.deepEqual(findings(source), [], source);
});

test("hover reveal guard requires a matching visibility property and independent keyboard path", () => {
  const count = (classes, file = "src/features/demo/View.tsx") =>
    rulesOf(file, `<div className="${classes}" />`).filter((rule) => rule === "hover-only-reveal")
      .length;
  assert.equal(count("opacity-0 group-hover:opacity-100"), 1);
  assert.equal(count("invisible hover:visible"), 1);
  assert.equal(count("opacity-0 group-hover/row:opacity-100", "src/shared/ui/Row.tsx"), 1);
  for (const focus of [
    "focus-within",
    "focus-visible",
    "group-focus-within",
    "group-focus-within/row",
  ])
    assert.equal(count(`opacity-0 group-hover:opacity-100 ${focus}:opacity-100`), 0);
  assert.equal(count("invisible hover:visible focus-visible:visible"), 0);
  assert.equal(count("opacity-0 hover:opacity-100 focus-visible:visible"), 1);
  assert.equal(count("opacity-0 hover:opacity-100 hover:focus-within:opacity-100"), 1);
  assert.equal(count("opacity-0 hover:opacity-100 focus-within:opacity-0"), 1);
  assert.equal(
    count("opacity-0 invisible hover:opacity-100 hover:visible focus-within:opacity-100"),
    1,
  );
  assert.equal(count("hover:opacity-100"), 0);
  assert.equal(count("opacity-0 focus-visible:opacity-100"), 0);
  assert.equal(count("opacity-0 hover:opacity-100", "src/app/View.tsx"), 0);
  assert.equal(count("opacity-0 hover:opacity-100", "src/shared/ui/Row.test.tsx"), 0);
  assert.ok(
    rulesOf(
      "src/shared/ui/Row.tsx",
      '<div className={cn("opacity-0", "group-hover:opacity-100")} />',
    ).includes("hover-only-reveal"),
  );
  assert.ok(
    rulesOf(
      "src/features/demo/View.tsx",
      '<div className="opacity-0 hover:opacity-100" data-example="focus-within:opacity-100" />',
    ).includes("hover-only-reveal"),
  );
});

const arcCss = `.bycoda-arc {\n  --radius-control: 4px;\n  --space-2: 0.375rem;\n}\n`;
const indexCss = `@source "../node_modules/x/dist/*.js";\n:root { --ui-surface: red; --layer-popover: 80; --color-accent: red; --motion-duration-fast: 1s; --motion-ease-out: ease; --motion: cubic-bezier(0, 0, 1, 1); }\n.a { transition: opacity 120ms ease; z-index: 50; }\n`;

function rulesOf(file, text, extra = []) {
  const sources = new Map([
    ["src/styles/arc.css", arcCss],
    ["src/styles/index.css", indexCss],
    ...extra,
    [file, text],
  ]);
  return scanFile(file, text, collectDefinitions(sources))
    .map((finding) => finding.rule)
    .filter(notAppearance);
}

test("native date rule also rejects native picker types on shared field components", () => {
  for (const type of ["date", "time", "datetime-local"]) {
    for (const tag of ["input", "TextField", "Input", "Form.TextField"]) {
      for (const attribute of [`type="${type}"`, `type={'${type}'}`, `type = { "${type}" }`]) {
        const text = `<${tag} label={t("Time")} ${attribute} />`;
        assert.ok(
          rulesOf("src/features/demo/Pickers.tsx", text).includes("native-date-input"),
          text,
        );
        assert.ok(!rulesOf("src/shared/ui/Pickers.tsx", text).includes("native-date-input"));
      }
    }
  }
  for (const text of [
    '<TextField type="text" />',
    '<TimePicker value="12:00" />',
    "<DatePicker />",
    "<DateTimePicker />",
    "<DateRangePicker />",
    "<DateTimeRangePicker />",
  ]) {
    assert.ok(!rulesOf("src/app/Pickers.tsx", text).includes("native-date-input"));
  }
});

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

test("control sizing reads the control class, not JSX supplied through another prop", () => {
  const file = "src/features/demo/Choice.tsx";
  assert.ok(
    !rulesOf(file, '<Select options={[{ icon: <Choice className="size-4" /> }]} />').includes(
      "fixed-control-size",
    ),
  );
  assert.ok(
    rulesOf(
      file,
      '<Select options={[{ icon: <Choice className="icon-sm" /> }]} className="h-8" />',
    ).includes("fixed-control-size"),
  );
  assert.ok(
    rulesOf(file, '<Select className={wide ? "h-8" : "h-7"} />').includes("fixed-control-size"),
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
    "loading-motion",
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
    JSON.stringify({
      schemaVersion: 1,
      counts: { "src/features/demo/A.tsx": { "feature-typography": 1 } },
    }),
  );
  assert.equal(checkUiDrift({ root }).success, true);
  const added = new Map([["src/features/demo/A.tsx", '<p className="text-xs text-[13px]" />\n']]);
  const result = checkUiDrift({ root, overrides: added, files: ["src/features/demo/A.tsx"] });
  assert.equal(result.success, false);
  assert.deepEqual(
    result.regressions.map(({ rule, baseline, count }) => [rule, baseline, count]),
    [["feature-typography", 1, 2]],
  );
  // Feature typography now comes from Text roles, so the fix carries no type class at all.
  const fixed = new Map([["src/features/demo/A.tsx", "<p />\n"]]);
  assert.equal(checkUiDrift({ root, overrides: fixed }).improvements.length, 1);
});

test("view guards use existing per-file regression and improvement budgets", (t) => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-ui-view-guards-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = "src/shared/demo/View.tsx";
  mkdirSync(dirname(join(root, file)), { recursive: true });
  mkdirSync(dirname(join(root, baselineFile)), { recursive: true });
  const fixtures = [
    ["tooltip-repeats-label", '<Button tooltip="Save">Save</Button>'],
    ["nested-card", '<Surface variant="card"><Surface variant="card" /></Surface>'],
    ["hover-only-reveal", '<div className="opacity-0 hover:opacity-100" />'],
  ];
  for (const [rule, source] of fixtures) {
    writeFileSync(join(root, file), source);
    writeFileSync(join(root, baselineFile), JSON.stringify({ schemaVersion: 1, counts: {} }));
    const added = checkUiDrift({ root });
    assert.deepEqual(
      added.regressions.map(({ rule, count }) => [rule, count]),
      [[rule, 1]],
    );
    writeFileSync(
      join(root, baselineFile),
      JSON.stringify({ schemaVersion: 1, counts: { [file]: { [rule]: 1 } } }),
    );
    assert.equal(checkUiDrift({ root }).success, true);
    const fixed = checkUiDrift({ root, overrides: new Map([[file, "const View = () => null;"]]) });
    assert.equal(fixed.success, true);
    assert.deepEqual(fixed.improvements, [{ file, rule, baseline: 1, count: 0 }]);
  }
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
  return scanFile(file, text, definitions)
    .map((finding) => finding.rule)
    .filter(notAppearance);
}

test("catalog tokens become raw-tag and raw-role rules in app scope only", () => {
  const tsx =
    '<details><summary>x</summary></details>\n<div role="switch" />\n<dl />\n<span role="tab" />';
  assert.deepEqual(catalogRulesOf("src/features/demo/F.tsx", tsx).sort(), [
    "raw-details",
    "raw-native-control",
    "raw-role-switch",
    "raw-summary",
  ]);
  assert.deepEqual(catalogRulesOf("src/shared/ui/F.tsx", tsx), []);
  assert.match(rules["raw-details"], /use Disclosure/);
  assert.match(rules["raw-role-switch"], /use Switch/);
  assert.deepEqual(catalogRulesOf("src/features/demo/F.tsx", tsx, []), [
    "raw-native-control",
    "raw-native-control",
  ]);
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

test("component families enforce wrapper imports including aliases and lazy modules", () => {
  for (const text of [
    'import { X as Choice } from "@/shared/ui/arc/select";',
    'export { X } from "../../shared/ui/arc/menu";',
    'const module = import("@/shared/ui/arc/menu");',
    'import { NativePopupHost } from "../../shared/ui/NativePopupHost";',
    'import { popupNativeActionMenu } from "../../shared/ui/nativeActionMenu";',
  ])
    assert.ok(rulesOf("src/features/demo/View.tsx", text).includes("ui-wrapper-import"), text);
  assert.ok(
    !rulesOf("src/shared/ui/Select.tsx", 'import { X } from "./arc/select";').includes(
      "ui-wrapper-import",
    ),
  );
  assert.ok(
    !rulesOf("src/features/demo/View.tsx", 'import { Select } from "@/shared/ui/Select";').includes(
      "ui-wrapper-import",
    ),
  );
});

test("shared component implementations may compose Arc from nested folders", () => {
  for (const file of [
    "src/shared/ui/date-time/PickerShell.tsx",
    "src/shared/ui/picker/PickerList.tsx",
  ])
    assert.ok(
      !rulesOf(file, 'import { SelectTrigger } from "../arc/select/select";').includes(
        "ui-wrapper-import",
      ),
    );
  assert.ok(
    rulesOf(
      "src/features/demo/ui/PickerShell.tsx",
      'import { SelectTrigger } from "@/shared/ui/arc/select/select";',
    ).includes("ui-wrapper-import"),
  );
});

test("bootstrap native context-menu guard is not a rendered menu primitive", () => {
  assert.ok(
    !rulesOf(
      "src/main.tsx",
      'import { installNativeContextMenuGuard } from "./shared/lib/nativeContextMenu";',
    ).includes("ui-wrapper-import"),
  );
});

test("floating surfaces have one placement owner and semantic popups use wrappers", () => {
  for (const role of ["menu", "listbox", "dialog", "tooltip"])
    assert.ok(
      rulesOf("src/features/demo/View.tsx", `<div role={"${role}"} />`).includes(
        "portal-outside-shared",
      ),
    );
  for (const file of ["src/features/demo/View.tsx", "src/shared/ui/Other.tsx"])
    assert.ok(
      rulesOf(file, 'ReactDOM.createPortal(<div className="fixed" />, document.body)').includes(
        "portal-outside-shared",
      ),
    );
  assert.ok(
    !rulesOf(
      "src/shared/ui/Popover.tsx",
      'createPortal(<div className="fixed" />, document.body)',
    ).includes("portal-outside-shared"),
  );
  assert.ok(
    !rulesOf("src/shared/ui/Portal.tsx", "createPortal(children, target)").includes(
      "portal-outside-shared",
    ),
  );
});

test("canonical shared dialog, sheet, media and toast owners may place their own portals", () => {
  for (const name of ["Modal", "Sheet", "ImageLightbox", "ToastRegion"])
    assert.ok(
      !rulesOf(
        `src/shared/ui/${name}.tsx`,
        'createPortal(<div className="fixed" />, document.body)',
      ).includes("portal-outside-shared"),
      name,
    );
  assert.ok(
    rulesOf(
      "src/shared/ui/TransientNotice.tsx",
      'createPortal(<div className="fixed" />, document.body)',
    ).includes("portal-outside-shared"),
  );
});

test("hand-written loading and native tooltips name shared replacements", () => {
  for (const animation of [
    "animate-spin",
    "motion-safe:animate-spin",
    "animate-pulse",
    "animate-shimmer",
  ])
    assert.ok(
      rulesOf("src/features/demo/View.tsx", `<div className="${animation}" />`).includes(
        "loading-motion",
      ),
    );
  for (const tag of ["span", "div", "Badge", "Text"])
    assert.ok(
      rulesOf("src/features/demo/View.tsx", `<${tag} title={name} />`).includes("native-title"),
    );
  assert.ok(!rulesOf("src/features/demo/View.tsx", '<span title="" />').includes("native-title"));
  assert.ok(
    !rulesOf("src/features/demo/View.tsx", '<iframe title="HTML preview" />').includes(
      "native-title",
    ),
    "iframe title provides its accessible name, not a hover tooltip",
  );
  assert.ok(
    !rulesOf("src/features/demo/View.tsx", '<SectionHeader title="Settings" />').includes(
      "native-title",
    ),
  );
  assert.ok(!rulesOf("src/features/demo/View.tsx", '<span title = "" />').includes("native-title"));
  for (const role of ["progressbar", "tab", "tablist"])
    assert.ok(
      rulesOf("src/features/demo/View.tsx", `<div role="${role}" />`).includes(
        "raw-native-control",
      ),
    );
  assert.match(rules["loading-motion"], /Spinner.*Skeleton/);
  assert.match(rules["raw-native-control"], /ProgressBar.*SegmentedControl/);
});

test("feedback-action-slot flags JSX in notice action slots, not structured objects", () => {
  const file = "src/features/demo/View.tsx";
  for (const text of [
    "<Alert action={<Button>Retry</Button>} />",
    '<InlineMessage actions={[<Button key="a">A</Button>]} />',
    "<EmptyState action={cond ? <Button>Go</Button> : null} />",
    "<Toast action={<Link>More</Link>} />",
  ])
    assert.ok(rulesOf(file, text).includes("feedback-action-slot"), text);
  for (const text of [
    "<Alert action={{ label: t('Retry'), onClick: retry }} />",
    "<FailureState extra={<Button>Retry</Button>} />",
    "<SectionHeader action={<Button>Add</Button>} />",
  ])
    assert.ok(!rulesOf(file, text).includes("feedback-action-slot"), text);
  assert.ok(!rulesOf("src/shared/ui/View.tsx", "<Alert action={<Button />} />").length);
});

test("native-message-dialog flags Tauri message dialogs and window.alert outside the allowlist", () => {
  const file = "src/features/demo/model.ts";
  for (const text of [
    'import { message } from "@tauri-apps/plugin-dialog";',
    'import { open, ask as askUser } from "@tauri-apps/plugin-dialog";',
    "window.alert(text);",
  ])
    assert.ok(rulesOf(file, text).includes("native-message-dialog"), text);
  assert.ok(
    !rulesOf(file, 'import { open, save } from "@tauri-apps/plugin-dialog";').includes(
      "native-message-dialog",
    ),
  );
  for (const allowed of [
    "src/app/model/updater.ts",
    "src/app/model/appLifecycle.ts",
    "src/features/files/model/editorClose.ts",
  ])
    assert.ok(
      !rulesOf(allowed, 'import { ask } from "@tauri-apps/plugin-dialog";').includes(
        "native-message-dialog",
      ),
      allowed,
    );
});

test("hand-rolled-disclosure flags aria-expanded elements that wrap a Chevron", () => {
  const file = "src/features/demo/View.tsx";
  for (const text of [
    "<button aria-expanded={open} onClick={toggle}><ChevronRight /></button>",
    '<Button aria-expanded={open}><span>Title</span><ChevronDown className="x" /></Button>',
    "<div aria-expanded={open}><Row><ChevronDown /></Row></div>",
  ])
    assert.ok(rulesOf(file, text).includes("hand-rolled-disclosure"), text);
  for (const text of [
    "<button aria-expanded={open}>Menu</button><ChevronDown />",
    "<Button aria-expanded={open} />",
    "<div><ChevronDown /></div>",
  ])
    assert.ok(!rulesOf(file, text).includes("hand-rolled-disclosure"), text);
});

test("raw-native-control also flags switch, option and menuitem roles on raw elements", () => {
  for (const role of ["switch", "option", "menuitem"]) {
    assert.ok(
      rulesOf("src/features/demo/View.tsx", `<div role="${role}" />`).includes(
        "raw-native-control",
      ),
      role,
    );
    assert.ok(!rulesOf("src/shared/ui/View.tsx", `<div role="${role}" />`).length);
    assert.ok(!rulesOf("src/features/demo/View.tsx", `<Row role="${role}" />`).length);
  }
});

test("px and motion literal rules also cover Arc CSS modules", () => {
  const file = "src/shared/ui/arc/demo/demo.module.css";
  const css =
    ".a { font-size: 12px; border-radius: 6px; transition: opacity 120ms ease; z-index: 99; color: var(--missing); }";
  assert.deepEqual(rulesOf(file, css).sort(), ["motion-literal", "radius-size", "typography"]);
  assert.deepEqual(rulesOf(file, ".a { transition: opacity var(--motion-duration-fast); }"), []);
});

test("inline help guard flags exact repetition in known settings slots", () => {
  const imports =
    'import { Group, Row as SettingRow } from "@/shared/ui/settings"; import { Text as Copy } from "@/shared/ui/Text"; import { Field } from "@/shared/ui/Field"; import { InfoPopover } from "@/shared/ui/InfoPopover";';
  const help = '<Copy tone="secondary">{t("Mode")}</Copy>';
  const count = (source) =>
    rulesOf("src/features/demo/View.tsx", imports + source).filter(
      (rule) => rule === "inline-help-text",
    ).length;
  for (const source of [
    `<SettingRow label="Mode">${help}</SettingRow>`,
    `<Field label="Mode">${help}</Field>`,
    '<Group title={t("Mode")} description={t("Mode")} />',
    '<SettingRow label="Mode" description="Mode" />',
    "const View = ({ label }) => <Field label={label} description={label} />;",
  ])
    assert.equal(count(source), 1, source);
  for (const source of [
    `<Field label="Mode" description="${"Distinct detail ".repeat(12)}" />`,
    '<Field label="Mode" error="Mode" />',
    '<Field label="Mode" description={t("Changing mode restarts existing jobs.")} />',
    `<div>${help}</div>`,
    `<Field label="Mode"><div>${help}</div></Field>`,
    '<Field label="Mode"><Copy tone="danger">{t("Mode")}</Copy></Field>',
    '<Field label="Mode"><Copy tone="muted">{t(key)}</Copy></Field>',
    `<Field label="Mode"><InfoPopover>${help}</InfoPopover></Field>`,
    `<SettingRow label="Mode" info={${help}} />`,
    `<><h3>Mode</h3>${help}</>`,
    `<OtherRow>${help}</OtherRow>`,
    `<OtherRow label="Mode" description="Mode" />`,
    '<Field {...props} label="Mode" description="Mode" />',
    `const example = ${JSON.stringify(`<Field>${help}</Field>`)};`,
  ])
    assert.equal(count(source), 0, source);
  assert.equal(
    count(
      `<Field label="Mode">\n{/* ui-drift-ignore: inline-help-text -- required consequence */}\n${help}</Field>`,
    ),
    0,
  );
});

test("shared-internal-selector flags feature CSS that reaches into shared component internals", () => {
  const file = "src/features/demo/Demo.css";
  const flagged = (selector) =>
    rulesOf(file, `${selector} { display: flex; }`).includes("shared-internal-selector");
  for (const selector of [
    ".a .modal-panel > div:last-child",
    ".popover-open .x",
    ".popover",
    ":global(.settings-row) .x",
    ".settings-group-content > :first-child",
    '.nav [role="tablist"]',
    ".nav [role=tab]",
    "[data-slot='button']",
    "[data-button-size] svg",
    "[data-pane-header-heading]",
    ".x .bycoda-arc-select",
  ])
    assert.ok(flagged(selector), selector);
  for (const selector of [
    ".settings-card",
    ".popover-menu-demo",
    ".my-modal",
    ".bycoda-arc .x",
    ".x > div:last-child",
    "[data-wide] .nav",
  ])
    assert.ok(!flagged(selector), selector);
  // Shared and test code answer other rules; token-owning shared CSS is not feature CSS.
  assert.ok(!rulesOf("src/shared/ui/Demo.module.css", ".modal-panel { gap: 0; }").length);
  assert.ok(
    !rulesOf(
      file,
      "/* ui-drift-ignore: shared-internal-selector -- legacy */\n.modal-panel { gap: 0; }",
    ).includes("shared-internal-selector"),
  );
});

test("shared CSS-module slots report each visual declaration once", () => {
  const file = "src/features/demo/View.module.css";
  const tsxFile = "src/features/demo/View.tsx";
  const source = [
    'import { Button as Action } from "@/shared/ui/Button";',
    'import { Modal as Dialog } from "@/shared/ui/Modal";',
    'import { Button as Local } from "./Local";',
    'import styles from "./View.module.css";',
    'import other from "@/features/demo/Other.module.css";',
    "const dialogClass = styles.panel;",
    'const View = () => <><Action className={cn(styles.action, ready && styles["quiet"])} />',
    "<Dialog panelClassName={dialogClass} />",
    "<Local className={styles.local} />",
    "<Action className={compose(styles.unresolved)} />",
    "<Action className={other.action} /></>;",
  ].join("\n");
  const css = [
    ".action {",
    "  @apply flex min-w-0 mx-2;",
    "  margin-inline: 8px;",
    "  max-inline-size: 100%;",
    "  &:hover {",
    "    background: var(--ui-surface);",
    "  }",
    "  @media (width > 600px) {",
    "    padding-inline: 8px;",
    "  }",
    "}",
    ".quiet {",
    "  @apply font-medium;",
    "}",
    ".panel :global(.modal-panel) {",
    "  padding: 8px;",
    "}",
    ".panel :global(.vendor-owned) {",
    "  box-shadow: 0 0 0 1px currentColor;",
    "}",
    ".local, .unresolved, :global(.action), [data-name='.action'] { padding: 8px; }",
  ].join("\n");
  const other = "src/features/demo/Other.module.css";
  const definitions = collectDefinitions(
    new Map([
      [tsxFile, source],
      [file, css],
      [other, ".action { padding: 8px; }"],
      ["src/styles/index.css", ":root { --ui-surface: white; }"],
    ]),
  );
  assert.deepEqual(
    scanFile(file, css, definitions).map(({ rule, line }) => [rule, line]),
    [15, 6, 9, 13, 19].map((line) => ["shared-internal-selector", line]),
  );
  assert.deepEqual(
    scanFile(other, ".action { padding: 8px; }", definitions).map(({ rule }) => rule),
    ["shared-internal-selector"],
  );
  const unrelated = "src/features/demo/Unrelated.module.css";
  assert.deepEqual(scanFile(unrelated, ".action { padding: 8px; }", definitions), []);
});

test("specificity-doubling flags .x.x and leaves distinct compound classes alone", () => {
  const file = "src/features/demo/Demo.module.css";
  const flagged = (selector) =>
    rulesOf(file, `${selector} { gap: 0; }`).includes("specificity-doubling");
  assert.ok(flagged(".row.row"));
  assert.ok(flagged(".a .row.row > .b"));
  assert.ok(flagged(".row-x.row-x:hover"));
  assert.ok(!flagged(".row.rowTwo"));
  assert.ok(!flagged(".row.row-x"));
  assert.ok(!flagged(".a.b"));
  assert.ok(!flagged(".row .row"));
});

test("feature typography replaces the generic typography scanner and preserves Arc ownership", () => {
  const found = (file, source) =>
    scanFile(file, source, collectDefinitions(new Map([[file, source]]))).map(({ rule }) => rule);
  const file = "src/features/demo/Demo.module.css";
  assert.deepEqual(found(file, ".a { font-size: 0.6875rem; line-height: 1.45; }"), [
    "feature-typography",
    "feature-typography",
  ]);
  assert.deepEqual(found(file, ".a { font-size: inherit; line-height: normal; }"), []);
  assert.deepEqual(found("src/features/demo/Demo.tsx", '<Text className="text-[0.75rem]" />'), [
    "feature-typography",
  ]);
});

test("radius-size reads rem lengths and preserves semantic or zero values", () => {
  const file = "src/features/demo/Demo.module.css";
  assert.ok(rulesOf(file, ".a { border-radius: 0.5rem; }").includes("radius-size"));
  assert.ok(rulesOf(file, ".a { border-top-left-radius: 1rem 2px; }").includes("radius-size"));
  assert.ok(!rulesOf(file, ".a { border-radius: 0; }").includes("radius-size"));
  assert.ok(!rulesOf(file, ".a { border-radius: var(--ui-radius-card); }").includes("radius-size"));
  assert.ok(
    rulesOf("src/features/demo/Demo.tsx", '<i className="h-[2rem] w-[10px]" />').includes(
      "radius-size",
    ),
  );
});

test("transcript-base-ink owns the --transcript-ink-* and --transcript-surface-* definitions", () => {
  const ink = (file, text) => rulesOf(file, text).includes("transcript-base-ink");
  const roles = ".a { --transcript-ink-body: var(--ui-text-secondary); }";
  assert.ok(ink("src/features/sessions/ui/Transcript.css", roles));
  assert.ok(
    ink(
      "src/styles/index.css",
      `${indexCss}
:root { --transcript-surface-fill: red; }`,
    ),
  );
  assert.ok(!ink("src/styles/transcript-surface.css", `:root { --transcript-ink-body: red; }`));
});

test("transcript-assistant-surface and transcript-reply-fill guard the transcript surface", () => {
  const file = "src/features/sessions/ui/AgentTranscriptActivity.tsx";
  const rules = (text, name = file) => rulesOf(name, text);
  assert.ok(
    rules('<div data-chat-message-surface="assistant">x</div>').includes(
      "transcript-assistant-surface",
    ),
  );
  assert.ok(
    !rules('<div data-chat-message-surface="user">x</div>').includes(
      "transcript-assistant-surface",
    ),
  );
  assert.ok(
    rules('<div className="p-2 bg-(--ui-surface)">x</div>').includes("transcript-reply-fill"),
  );
  assert.ok(rules('<div className="backdrop-blur-sm">x</div>').includes("transcript-reply-fill"));
  assert.ok(
    !rules('<div data-transcript-reply className="bg-(--ui-surface)">x</div>').includes(
      "transcript-reply-fill",
    ),
  );
  assert.ok(!rules('<div className="bg-transparent">x</div>').includes("transcript-reply-fill"));
  assert.ok(
    !rules('<div className="bg-(--ui-surface)">x</div>', "src/features/chat/ui/X.tsx").includes(
      "transcript-reply-fill",
    ),
  );
});

test("transcript-base-ink flags content-base text color in transcript CSS only", () => {
  const sessions = "src/features/sessions/ui/Transcript.css";
  const ink = (file, text) => rulesOf(file, text).includes("transcript-base-ink");
  assert.ok(ink(sessions, ".a { color: var(--color-content); }"));
  assert.ok(
    ink(sessions, ".a { color: color-mix(in srgb, var(--color-content) 70%, transparent); }"),
  );
  assert.ok(!ink(sessions, ".a { color: var(--ui-text-secondary); }"));
  assert.ok(!ink(sessions, ".a { border-color: var(--color-content); }"));
  assert.ok(!ink("src/features/files/ui/Files.css", ".a { color: var(--color-content); }"));
  const styles = "src/styles/index.css";
  const sheet = (selector) => `${indexCss}\n${selector} { color: var(--color-content); }`;
  for (const selector of [
    ".agent-markdown p",
    '[data-chat-message-surface="user"]',
    ".transcript-row",
  ])
    assert.ok(ink(styles, sheet(selector)), selector);
  assert.ok(!ink(styles, sheet(".sidebar-title")));
  assert.ok(
    !ink(styles, `${indexCss}\n:root { --x: var(--color-content); color: var(--color-content); }`),
  );
});

test("role-status-banner flags tone-styled status regions only", (t) => {
  const root = mkdtempSync(join(tmpdir(), "bycoda-ui-status-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = "src/features/demo/A.tsx";
  mkdirSync(dirname(join(root, file)), { recursive: true });
  mkdirSync(join(root, "src/styles"), { recursive: true });
  writeFileSync(join(root, "src/styles/arc.css"), arcCss);
  writeFileSync(
    join(root, file),
    [
      '<div role="status" className="rounded text-(--ui-tone-danger-fg)" />',
      '<p role="status" className={styles.notice} />',
      '<span role="status" className="sr-only" />',
      '<div role="status" aria-live="polite" />',
      '<div className="text-(--ui-tone-danger-fg)" />',
      "",
    ].join("\n"),
  );
  mkdirSync(dirname(join(root, baselineFile)), { recursive: true });
  writeFileSync(join(root, baselineFile), JSON.stringify({ schemaVersion: 1, counts: {} }));
  const result = checkUiDrift({ root });
  assert.deepEqual(
    result.regressions
      .filter(({ rule }) => rule === "role-status-banner")
      .map(({ baseline, count }) => [baseline, count]),
    [[0, 2]],
  );
});

test("pane-edge-erased flags CSS that hides the edge between workbench panes", () => {
  const file = "src/features/demo/Demo.css";
  const flagged = (css) => rulesOf(file, css).includes("pane-edge-erased");
  assert.ok(flagged(".bycoda-sidebar { border-inline-end-color: transparent; }"));
  assert.ok(flagged(".bycoda-project-rail { border-right: none; }"));
  assert.ok(flagged('[data-side-pane="workspace"] { border-inline-end-width: 0; }'));
  assert.ok(flagged('.x [data-surface-frame="pane"] { border: 0; }'));
  assert.ok(!flagged(".bycoda-sidebar { border-inline-end-color: var(--ui-pane-border); }"));
  assert.ok(!flagged(".card { border-right: none; }"));
  assert.ok(!flagged(".bycoda-sidebar { background: transparent; }"));
});
