import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { collectDefinitions, rules, scanFile } from "./check-ui-drift.mjs";
import {
  appearanceRules,
  bespokeSurfaces,
  classRanges,
  isBespokeSurface,
} from "./ui-drift-appearance.mjs";

const definitions = collectDefinitions(new Map([["src/styles/index.css", ":root { --x: 1; }"]]));
const owned = new Set([...Object.keys(appearanceRules), "fixed-control-size"]);
/** Appearance findings only, in source order. */
const found = (file, text) =>
  scanFile(file, text, definitions)
    .map((finding) => finding.rule)
    .filter((rule) => owned.has(rule));
const css = (text, file = "src/features/demo/Demo.module.css") => found(file, text);
const tsx = (text, file = "src/features/demo/Demo.tsx") => found(file, text);

test("every appearance rule is listed with the other UI drift rules", () => {
  for (const rule of Object.keys(appearanceRules)) assert.equal(rules[rule], appearanceRules[rule]);
});

test("layout stays free in feature CSS and classes", () => {
  assert.deepEqual(
    css(
      ".a { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin: 0 auto; inline-size: 100%; overflow: hidden; align-items: center; padding: 12px 16px; }",
    ),
    [],
  );
  assert.deepEqual(
    tsx('<div className="grid min-w-0 flex-1 items-center gap-2 overflow-hidden p-4 mt-6" />'),
    [],
  );
});

test("type, surface, truncation, motion and scrollbar declarations are reported once each", () => {
  assert.deepEqual(
    css(
      [
        ".a { font-size: var(--x); line-height: 1.4; letter-spacing: 0; color: red; }",
        ".b { border: 1px solid; border-radius: var(--x); background: none; box-shadow: none; outline: 1px solid; }",
        ".c { text-overflow: ellipsis; -webkit-line-clamp: 2; }",
        ".d { transition: opacity var(--x); animation-name: spin; }",
        ".e { scrollbar-width: thin; }",
        ".e::-webkit-scrollbar { inline-size: 6px; }",
        ".f { border-collapse: collapse; background-clip: padding-box; }",
      ].join("\n"),
    ),
    [
      ...Array(4).fill("feature-typography"),
      ...Array(5).fill("surface-style"),
      ...Array(2).fill("text-truncation"),
      ...Array(2).fill("feature-motion"),
      ...Array(2).fill("scrollbar-style"),
    ],
  );
});

test("a state block is one kind of finding, whatever it sets", () => {
  assert.deepEqual(
    css(
      ".row:hover { background: var(--x); color: red; }\n.row:focus-visible { outline: 0; }\n.row[aria-selected='true'] { opacity: 1; }",
    ),
    Array(4).fill("interaction-state"),
  );
  assert.deepEqual(
    tsx('<div className="hover:bg-(--x) md:focus-visible:ring-2 group-hover:flex" />'),
    ["interaction-state", "interaction-state"],
  );
});

test("a literal value that a narrower rule reports is not reported twice", () => {
  const rulesOf = (file, text) => scanFile(file, text, definitions).map((finding) => finding.rule);
  assert.deepEqual(rulesOf("src/features/demo/Demo.module.css", ".a { font-size: 13px; }"), [
    "typography",
  ]);
  assert.deepEqual(rulesOf("src/features/demo/Demo.tsx", '<p className="text-sm font-bold" />'), [
    "typography",
    "font-weight",
  ]);
});

test("classes are read from class lists only", () => {
  assert.deepEqual(
    tsx(
      [
        '<Surface variant="outline" border={border} />',
        "const shadow = transition ? rounded : truncate;",
        '<p className="text-content-muted leading-5 truncate rounded-md border bg-(--x) shadow-sm" />',
        'const rowClass = active ? "font-medium" : "text-left";',
        '<Row labelClassName="tracking-wide transition-colors duration-200 scrollbar-thin" />',
      ].join("\n"),
    ),
    [
      "feature-typography",
      "feature-typography",
      "text-truncation",
      "surface-style",
      "surface-style",
      "surface-style",
      "surface-style",
      "feature-typography",
      "feature-typography",
      "feature-motion",
      "feature-motion",
      "scrollbar-style",
    ],
  );
  assert.equal(classRanges('<a className="x" /> <b title="border" />').length, 1);
});

