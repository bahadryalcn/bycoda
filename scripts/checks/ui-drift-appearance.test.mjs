import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { collectDefinitions, rules, scanFile } from "./check-ui-drift.mjs";
import {
  appearanceRules,
  bespokeParts,
  bespokeSurfaces,
  classRanges,
  isBespokePart,
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

test("theme specimens retain paint without exempting their surrounding controls", () => {
  const cases = [
    [
      "appearance/controls/GradientStrip.module.css",
      ".gradient",
      "background-image: var(--gradient-image)",
    ],
    [
      "appearance/controls/GradientStrip.module.css",
      ".presetDot",
      "background-image: var(--gradient-image)",
    ],
    [
      "appearance/controls/StateLadder.css",
      ".state-preview-row:hover",
      "background: var(--ui-surface-hover)",
    ],
    [
      "appearance/controls/StateLadder.css",
      ".state-preview-row:active",
      "background: var(--ui-surface-pressed)",
    ],
    ["AppearanceSettings.css", ".appearance-tone", "background: var(--palette-base)"],
    ["AppearanceSettings.css", ".appearance-tone > i", "background: var(--palette-raised)"],
    [
      "AppearanceSettings.css",
      ".appearance-tone::after",
      "border-radius: var(--ui-control-radius)",
    ],
    ["AppearanceSettings.css", ".appearance-tone > b", "background: var(--palette-accent)"],
    [
      "appearance/controls/ToneSliders.css",
      '.tone-step[data-step="base"] > .tone-swatch',
      "background: var(--color-background-base)",
    ],
    [
      "appearance/controls/ToneSliders.css",
      '.tone-step[data-step="surface"] > .tone-swatch',
      "background: var(--ui-surface)",
    ],
    [
      "appearance/controls/ToneSliders.css",
      '.tone-step[data-step="line"] > .tone-swatch',
      "background: var(--ui-pane-border)",
    ],
    [
      "appearance/controls/ToneSliders.css",
      '.tone-step[data-step="selected"] > .tone-swatch',
      "background: var(--ui-surface-selected)",
    ],
    [
      "appearance/controls/InterfaceSections.css",
      ".diff-swatch-bars > span:first-child",
      "background: var(--swatch-add)",
    ],
    [
      "appearance/controls/InterfaceSections.css",
      ".diff-swatch-bars > span:last-child",
      "background: var(--swatch-del)",
    ],
    [
      "appearance/controls/GradientStrip.module.css",
      ".needle::before",
      "background: var(--color-content); border-radius: var(--radius-pill)",
    ],
    [
      "appearance/controls/StateLadder.css",
      '.state-preview-row[data-state="hover"]',
      "background: var(--ui-surface-hover)",
    ],
    [
      "appearance/controls/StateLadder.css",
      '.state-preview-row[data-state="pressed"]',
      "background: var(--ui-surface-pressed)",
    ],
  ];
  for (const [path, selector, declaration] of cases) {
    const file = `src/features/settings/ui/${path}`;
    assert.deepEqual(css(`${selector} { ${declaration}; }`, file), [], selector);
    assert.ok(css(`${selector} button { border: 1px solid var(--x); }`, file).length > 0);
    assert.ok(css(`${selector} { ${declaration}; }`, "src/features/demo/Demo.css").length > 0);
  }
  for (const selector of [
    ".appearance-tone:hover",
    ".appearance-tone:focus-visible",
    ".appearance-mode-button",
  ])
    assert.ok(
      css(
        `${selector} { background: var(--x); }`,
        "src/features/settings/ui/AppearanceSettings.css",
      ).length > 0,
    );
  assert.ok(
    css(
      '.tone-step[data-step="custom"] > .tone-swatch { background: var(--x); }',
      "src/features/settings/ui/appearance/controls/ToneSliders.css",
    ).includes("surface-style"),
  );
});

test("sheet zoom typography belongs only to the document viewport", () => {
  const file = "src/features/files/ui/SheetGridView.css";
  assert.deepEqual(
    css(".sheet-document-viewport { font-size: var(--document-font-size); }", file),
    [],
  );
  assert.ok(
    css(".sheet-document-viewport { font-size: var(--x); }", file).includes("feature-typography"),
  );
  for (const part of ["header", "row-header", "cell"]) {
    const selector = `.sheet-document-${part}[data-size="inherit"][data-leading="inherit"]`;
    assert.deepEqual(css(`${selector} { line-height: var(--document-row-height); }`, file), []);
    assert.ok(css(`${selector} { font-size: var(--x); }`, file).includes("feature-typography"));
    assert.ok(
      css(`${selector} button { line-height: var(--document-row-height); }`, file).includes(
        "feature-typography",
      ),
    );
  }
  for (const selector of [
    ".sheet-document-viewport button",
    ".sheet-document-viewport:hover",
    ".sheet-toolbar",
  ])
    assert.equal(
      isBespokePart(file, "feature-typography", {
        selectors: [selector],
        text: "font-size:var(--document-font-size)",
      }),
      false,
    );
  assert.ok(
    css(".sheet-document-viewport { font-size: var(--x); }").includes("feature-typography"),
  );
  assert.equal(
    isBespokePart(file, "surface-style", { selectors: [".sheet-document-viewport"] }),
    false,
  );
});

test("usage data marks retain chart paint without exempting adjacent controls or states", () => {
  const file = "src/features/usage/ui/UsageAnalytics.css";
  for (const selector of [
    ".usage-rank-track > span",
    ".usage-quota-point",
    ".usage-week-grid .usage-hour-cell",
    '.usage-week-grid .usage-hour-cell[data-level="4"]',
    ".usage-heat-legend > i",
    '.usage-heat-legend > i[data-level="2"]',
  ]) {
    const source = `${selector} { background: var(--x); border-radius: 2px; }`;
    assert.deepEqual(css(source, file), [], selector);
    assert.ok(css(source).includes("surface-style"), selector);
    assert.equal(isBespokePart(file, "interaction-state", { selectors: [selector] }), false);
  }
  for (const selector of [
    ".usage-hour-cell",
    ".usage-week-grid .usage-hour-cell:hover",
    ".usage-week-grid .usage-hour-cell:focus-visible",
    ".usage-heat-legend > button",
    ".usage-quota-point button",
    ".usage-account-row",
  ])
    assert.ok(css(`${selector} { background: var(--x); }`, file).length > 0, selector);
});

test("voice input level segments retain data paint without exempting controls", () => {
  const file = "src/features/voice/ui/companion/VoiceCompanionParts.module.css";
  for (const selector of [".meter > i", ".meter > i[data-on]"]) {
    assert.deepEqual(
      css(`${selector} { background: var(--x); border-radius: var(--x); }`, file),
      [],
    );
    assert.equal(isBespokePart(file, "interaction-state", { selectors: [selector] }), false);
  }
  for (const selector of [".meter", ".meter > button", ".meter > i:hover", ".meter > i span"])
    assert.ok(css(`${selector} { background: var(--x); }`, file).length > 0);
  assert.ok(css(".meter > i { background: var(--x); }").includes("surface-style"));
});

test("conflict document decorations and their matching legend retain domain ink", () => {
  const file = "src/features/source-control/ui/conflict-layout.css";
  for (const selector of [
    ".conflict-side-dot",
    ".conflict-source-change",
    ".conflict-source-word",
    ".conflict-result-pending",
    ".conflict-result-resolved",
    '.conflict-result-pending[data-merge-active="true"]',
    '.conflict-result-resolved[data-merge-active="true"]',
  ]) {
    const rule = `${selector} { background: var(--conflict-highlight); border-radius: 2px; }`;
    assert.deepEqual(css(rule, file), [], selector);
    assert.ok(css(rule).includes("surface-style"), selector);
  }
  assert.ok(
    css(".conflict-side-dot button { background: var(--conflict-highlight); }", file).includes(
      "surface-style",
    ),
  );
  assert.equal(
    isBespokePart(file, "feature-typography", { selectors: [".conflict-source-change"] }),
    false,
  );
});

test("control sizing applies to the selected element, not its control ancestor", () => {
  assert.deepEqual(
    css(".tabs > button svg { height: 14px; } .row button > span { min-height: 14px; }"),
    [],
  );
  assert.deepEqual(
    css(".tabs > button { height: 28px; } .row svg, .row button { min-height: 28px; }"),
    ["fixed-control-size", "fixed-control-size"],
  );
});

test("generated pseudo-element type and disabled motion are not hierarchy or motion", () => {
  assert.deepEqual(
    css(
      ".x::placeholder { color: var(--x); } .x::before { font-size: .85em; } .x { animation: none; transition: none; }",
    ),
    [],
  );
  assert.deepEqual(tsx('<span className="motion-reduce:animate-none" />'), []);
  assert.deepEqual(css(".real, .real::before { color: var(--x); }"), ["feature-typography"]);
  assert.deepEqual(
    css(
      ".app-search-footer kbd { font: inherit; color: var(--x); }",
      "src/features/search/ui/search.css",
    ),
    ["feature-typography"],
  );
  assert.deepEqual(css(".x { color: var(--x); animation: pulse 1s; }"), [
    "feature-typography",
    "feature-motion",
  ]);
  assert.deepEqual(tsx('<span className="motion-safe:animate-pulse" />'), []);
});

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
  // A class handed to a shared role helper is still read; the roles object is not.
  const helper =
    '<div {...surfaceAttributes({ frame: "card", radius: "card" }, "rounded-full p-2")} />';
  const [range] = classRanges(helper);
  assert.equal(helper.slice(range[0], range[1]).includes("rounded-full"), true);
  assert.equal(helper.slice(range[0], range[1]).includes("frame"), false);
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
        ".g { gap: 2px; padding: 32px 40px; margin-block: 3rem; }",
      ].join("\n"),
    ),
    Array(4).fill("spacing-step"),
  );
  assert.deepEqual(
    tsx(
      '<div className="gap-1.5 p-2 px-5 -mt-2 gap-x-3.5 md:py-6 gap-0.5 py-10 px-8 mt-12 p-[var(--space-2)] p-(--space-2) gap-[10%]" />',
    ),
    [],
  );
  assert.deepEqual(tsx('<div className="m-px gap-7 md:px-9" />'), Array(3).fill("spacing-step"));
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

