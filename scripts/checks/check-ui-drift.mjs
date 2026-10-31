/**
 * UI drift ratchet: regex rules over app/feature source and the feature parts of the shared
 * stylesheets. Existing findings are counted per (file, rule) in ui-drift-baseline.json; only
 * counts above the baseline fail, so debt stays visible without blocking unrelated work.
 *
 *   node scripts/checks/check-ui-drift.mjs                    fail on new findings (whole tree)
 *   node scripts/checks/check-ui-drift.mjs --files a.tsx b.css   limit the comparison to files
 *   node scripts/checks/check-ui-drift.mjs --update-baseline  rewrite the baseline from the tree
 *   node scripts/checks/check-ui-drift.mjs --ratchet          lower baseline buckets only (never raises)
 *   node scripts/checks/check-ui-drift.mjs --report           totals per rule and feature folder
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
export const baselineFile = "scripts/checks/ui-drift-baseline.json";

export const rules = {
  "undefined-var": "var(--x) / Tailwind (--x) with no definition in src CSS or inline style",
  "arc-var-outside-arc":
    "Arc-only variable (.bycoda-arc block in arc.css) used outside an Arc root",
  typography: "literal font size: text-[Npx], text-xs..xl, text-[length:], CSS font-size px",
  "radius-size": "literal radius/size: rounded-[…], h-/w-/size-[Npx], CSS border-radius px",
  "icon-size-class": "size-3/3.5/4/5 on a shared icon component (use icon-* sizes)",
  "icon-numeric-size": "numeric size={n} prop",
  "icon-stroke-width": "strokeWidth other than 1.75 or 2",
  "lucide-import": "direct lucide-react import outside src/shared/ui/icons.tsx",
  "loading-motion": "animate-spin/pulse without motion-safe:/motion-reduce: on the element",
  layer: "literal layer: z-[n], z-10..50, CSS z-index > 10",
  "color-base-hue": "base hue utility/var (text|bg|border-danger…, var(--color-accent…))",
  "color-base-opacity": "opacity-modified base token (bg-background-base/45, border-stroke/60…)",
  "native-title": "title= on Button/InlineAction or interactive DOM (use tooltip=/Tooltip)",
  "role-alert-text": "<p role=alert> / <span role=alert> (use the shared inline error)",
  "portal-outside-shared": "createPortal outside src/shared/ui",
  "popover-menu": "Popover with role=menu/listbox (use DropdownMenu/picker)",
  "hover-bg": "hover:bg-* recipe in TSX (use shared interaction states)",
  "disabled-opacity": "opacity-30..60 used as the disabled state",
  "fixed-control-size": "fixed h-7/h-8/size-7/size-8 on Button/ActionHost (breaks density)",
  "motion-literal": "literal cubic-bezier( or Nms transition/animation outside :root tokens",
};

/** Variables set at runtime with computed names, or by third-party code. */
const runtimeVariables = [/^--tw-/, /^--radix-/, /^--shiki-/, /^--sdm-/];

const lineStarts = (text) => {
  const starts = [0];
  for (let index = 0; index < text.length; index++)
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  return starts;
};
const lineAt = (starts, offset) => {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low + 1;
};
const blank = (match) => match.replace(/[^\n]/g, " ");

export const isTestPath = (file) =>
  /(?:^|\/)(?:__tests__|__fixtures__|fixtures|test-support)\//.test(file) ||
  /\.(?:test|spec|stories|fixture|test-support)\.[cm]?[jt]sx?$/.test(file) ||
  /\.test-support\./.test(file);