test("class-joining calls are class lists whatever the result is named", () => {
  assert.deepEqual(
    tsx(
      [
        'const rowStyle = cn("border rounded-md", active && "font-medium");',
        'const tone = clsx({ "bg-(--x)": active });',
        '<p className={cn("truncate", rowStyle)} />',
        'const label = join("border rounded-md");',
      ].join("\n"),
    ),
    ["feature-typography", "surface-style", "surface-style", "surface-style", "text-truncation"],
  );
  assert.equal(classRanges('<p className={cn("a", b)} />').length, 1);
});

test("spacing reports only a literal off the scale; tokens are always free", () => {
  assert.deepEqual(
    css(
      [
        ".a { gap: 6px; padding: 8px 10px; margin-block-start: 0.5rem; margin: -4px 0 auto; }",
        ".b { padding-inline: var(--space-2); gap: calc(var(--space-1) + 1px); margin: 10% 2em; }",
        ".c { gap: 7px; }",
        ".d { padding: var(--space-2) 5px; }",
        ".e { margin-top: 0.3rem; }",
        ".f { padding: 18px !important; }",
      ].join("\n"),
    ),
    Array(4).fill("spacing-step"),
  );
  assert.deepEqual(
    tsx(
      '<div className="gap-1.5 p-2 px-5 -mt-2 gap-x-3.5 md:py-6 p-[var(--space-2)] p-(--space-2) gap-[10%]" />',
    ),
    [],
  );
  assert.deepEqual(tsx('<div className="m-px gap-7 md:px-0.5" />'), Array(3).fill("spacing-step"));
  // An arbitrary length stays with the narrower rule and is not reported twice.
  assert.deepEqual(
    scanFile("src/features/demo/Demo.tsx", '<div className="p-[7px]" />', definitions).map(
      (finding) => finding.rule,
    ),
    ["arbitrary-spacing"],
  );
});

test("a control takes its size from the size prop, in classes and in CSS", () => {
  assert.deepEqual(
    tsx(
      [
        '<Button className="h-7 w-full" />',
        '<TextField className="px-2" />',
        '<Button className="w-full shrink-0" />',
        '<div className="h-7 px-2" />',
      ].join("\n"),
    ),
    ["fixed-control-size", "fixed-control-size"],
  );
  assert.deepEqual(
    css(
      '.a button { min-height: 28px; }\n.b [role="button"] { block-size: 2rem; }\n.c { height: 28px; }\n.d input { inline-size: 100%; }',
    ),
    ["fixed-control-size", "fixed-control-size"],
  );
});

test("an inline style carries custom properties only", () => {
  assert.deepEqual(
    tsx(
      [
        '<div style={{ "--row-height": `${height}px`, ["--depth"]: depth }} />',
        "<div style={{ color: tone }} />",
        "<div style={{ ...position, opacity }} />",
        '<div style={{ "background": fill }} />',
        "<div style={style} />",
      ].join("\n"),
    ),
    ["inline-style-property", "inline-style-property", "inline-style-property"],
  );
});

test("bespoke surfaces, shared UI and suppressed lines are outside the appearance rules", () => {
  const text = ".a { color: red; border: 0; }";
  for (const file of bespokeSurfaces) assert.equal(fs.existsSync(file), true, file);
  assert.equal(isBespokeSurface("src/features/terminal/ui/terminal.css"), true);
  assert.equal(isBespokeSurface("src/features/sessions/ui/Composer.tsx"), true);
  // A control that sits next to a bespoke surface is ordinary: no match by a word in the name.
  for (const file of [
    "src/features/source-control/ui/DiffLayoutToggle.tsx",
    "src/features/source-control/ui/DiffCommentComposer.tsx",
    "src/features/sessions/ui/MarkdownModeToggle.tsx",
    "src/features/sessions/ui/TranscriptFind.tsx",
    "src/features/sessions/ui/TranscriptSelectionMenu.tsx",
    "src/features/sessions/ui/TranscriptMessageActions.tsx",
    "src/features/settings/ui/appearance/controls/CanvasBackgroundRow.tsx",
    "src/features/terminal/ui/TerminalTools.tsx",
  ])
    assert.equal(isBespokeSurface(file), false, file);
  assert.equal(isBespokeSurface("src/features/tasks/ui/TaskRow.module.css"), false);
  assert.deepEqual(css(text, "src/features/terminal/ui/terminal.css"), []);
  assert.deepEqual(css(text, "src/shared/ui/Surface.module.css"), []);
  assert.deepEqual(css(text, "src/styles/index.css"), []);
  assert.deepEqual(
    css(
      ".a {\n  /* ui-drift-ignore: feature-typography -- status ink set by the caller */\n  color: red;\n}",
    ),
    [],
  );
});