test("a bespoke part exempts only what it names inside an ordinary file", () => {
  for (const part of bespokeParts) {
    assert.equal(fs.existsSync(part.file), true, part.file);
    assert.equal(isBespokeSurface(part.file), false, `${part.file} is already a whole-file entry`);
    assert.match(part.reason, /\S/, part.file);
    assert.equal(/[A-Z]/.test(part.reason[0]) && part.reason.endsWith("."), true, part.file);
  }
  // A selector entry skips its rule and nothing else in the file.
  const chat = "src/features/sessions/ui/chat-controls.css";
  assert.deepEqual(
    css(
      [
        ".queue-departure { animation: queue-departure 1s; }",
        "@keyframes queue-departure { to { opacity: 0; } }",
        ".other { animation: spin 1s; font-size: var(--x); }",
        ".queue-departure { color: red; }",
      ].join("\n"),
      chat,
    ),
    ["feature-motion", "feature-typography", "feature-typography"],
  );
  // A named rule list leaves the other rules of the same selector counted.
  assert.deepEqual(
    css(
      ".dismiss { transition: opacity 1s; color: red; }",
      "src/app/shell/GithubStarPrompt.module.css",
    ),
    ["feature-typography"],
  );
  // Without a selector or token an entry covers its rules in the whole file only.
  assert.deepEqual(
    tsx(
      '<i className="transition-all rounded-md" />',
      "src/features/sessions/ui/PromptOutline.tsx",
    ),
    ["surface-style"],
  );
  // A token entry matches the whole class word, in CSS and in class lists.
  const chip = "src/features/sessions/ui/AttachmentChip.module.css";
  assert.deepEqual(
    css(".a { color: var(--chip-ink); } .b { color: var(--chip-ink-soft); }", chip),
    ["feature-typography"],
  );
  assert.deepEqual(
    tsx(
      '<i className="text-skill hover:text-skill text-skills" />',
      "src/features/sessions/ui/SkillTokenText.tsx",
    ),
    ["interaction-state", "feature-typography"],
  );
  // The same class elsewhere is not exempt.
  assert.deepEqual(tsx('<i className="text-skill" />'), ["feature-typography"]);
});

