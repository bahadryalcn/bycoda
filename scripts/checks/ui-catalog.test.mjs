import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  findOrphanComponents,
  catalogFindings,
  readUiCatalog,
  readUiCatalogSource,
  renderUiCatalog,
  runUiCatalog,
  validateUiCatalog,
} from "./ui-catalog.mjs";

const source = `
/**
 * Shows details.
 * @group layout
 * @use Show or hide detail
 * @avoid Switching views: Tabs
 * @replaces details summary
 * @arc expandable-card
 */
export function Disclosure() { return <details />; }
/**
 * Old one.
 * @group layout
 * @use Pick
 * @avoid Never
 * @status deprecated
 */
export const Legacy = forwardRef(() => <div />);
/**
 * Part.
 * @status internal
 */
export const Part = () => <i />;
export const MAX_ITEMS = 3;
export interface Props {}
export function helper() {}
`;

test("parses tags and skips non-components", () => {
  const entries = readUiCatalogSource("src/shared/ui/A.tsx", source);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["Disclosure", "Legacy", "Part"],
  );
  assert.deepEqual(entries[0].replaces, ["details", "summary"]);
  assert.equal(entries[0].arc, "expandable-card");
  assert.equal(entries[0].summary, "Shows details.");
  assert.equal(entries[1].status, "deprecated");
  assert.equal(entries[0].status, "stable");
});

test("validation flags missing, deprecated and duplicate metadata", () => {
  const entries = readUiCatalogSource("src/shared/ui/A.tsx", source);
  entries.push({ ...entries[0], name: "Other", replaces: ["summary", "Bad"], instead: "Nope" });
  const messages = validateUiCatalog(entries).map((item) => `${item.name}: ${item.problem}`);
  assert.ok(messages.includes("Legacy: deprecated without @instead"));
  assert.ok(messages.some((message) => message.includes('"summary" is also claimed')));
  assert.ok(messages.includes('Other: invalid @replaces token "Bad"'));
  assert.ok(messages.includes('Other: @instead names unknown component "Nope"'));
  assert.ok(messages.includes("Part: missing @group"));
  assert.ok(messages.includes("Part: missing @use"));
  const bare = readUiCatalogSource("x.tsx", "export function Bare() { return null; }");
  assert.equal(validateUiCatalog(bare).length, 4);
});

test("typed native picker replacements coexist with generic input ownership", () => {
  const base = readUiCatalogSource("src/shared/ui/A.tsx", source)[0];
  const entries = [
    "input",
    "input[type=date]",
    "input[type=time]",
    "input[type=datetime-local]",
  ].map((token, index) => ({ ...base, name: `Picker${index}`, replaces: [token] }));
  assert.ok(
    !validateUiCatalog(entries).some((problem) => problem.problem.includes("invalid @replaces")),
  );
  assert.match(renderUiCatalog(entries), /`input\[type=time\]`/);
  assert.ok(
    validateUiCatalog([{ ...base, replaces: ["input[type=text]"] }]).some((problem) =>
      problem.problem.includes("invalid @replaces"),
    ),
  );
});

