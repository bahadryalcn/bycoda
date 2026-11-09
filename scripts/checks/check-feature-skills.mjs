import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Documentation-only checks. These do not establish runtime/acceptance evidence.
const root = fileURLToPath(new URL("../../", import.meta.url));
const skillsRoot = path.join(root, ".agents/skills");
const errors = [];
const warnings = [];
const entryParagraphs = new Map();
const entries = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("feature-"))
  .sort((a, b) => a.name.localeCompare(b.name));
let documents = 0;
let sourcePointers = 0;
let mobilePointers = 0;
// `mobile/` is a separate Expo Git repository (docs/reference/repository-layout.md).
// Its pointers are validated only when that repository is checked out here.
const mobileCheckedOut = await exists(path.join(root, "mobile"));
let links = 0;

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

async function markdownFiles(directory) {
  if (!(await exists(directory))) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(target)));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(target);
  }
  return files;
}

const relative = (target) => path.relative(root, target).split(path.sep).join("/");

// Task-log residue. Skills describe current contracts; history lives in Git, tests and
// temp/local handoffs. Only references/decisions.md may carry dates (owner decisions).
const historyPatterns = [
  [
    /\b20\d{2}-\d{2}-\d{2}\b/,
    "date; owner decisions go in references/decisions.md, history in Git",
  ],
  [
    /\b(?:commit|sha|revision)\s+[0-9a-f]{7,40}\b/i,
    "commit SHA; history belongs in Git, not the skill",
  ],
  [
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
    "session/task UUID; handoffs belong in temp/local",
  ],
  [
    /`(?:src|src-tauri|host|mobile|apps|packages|scripts|tests|docs|evals)\/[^`\s]+:\d+(?:-\d+)?`/,
    "path:line pointer; use folder or file level pointers",
  ],
  [
    /\b\d+\s+(?:tests?|cases?|specs?)\s+(?:pass|passed|passing|green)\b/i,
    "verification claim; results belong in the task handoff",
  ],
  [
    /authorized tonight|frozen checkout has no mobile|product migration not started/i,
    "stale session/snapshot wording",
  ],
];
function historyFindings(text) {
  const findings = [];
  for (const [pattern, reason] of historyPatterns) {
    const match = text.match(pattern);
    if (match) findings.push(`${reason} ("${match[0]}")`);
  }
  return findings;
}
for (const entry of entries) {
  const directory = path.join(skillsRoot, entry.name);
  const entryPath = path.join(directory, "SKILL.md");
  if (!(await exists(entryPath))) {
    errors.push(`${entry.name}: missing SKILL.md`);
    continue;
  }
  const text = (await readFile(entryPath, "utf8")).replace(/^\uFEFF/, "");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontmatter) errors.push(`${entry.name}: missing frontmatter`);
  const name = frontmatter?.match(/^name:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1]?.trim();
  if (name !== entry.name) errors.push(`${entry.name}: frontmatter name mismatch`);
  if (!frontmatter?.match(/^description:\s*\S/m)) {
    errors.push(`${entry.name}: missing description`);
  }
  // Shorten entries by linking a reference, never by dropping a contract.
  const allowance = 6000;
  if (text.length > allowance) {
    errors.push(`${entry.name}: entry is ${text.length} chars (limit ${allowance})`);
  }
  for (const finding of historyFindings(text)) errors.push(`${entry.name}: ${finding}`);
  for (const paragraph of text.slice(text.indexOf("\n---", 4) + 4).split(/\r?\n\s*\r?\n/)) {
    const normalized = paragraph.replace(/\s+/g, " ").trim();
    if (normalized.length < 300 || normalized.startsWith("|")) continue;
    const owners = entryParagraphs.get(normalized) ?? new Set();
    owners.add(entry.name);
    entryParagraphs.set(normalized, owners);
  }

  const refs = await markdownFiles(path.join(directory, "references"));
  const files = [entryPath, ...refs];
  const edges = new Map();
  for (const file of files) {
    documents++;
    const body = await readFile(file, "utf8");
    if (file !== entryPath && path.basename(file) !== "decisions.md") {
      for (const finding of historyFindings(body)) errors.push(`${relative(file)}: ${finding}`);
    }
    const targets = [];
    for (const match of body.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
      let href = match[1].trim();
      if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("#")) continue;
      href = href.replace(/^<|>$/g, "").split("#")[0];
      if (!href) continue;
      links++;
      const target = path.resolve(path.dirname(file), decodeURIComponent(href));
      targets.push(target);
      if (!(await exists(target))) errors.push(`${relative(file)}: broken link ${href}`);
    }
    edges.set(file, targets);
    // Only literal, complete repository-root pointers. Globs, `<placeholder>` templates,
    // command strings and abbreviated adjacent filenames require human review instead of guessing.
    for (const match of body.matchAll(
      /`((?:src|src-tauri|host|mobile|apps|packages|scripts|tests|docs|evals|public|vendor|\.github)\/[^`\s*?{}|<>]+)`/g,
    )) {
      const pointer = match[1].replace(/:\d+(?:-\d+)?$/, "");
      sourcePointers++;
      if (pointer.startsWith("mobile/") && !mobileCheckedOut) {
        mobilePointers++;
        continue;
      }
      if (!(await exists(path.join(root, pointer)))) {
        errors.push(`${relative(file)}: missing source pointer ${pointer}`);
      }
    }
  }
  const visited = new Set();
  const pending = [entryPath];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    pending.push(...(edges.get(file) ?? []));
  }
  for (const ref of refs) {
    if (!visited.has(ref)) errors.push(`${relative(ref)}: reference unreachable from skill entry`);
  }
}

for (const owners of entryParagraphs.values()) {
  if (owners.size >= 3)
    warnings.push(
      `Repeated entry paragraph in ${[...owners].join(", ")}; consider one canonical reference`,
    );
}
if (mobilePointers) {
  console.log(
    `Skipped existence check for ${mobilePointers} mobile/ pointers: the separate mobile repository is not checked out at mobile/.`,
  );
}
for (const warning of warnings) console.warn(`WARNING ${warning}`);
for (const error of errors) console.error(`ERROR ${error}`);
console.log(
  `Feature skills: ${entries.length} entries, ${documents} documents, ${links} relative links, ${sourcePointers} literal source pointers; ${errors.length} errors, ${warnings.length} warnings.`,
);
if (errors.length) process.exitCode = 1;