/** Which rule families apply to a source path. */
export function scopeOf(file) {
  if (isTestPath(file)) return null;
  if (!/\.(?:tsx?|css)$/.test(file)) return null;
  if (/^src\/(?:app|features)\//.test(file)) return "app";
  if (file === "src/styles/index.css" || file === "src/styles/bycoda.css") return "styles";
  if (file.startsWith("src/") && file !== "src/shared/ui/icons.tsx" && /\.tsx?$/.test(file))
    return "imports";
  return null;
}

/* ---------- CSS ---------- */

/**
 * Blanks comments (keeping offsets and newlines) while respecting string literals, so globs such
 * as "dist/*.js" are not read as comment openers. JS/TS quotes end at a newline, which bounds the
 * damage when a regex literal contains a quote character.
 */
function stripComments(text, { lineComments }) {
  const parts = [];
  let kept = 0;
  let quote = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote || (char === "\n" && quote !== "`")) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || (lineComments && char === "`")) {
      quote = char;
      continue;
    }
    if (char !== "/") continue;
    const next = text[index + 1];
    let stop = -1;
    if (next === "*") {
      const close = text.indexOf("*/", index + 2);
      stop = close < 0 ? text.length : close + 2;
    } else if (
      lineComments &&
      next === "/" &&
      (index === 0 || /[\s;{}(),]/.test(text[index - 1]))
    ) {
      const close = text.indexOf("\n", index);
      stop = close < 0 ? text.length : close;
    }
    if (stop < 0) continue;
    parts.push(text.slice(kept, index), blank(text.slice(index, stop)));
    kept = stop;
    index = stop - 1;
  }
  parts.push(text.slice(kept));
  return parts.join("");
}
const stripCssComments = (text) => stripComments(text, { lineComments: false });

/** Declarations with their selector chain and absolute offsets. */
export function cssDeclarations(text) {
  const source = stripCssComments(text);
  const declarations = [];
  const stack = [];
  let start = -1;
  let quote = null;
  let parens = 0;
  const flush = (end) => {
    if (start < 0) return;
    const raw = source.slice(start, end);
    const colon = raw.indexOf(":");
    if (colon > 0 && !raw.trimStart().startsWith("@")) {
      declarations.push({
        offset: start,
        // Custom property names are case-sensitive (--palette-solidInk).
        property: raw
          .slice(0, colon)
          .trim()
          .replace(/^(?!--).*/, (name) => name.toLowerCase()),
        value: raw.slice(colon + 1),
        valueOffset: start + colon + 1,
        selectors: [...stack],
      });
    }
    start = -1;
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      if (start < 0) start = index;
      quote = char;
    } else if (char === "(") parens++;
    else if (char === ")") parens = Math.max(0, parens - 1);
    else if (char === "{" && parens === 0) {
      stack.push(start < 0 ? "" : source.slice(start, index).trim().replace(/\s+/g, " "));
      start = -1;
    } else if (char === "}" && parens === 0) {
      flush(index);
      stack.pop();
    } else if (char === ";" && parens === 0) flush(index);
    else if (start < 0 && !/\s/.test(char)) start = index;
  }
  flush(source.length);
  return declarations;
}

const isTokenBlock = (selectors) =>
  selectors.some((selector) => /^(?:html)?:root\b|^@theme\b/.test(selector));
const underArc = (selectors) => selectors.some((selector) => /\.bycoda-arc(?!\w)/.test(selector));

/* ---------- TS/TSX ---------- */

const stripTsComments = (text) => stripComments(text, { lineComments: true });

/** End offset (inclusive `>`) of a JSX opening tag that starts at `<`. */
function tagEnd(text, start) {
  let depth = 0;
  let quote = null;
  const limit = Math.min(text.length, start + 6000);
  for (let index = start + 1; index < limit; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") index++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (char === ">" && depth === 0) return index;
  }
  return Math.min(text.length - 1, start + 200);
}

/** Opening tag text with brace expressions blanked, so only top-level attributes remain. */
function topLevel(span) {
  let depth = 0;
  let out = "";
  for (const char of span) {
    if (char === "{") depth++;
    out += depth > 0 ? " " : char;
    if (char === "}") depth = Math.max(0, depth - 1);
  }
  return out;
}

function jsxTags(text) {
  const tags = [];
  const pattern = /(?<![\w$.)\]])<([A-Za-z][\w.]*)(?=[\s/>])/g;
  for (const match of text.matchAll(pattern)) {
    const end = tagEnd(text, match.index);
    tags.push({ name: match[1], start: match.index, end, span: text.slice(match.index, end + 1) });
  }
  return tags;
}