test("bespoke surfaces, shared UI and suppressed lines are outside the appearance rules", () => {
  const text = ".a { color: red; border: 0; }";
  for (const file of bespokeSurfaces) assert.equal(fs.existsSync(file), true, file);
  assert.equal(isBespokeSurface("src/features/terminal/ui/terminal.css"), true);
  assert.equal(isBespokeSurface("src/features/host-tools/runtime-logs.css"), true);
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

test("browser inspector geometry paint does not exempt controls or focus states", () => {
  const boxFile = "src/features/host-tools/BrowserPanel.css";
  const highlightFile = "src/features/host-tools/browser-annotation.css";
  for (const selector of [
    ".host-browser-box-model",
    '.host-browser-box-model[data-part="margin"]',
    '.host-browser-box-model[data-part="padding"]',
    ".host-browser-child-bound",
  ])
    assert.deepEqual(
      css(`${selector} { border: 1px dashed var(--ui-tone-info-fg); }`, boxFile),
      [],
    );
  for (const selector of [
    ".host-browser-highlight",
    '.host-browser-highlight[data-selected="true"]',
  ])
    assert.deepEqual(
      css(
        `${selector} { border: 2px solid var(--ui-tone-accent-solid); background: var(--ui-annotation-highlight); }`,
        highlightFile,
      ),
      [],
    );
  for (const selector of [
    ".host-browser-highlight:hover",
    ".host-browser-highlight button",
    ".host-browser-highlight-label",
    ".host-browser-surface img:focus-visible",
  ])
    assert.ok(
      css(`${selector} { border: 1px solid var(--x); }`, highlightFile).includes(
        selector.includes(":") ? "interaction-state" : "surface-style",
      ),
    );
  assert.ok(
    css(".host-browser-box-model { border: 1px solid var(--x); }", highlightFile).includes(
      "surface-style",
    ),
  );
  assert.ok(
    css(".host-browser-highlight { border: 1px solid var(--x); }", boxFile).includes(
      "surface-style",
    ),
  );
});

test("family recipes use Badge, ProgressBar, Tabs and SegmentedControl", () => {
  assert.deepEqual(tsx('<span className="project-badge" />'), []);
  assert.deepEqual(tsx('<div className="progress-fill" />'), []);
  assert.ok(tsx('<nav className="project-tab-bar" />').includes("interaction-state"));
  assert.ok(tsx('<div className="segmented-row" />').includes("interaction-state"));
  assert.deepEqual(tsx("<Badge /><ProgressBar /><Tabs /><SegmentedControl />"), []);
});

test("class expressions exclude identifiers while retaining painted literal branches", () => {
  assert.deepEqual(tsx('<span className={`icon-sm ${badge != null ? "ml-4" : ""}`} />'), []);
  assert.deepEqual(tsx('<span className={`icon-sm ${border ? "bg-red-500" : "rounded-sm"}`} />'), [
    "surface-style",
    "surface-style",
  ]);
  assert.deepEqual(tsx('<span className={border ? "border" : "shadow"} />'), [
    "surface-style",
    "surface-style",
  ]);
  assert.deepEqual(css(".workspace-tab-badge { display: contents; }"), []);
  assert.deepEqual(
    css(
      ".project-badge { background: red; border-radius: 4px; } .progress-fill { background: blue; }",
    ),
    ["surface-style", "surface-style"],
  );
});
