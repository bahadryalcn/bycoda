import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
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
  assert.ok(!messages.some((message) => message.startsWith("Part:")));
  const bare = readUiCatalogSource("x.tsx", "export function Bare() { return null; }");
  assert.equal(validateUiCatalog(bare).length, 4);
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
  assert.deepEqual(validateUiCatalog(grouped), []);
  const markdown = renderUiCatalog(grouped);
  assert.match(markdown, /## Data[\s\S]*Parts: MainItem\n[\s\S]*## Ungrouped\n\nParts: Loose/);
});