function sharedIconNames(text) {
  const names = new Set();
  const pattern = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["'][^"']*shared\/ui\/icons["']/g;
  for (const match of text.matchAll(pattern))
    for (const part of match[1].split(",")) {
      const name = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .at(-1)
        ?.trim();
      if (name && /^[A-Z]/.test(name)) names.add(name);
    }
  return names;
}

/* ---------- definitions (shared by every file) ---------- */

const cssVarDefinition = /(?<![\w-])(--[\w-]+)\s*:/g;
const tsVarDefinitions = [
  /["'`](--[\w-]+)["'`]/g,
  /\[(--[\w-]+):/g,
  /setProperty\(\s*["'`](--[\w-]+)/g,
];

export function collectDefinitions(sources, tailwindTheme = "") {
  const defined = new Set();
  const prefixes = new Set();
  const nonArc = new Set();
  const arcBlock = new Set();
  for (const match of tailwindTheme.matchAll(cssVarDefinition)) {
    defined.add(match[1]);
    nonArc.add(match[1]);
  }
  for (const [file, text] of sources) {
    if (file === "src/shared/ui/arc/foundation.css") continue; // not imported by the app
    if (file.endsWith(".css")) {
      for (const declaration of cssDeclarations(text)) {
        if (!declaration.property.startsWith("--")) continue;
        defined.add(declaration.property);
        const arcRoot =
          file === "src/styles/arc.css" &&
          declaration.selectors.length === 1 &&
          declaration.selectors[0] === ".bycoda-arc";
        if (arcRoot) arcBlock.add(declaration.property);
        // Arc roots, Arc component classes (.bycoda-arc-segmented) and Arc registry CSS are all
        // Arc-scoped; only a definition outside them makes the name safe for the rest of the app.
        else if (
          !file.startsWith("src/shared/ui/arc/") &&
          !declaration.selectors.some((selector) => selector.includes(".bycoda-arc"))
        )
          nonArc.add(declaration.property);
      }
      for (const match of text.matchAll(/@property\s+(--[\w-]+)/g)) defined.add(match[1]);
    } else if (!isTestPath(file)) {
      for (const pattern of tsVarDefinitions)
        for (const match of text.matchAll(pattern)) defined.add(match[1]);
      for (const match of text.matchAll(/["'`](--[\w-]{3,})\$\{/g)) prefixes.add(match[1]);
    }
  }
  const arcOnly = new Set([...arcBlock].filter((name) => !nonArc.has(name)));
  return { defined, prefixes: [...prefixes], arcOnly };
}

const isDefined = (name, definitions) =>
  definitions.defined.has(name) ||
  runtimeVariables.some((pattern) => pattern.test(name)) ||
  definitions.prefixes.some((prefix) => name.startsWith(prefix));

/* ---------- scanning ---------- */

const variant = String.raw`(?<![\w\-\[(:/])((?:[\w\-\[\]&@*=]+:)*)`;
const end = String.raw`(?![\w.\-])`;
const tw = (body, flags = "g") => new RegExp(variant + body, flags);

const twRules = [
  ["typography", tw(String.raw`text-\[\d+(?:\.\d+)?px\]`)],
  ["typography", tw(String.raw`text-(?:xs|sm|base|lg|xl)` + end)],
  ["typography", tw(String.raw`text-(?:\[length:|\(length:)`)],
  ["radius-size", tw(String.raw`rounded(?:-[a-z]{1,2})?-\[[^\]\s]+\]`)],
  ["radius-size", tw(String.raw`(?:h|w|size)-\[\d+(?:\.\d+)?px\]`)],
  ["layer", tw(String.raw`-?z-(?:\[[^\]\s]+\]|10|20|30|40|50)` + end)],
  [
    "color-base-hue",
    tw(String.raw`(?:text|bg|border)-(?:danger|warning|success|info|accent)(?![\w\-])`),
  ],
  [
    "color-base-opacity",
    tw(
      String.raw`(?:bg|text|border(?:-[trblxyse])?|divide|ring|outline|fill|stroke|from|via|to)-(?:background-base|stroke|content)\/(?:\d+|\[[^\]\s]+\]|\([^)\s]+\))`,
    ),
  ],
  ["hover-bg", /(?<![\w\-:])[\w\-[\]&@*=:]*hover:bg-[\w\-[(]/g],
];

const varUse = /var\(\s*(--[\w-]+)(?![\w-]|\$\{)/g;
const twVarUse = /-\((?:[a-z-]+:)?(--[\w-]+)\)/g;
const iconSizeClass = tw(String.raw`size-(?:3|3\.5|4|5)` + end, "");
const fixedControlSize = tw(String.raw`(?:h|size)-(?:7|8)(?![\w.\-/])`, "");

/**
 * Findings for one file. `definitions` comes from collectDefinitions over the whole src tree.
 * Each finding: { file, rule, line, text }.
 */
export function scanFile(file, text, definitions) {
  const scope = scopeOf(file);
  if (!scope) return [];
  const findings = [];
  const isCss = file.endsWith(".css");
  // Shared/integration code only answers the import rule; skip the comment pass when absent.
  if (scope === "imports" && !text.includes("lucide-react")) return findings;
  const source = isCss ? stripCssComments(text) : stripTsComments(text);
  const starts = lineStarts(text);
  const lines = text.split("\n");
  const add = (rule, offset) => {
    const line = lineAt(starts, offset);
    findings.push({ file, rule, line, text: (lines[line - 1] ?? "").trim().slice(0, 160) });
  };

  if (scope === "imports") {
    for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)["']lucide-react["']/g))
      add("lucide-import", match.index);
    return findings;
  }

  // A fallback does not exempt an undefined name: the fallback then always wins silently.
  const checkVar = (name, offset, arcAllowed) => {
    if (definitions.arcOnly.has(name)) {
      if (!arcAllowed && scope === "app") add("arc-var-outside-arc", offset);
      return;
    }
    if (!isDefined(name, definitions)) add("undefined-var", offset);
  };

  if (isCss) {
    for (const declaration of cssDeclarations(text)) {
      const { property, value, valueOffset, selectors } = declaration;
      const arc = underArc(selectors);
      for (const match of value.matchAll(varUse))
        checkVar(match[1], valueOffset + match.index, arc);
      if (scope === "app") {
        if (property === "font-size" && /\d(?:\.\d+)?px/.test(value))
          add("typography", valueOffset);
        if (
          /^border(?:-[a-z]+)*-radius$/.test(property) &&
          /(?<![\w.])[1-9]\d*(?:\.\d+)?px/.test(value)
        )
          add("radius-size", valueOffset);
        for (const match of value.matchAll(
          /var\(\s*--color-(?:accent|danger|warning|success)(?![\w-])/g,
        ))
          add("color-base-hue", valueOffset + match.index);
      }
      if (property === "z-index" && Number.parseInt(value, 10) > 10) add("layer", valueOffset);
      // Reduced-motion overrides (0ms/1ms) are the accessible fallback, not drift.
      if (
        !isTokenBlock(selectors) &&
        !selectors.some((selector) => /reduced-motion/.test(selector))
      ) {
        const motionProperty =
          /^(?:transition|animation)(?:-duration|-delay|-timing-function)?$/.test(property);
        if (/cubic-bezier\(/.test(value) || (motionProperty && /(?<![\w.])\d+ms\b/.test(value)))
          add("motion-literal", valueOffset);
      }
    }
    return findings;
  }

  // TS/TSX
  const arcFile = /["'`\s]bycoda-arc(?=["'`\s])/.test(source);
  for (const match of source.matchAll(varUse)) checkVar(match[1], match.index, arcFile);
  for (const match of source.matchAll(twVarUse)) checkVar(match[1], match.index, arcFile);

  for (const [rule, pattern] of twRules)
    for (const match of source.matchAll(pattern)) add(rule, match.index);

  for (const match of source.matchAll(/(?:from\s*|import\s*\(?\s*)["']lucide-react["']/g))
    add("lucide-import", match.index);
  for (const match of source.matchAll(/(?<![\w.])createPortal\s*\(/g))
    add("portal-outside-shared", match.index);
  const tags = jsxTags(source);
  const containing = (offset) => {
    let best = null;
    for (const tag of tags)
      if (tag.start <= offset && offset <= tag.end && (!best || tag.start > best.start)) best = tag;
    return best;
  };
  const context = (offset) => {
    const tag = containing(offset);
    if (tag) return tag.span;
    const line = lineAt(starts, offset);
    return lines[line - 1] ?? "";
  };

  // Icon props: numeric size on components (QR codes, avatars, images and charts excluded) and
  // stroke widths on components only, so hand-drawn inline SVG illustrations are not flagged.
  for (const match of source.matchAll(/\bsize=\{\s*\d+(?:\.\d+)?\s*\}/g)) {
    const tag = containing(match.index);
    if (!tag || !/^[A-Z]/.test(tag.name) || /QR|Avatar|Image|Canvas|Chart/i.test(tag.name))
      continue;
    add("icon-numeric-size", match.index);
  }
  for (const match of source.matchAll(/\bstrokeWidth=\{?\s*["']?(\d*\.?\d+)/g)) {
    const tag = containing(match.index);
    if (tag && /^[A-Z]/.test(tag.name) && !["1.75", "2"].includes(match[1]))
      add("icon-stroke-width", match.index);
  }

  for (const match of source.matchAll(tw(String.raw`animate-(?:spin|pulse)` + end))) {
    if (/motion-(?:safe|reduce)/.test(match[1])) continue;
    if (/motion-reduce:|motion-safe:animate-/.test(context(match.index))) continue;
    add("loading-motion", match.index);
  }
  for (const match of source.matchAll(tw(String.raw`opacity-(?:30|40|50|60)` + end))) {
    if (/disabled/.test(match[1]) || /(?<![\w-])disabled(?![\w-])/.test(context(match.index)))
      add("disabled-opacity", match.index);
  }

  const icons = sharedIconNames(source);
  for (const tag of tags) {
    const attributes = topLevel(tag.span);
    if (icons.has(tag.name) && iconSizeClass.test(tag.span)) add("icon-size-class", tag.start);
    const control = tag.name === "Button" || tag.name === "InlineAction";
    // title="" only suppresses an inherited tooltip; it renders nothing.
    const title = attributes.search(/\stitle=(?!""|'')/);
    if ((control || ["button", "a", "input"].includes(tag.name)) && title >= 0)
      add("native-title", tag.start + title + 1);
    if ((tag.name === "p" || tag.name === "span") && /\srole=\{?["']alert["']/.test(tag.span))
      add("role-alert-text", tag.start);
    if (
      tag.name === "Popover" &&
      (/\srole=\{?["'](?:menu|listbox)["']/.test(attributes) ||
        /\brole:\s*["'](?:menu|listbox)["']/.test(tag.span))
    )
      add("popover-menu", tag.start);
    if ((tag.name === "Button" || tag.name === "ActionHost") && fixedControlSize.test(tag.span))
      add("fixed-control-size", tag.start);
  }
  return findings;
}

/* ---------- tree, baseline, comparison ---------- */

export function listSources(root) {
  const out = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(file);
      } else if (/\.(?:tsx?|css)$/.test(entry.name)) out.push(file);
    }
  };
  walk("src");
  return out.sort();
}

export function readTree(root, overrides = new Map()) {
  const sources = new Map();
  for (const file of listSources(root))
    sources.set(file, fs.readFileSync(path.join(root, file), "utf8"));
  for (const [file, text] of overrides) sources.set(file, text);
  // Tailwind's default theme variables (--text-xs, --radius-md, --spacing…) are real definitions.
  const theme = [root, defaultRoot]
    .map((base) => path.join(base, "node_modules/tailwindcss/theme.css"))
    .find((file) => fs.existsSync(file));
  if (!theme)
    throw new Error("UI drift needs installed dependencies (node_modules/tailwindcss/theme.css)");
  return { sources, definitions: collectDefinitions(sources, fs.readFileSync(theme, "utf8")) };
}

export function countFindings(findings) {
  const counts = {};
  for (const { file, rule } of findings) {
    counts[file] ??= {};
    counts[file][rule] = (counts[file][rule] ?? 0) + 1;
  }
  return counts;
}

export function sortedCounts(counts) {
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .filter((file) => Object.keys(counts[file]).length)
      .map((file) => [
        file,
        Object.fromEntries(
          Object.keys(counts[file])
            .sort()
            .map((rule) => [rule, counts[file][rule]]),
        ),
      ]),
  );
}

export function readBaseline(root) {
  const file = path.join(root, baselineFile);
  if (!fs.existsSync(file)) return null;
  const baseline = JSON.parse(fs.readFileSync(file, "utf8"));
  if (baseline.schemaVersion !== 1 || typeof baseline.counts !== "object")
    throw new Error(`Unsupported ${baselineFile}`);
  return baseline.counts;
}

/** Buckets above baseline (regressions) and below it (improvements), for the given files. */
export function compareCounts(current, baseline, files) {
  const regressions = [];
  const improvements = [];
  const scope = files ?? new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const file of scope) {
    const now = current[file] ?? {};
    const before = baseline[file] ?? {};
    for (const rule of new Set([...Object.keys(now), ...Object.keys(before)])) {
      const a = before[rule] ?? 0;
      const b = now[rule] ?? 0;
      if (b > a) regressions.push({ file, rule, baseline: a, count: b });
      else if (b < a) improvements.push({ file, rule, baseline: a, count: b });
    }
  }
  const order = (x, y) => x.rule.localeCompare(y.rule) || x.file.localeCompare(y.file);
  return { regressions: regressions.sort(order), improvements: improvements.sort(order) };
}

/** Marks findings whose line text is not present (as often) in the HEAD version of the file. */
function markNew(root, file, findings, definitions) {
  let previous;
  try {
    previous = execFileSync("git", ["show", `HEAD:${file}`], {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return findings.map((finding) => ({ ...finding, fresh: true }));
  }
  const remaining = new Map();
  for (const old of scanFile(file, previous, definitions)) {
    const key = `${old.rule}|${old.text}`;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return findings.map((finding) => {
    const key = `${finding.rule}|${finding.text}`;
    const left = remaining.get(key) ?? 0;
    remaining.set(key, left - 1);
    return { ...finding, fresh: left <= 0 };
  });
}

/**
 * Programmatic entry for check-staged / check-local. `overrides` maps repo paths to the text to
 * check (for example staged blobs); `files` limits the comparison to those paths.
 */
export function checkUiDrift({ root = defaultRoot, overrides = new Map(), files } = {}) {
  const baseline = readBaseline(root);
  if (!baseline) return { success: true, skipped: `${baselineFile} is missing`, regressions: [] };
  const { sources, definitions } = readTree(root, overrides);
  const targets = files ? [...files].filter((file) => scopeOf(file)) : [...sources.keys()];
  const findings = targets.flatMap((file) =>
    sources.has(file) ? scanFile(file, sources.get(file), definitions) : [],
  );
  const current = countFindings(findings);
  const result = compareCounts(current, baseline, files ? new Set(targets) : undefined);
  const details = result.regressions.map((bucket) => {
    const items = findings.filter((item) => item.file === bucket.file && item.rule === bucket.rule);
    return { ...bucket, items: markNew(root, bucket.file, items, definitions) };
  });
  return { success: details.length === 0, ...result, regressions: details, findings, current };
}

export function formatRegressions(regressions) {
  const out = [];
  let rule = null;
  for (const bucket of regressions) {
    if (bucket.rule !== rule) {
      rule = bucket.rule;
      out.push(`\n${rule}: ${rules[rule]}`);
    }
    out.push(`  ${bucket.file}: ${bucket.count} (baseline ${bucket.baseline})`);
    const fresh = bucket.items.filter((item) => item.fresh);
    const shown = fresh.length ? fresh : bucket.items;
    for (const item of shown.slice(0, 12))
      out.push(`    ${item.file}:${item.line}${fresh.length ? " new" : ""}  ${item.text}`);
    if (shown.length > 12) out.push(`    … ${shown.length - 12} more`);
  }
  return out.join("\n");
}

const folderOf = (file) =>
  /^src\/(?:features|app)\/[^/]+/.exec(file)?.[0] ??
  (file.startsWith("src/styles/") ? file : "other");

export function formatReport(findings) {
  const byRule = new Map();
  const byFolder = new Map();
  for (const { file, rule } of findings) {
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    const folder = folderOf(file);
    byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
  }
  const table = (map) =>
    [...map]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => `  ${String(count).padStart(5)}  ${name}`);
  const top = [];
  for (const rule of Object.keys(rules)) {
    const perFile = new Map();
    for (const item of findings.filter((finding) => finding.rule === rule))
      perFile.set(item.file, (perFile.get(item.file) ?? 0) + 1);
    if (!perFile.size) continue;
    top.push(`\n${rule} (${byRule.get(rule)}): ${rules[rule]}`, ...table(perFile).slice(0, 10));
  }
  return [
    `UI drift report: ${findings.length} findings`,
    "\nPer rule:",
    ...table(byRule),
    "\nPer folder:",
    ...table(byFolder),
    "\nTop 10 files per rule:",
    ...top,
    "",
  ].join("\n");
}

function parseArguments(args) {
  const options = { files: null };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--update-baseline") options.update = true;
    else if (argument === "--ratchet") options.ratchet = true;
    else if (argument === "--report") options.report = true;
    else if (argument === "--files") {
      options.files = [];
      while (index + 1 < args.length && !args[index + 1].startsWith("--"))
        options.files.push(args[++index].replace(/\\/g, "/").replace(/^\.\//, ""));
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = defaultRoot;
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.update || options.ratchet || options.report) {
      const { sources, definitions } = readTree(root);
      const findings = [...sources].flatMap(([file, text]) => scanFile(file, text, definitions));
      if (options.report) process.stdout.write(formatReport(findings));
      if (options.update || options.ratchet) {
        const previous = readBaseline(root);
        let counts = sortedCounts(countFindings(findings));
        // --ratchet only lowers buckets, so another writer's new drift is never accepted by accident.
        if (options.ratchet) {
          if (!previous) throw new Error(`--ratchet needs an existing ${baselineFile}`);
          const lowered = {};
          for (const [file, perRule] of Object.entries(previous))
            for (const [rule, count] of Object.entries(perRule)) {
              const now = Math.min(count, counts[file]?.[rule] ?? 0);
              if (now > 0) (lowered[file] ??= {})[rule] = now;
            }
          counts = sortedCounts(lowered);
        }
        const { regressions, improvements } = compareCounts(counts, previous ?? {});
        fs.writeFileSync(
          path.join(root, baselineFile),
          `${JSON.stringify(
            {
              schemaVersion: 1,
              purpose:
                "Existing UI drift counted per file and rule by scripts/checks/check-ui-drift.mjs. Counts may only fall; regenerate with --update-baseline after reducing them.",
              counts,
            },
            null,
            2,
          )}\n`,
        );
        console.log(
          `Wrote ${baselineFile}: ${Object.values(counts)
            .flatMap(Object.values)
            .reduce(
              (sum, count) => sum + count,
              0,
            )} findings in ${Object.keys(counts).length} files ` +
            `(${improvements.length} buckets lowered, ${regressions.length} raised).`,
        );
        for (const bucket of previous ? regressions : [])
          console.log(
            `  raised ${bucket.file} ${bucket.rule}: ${bucket.baseline} -> ${bucket.count}`,
          );
      }
    } else {
      const result = checkUiDrift({ root, files: options.files ?? undefined });
      if (result.skipped) console.log(`UI drift check skipped: ${result.skipped}`);
      for (const bucket of result.improvements ?? [])
        console.log(
          `improved ${bucket.file} ${bucket.rule}: ${bucket.baseline} -> ${bucket.count}`,
        );
      if (result.improvements?.length)
        console.log(
          "Run node scripts/checks/check-ui-drift.mjs --update-baseline to lock these in.",
        );
      if (!result.success) {
        console.error(
          `New UI drift (counts above ${baselineFile}):${formatRegressions(result.regressions)}`,
        );
        console.error(
          "\nUse the shared primitive/token for these lines. Only an owner-approved exception may be accepted with --update-baseline.",
        );
        process.exitCode = 1;
      } else if (!result.skipped)
        console.log(`UI drift: no new findings (${result.findings.length} baseline-tracked).`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