test("render escapes pipes, lists parts and deprecated components", () => {
  const entries = readUiCatalogSource("src/shared/ui/A.tsx", source);
  entries[0].avoid = "a | b";
  entries[1].instead = "Disclosure";
  const markdown = renderUiCatalog(entries);
  assert.match(markdown, /## Layout/);
  assert.match(markdown, /\[Disclosure\]\(\.\.\/\.\.\/src\/shared\/ui\/A\.tsx\)/);
  assert.match(markdown, /a \\\| b/);
  assert.match(markdown, /Parts: Part/);
  assert.match(markdown, /## Deprecated[\s\S]*\| \[Legacy\].*\| Disclosure \|/);
});

test("runUiCatalog writes, then reports fresh, tolerating CRLF", () => {
  const root = mkdtempSync(join(tmpdir(), "ui-catalog-"));
  try {
    mkdirSync(join(root, "src/shared/ui"), { recursive: true });
    writeFileSync(join(root, "src/shared/ui/A.tsx"), source);
    writeFileSync(join(root, "src/shared/ui/A.test.tsx"), "export function Skip() {}");
    assert.equal(readUiCatalog(root).length, 3);
    assert.equal(runUiCatalog({ root }).stale, true);
    runUiCatalog({ root, write: true });
    assert.equal(runUiCatalog({ root }).stale, false);
    const file = join(root, "docs/reference/ui-components.md");
    writeFileSync(file, readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
    assert.equal(runUiCatalog({ root }).stale, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("internal parts render under their own group table and ungrouped parts stay apart", () => {
  const part = (name, group) =>
    `/**\n * ${name}.\n * @status internal\n${group ? ` * @group ${group}\n` : ""} */\nexport const ${name} = () => <i />;\n`;
  const grouped = readUiCatalogSource(
    "src/shared/ui/B.tsx",
    `/**\n * Main.\n * @group data\n * @use u\n * @avoid a\n */\nexport function Main() { return null; }\n${part("MainItem", "data")}${part("Loose", "")}`,
  );
  assert.equal(grouped.find((entry) => entry.name === "MainItem").group, "data");
  assert.ok(
    validateUiCatalog(grouped).some(
      (problem) => problem.name === "Loose" && problem.problem === "missing @group",
    ),
  );
  const markdown = renderUiCatalog(grouped);
  assert.match(markdown, /## Data[\s\S]*Parts: MainItem\n[\s\S]*## Ungrouped\n\nParts: Loose/);
});

test("each family member must name a sibling in avoid or replaces", () => {
  const base = readUiCatalogSource("src/shared/ui/A.tsx", source)[0];
  const entries = [
    { ...base, name: "Alpha", avoid: "Beta", replaces: [] },
    { ...base, name: "Beta", avoid: "Alpha", replaces: [] },
  ];
  assert.deepEqual(validateUiCatalog(entries), []);
  entries[1].avoid = "Unrelated";
  assert.ok(
    validateUiCatalog(entries).some(
      (problem) => problem.name === "Beta" && problem.rule === "component-family-choice",
    ),
  );
  entries[1].replaces = ["Alpha"];
  assert.deepEqual(validateUiCatalog(entries), []);
});

test("orphan detection resolves named aliases, namespaces, reexports and lazy imports", () => {
  const base = readUiCatalogSource("src/shared/ui/A.tsx", source)[0];
  const entries = [
    { ...base, name: "Alpha" },
    { ...base, name: "Beta" },
  ];
  const sources = new Map([
    ["src/features/demo/View.tsx", 'import { Alpha as Local } from "@/shared/ui/A";'],
  ]);
  assert.deepEqual(
    findOrphanComponents(entries, sources).map((item) => item.name),
    ["Beta"],
  );
  for (const statement of [
    'import * as UI from "@/shared/ui/A";',
    'export { Alpha, Beta } from "@/shared/ui/A";',
    'const ui = import("@/shared/ui/A");',
  ]) {
    sources.set("src/features/demo/View.tsx", statement);
    assert.deepEqual(findOrphanComponents(entries, sources), []);
  }
  sources.clear();
  sources.set("src/shared/ui/A.test.tsx", 'import * as UI from "./A";');
  sources.set("src/shared/ui/ControlSpecimen.tsx", 'import * as UI from "./A";');
  sources.set("src/shared/ui/A.tsx", 'import * as UI from "./A";');
  assert.equal(findOrphanComponents(entries, sources).length, 2);
  assert.equal(
    findOrphanComponents(entries, sources, {
      "src/shared/ui/A.tsx#Alpha": "Loaded by native window bootstrap",
    }).length,
    1,
  );
  assert.throws(
    () => findOrphanComponents(entries, sources, { "src/shared/ui/A.tsx#Alpha": "" }),
    /needs a reason/,
  );
  assert.ok(catalogFindings(entries, sources).some((item) => item.rule === "component-orphan"));
});

test("named export aliases cannot bypass component metadata", () => {
  const entries = readUiCatalogSource(
    "src/shared/ui/A.tsx",
    `function Local() { return null; }
export { Local as Public };
export { Remote } from "./Remote";
export type { Props } from "./types";`,
  );
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ["Public", "Remote"],
  );
  assert.ok(
    validateUiCatalog(entries).some(
      (problem) => problem.name === "Public" && problem.problem === "missing @group",
    ),
  );
});

test("type-only references do not rescue orphan components", () => {
  const entries = readUiCatalogSource("src/shared/ui/A.tsx", source).slice(0, 1);
  for (const statement of [
    'import type { Disclosure } from "@/shared/ui/A";',
    'import { type Disclosure } from "@/shared/ui/A";',
    'export type { Disclosure } from "@/shared/ui/A";',
  ])
    assert.equal(
      findOrphanComponents(entries, new Map([["src/features/demo/View.tsx", statement]])).length,
      1,
    );
});

test("catalog ratchet accepts recorded debt and fails new component debt", () => {
  const root = mkdtempSync(join(tmpdir(), "ui-catalog-ratchet-"));
  try {
    mkdirSync(join(root, "src/shared/ui"), { recursive: true });
    mkdirSync(join(root, "scripts/checks"), { recursive: true });
    writeFileSync(
      join(root, "src/shared/ui/A.tsx"),
      "/** Documented. */ export function Bare() { return null; }",
    );
    const before = runUiCatalog({ root, write: true });
    assert.ok(before.problems.length > 0);
    const counts = {};
    for (const problem of before.allProblems) {
      counts[problem.file] ??= {};
      counts[problem.file][problem.rule] = (counts[problem.file][problem.rule] ?? 0) + 1;
    }
    writeFileSync(
      join(root, "scripts/checks/ui-drift-baseline.json"),
      JSON.stringify({ schemaVersion: 1, counts }),
    );
    assert.deepEqual(runUiCatalog({ root }).problems, []);
    writeFileSync(
      join(root, "src/shared/ui/B.tsx"),
      "export function NewComponent() { return null; }",
    );
    assert.ok(runUiCatalog({ root }).problems.some((problem) => problem.name === "NewComponent"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("default and imported component aliases cannot bypass metadata", () => {
  for (const declaration of [
    "export default () => <div />;",
    "export default function () { return <div />; }",
    'import { Other } from "./Other"; export { Other as Alias };',
    "export const Alias = Other;",
  ])
    assert.ok(
      validateUiCatalog(readUiCatalogSource("src/shared/ui/Alias.tsx", declaration)).some(
        (problem) => problem.problem === "missing @group",
      ),
      declaration,
    );
});
