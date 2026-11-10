/**
 * Code structure ratchet: file-size budgets, loose files outside feature folders and layer
 * import boundaries for the desktop app, the Host and the native crate. Rules and the reasons
 * behind them live in docs/reference/code-structure.md. Findings are counted per file and rule
 * in scripts/checks/code-structure-baseline.json; counts may only fall.
 *
 *   node scripts/checks/check-code-structure.mjs                    gate against the baseline
 *   node scripts/checks/check-code-structure.mjs --report           totals per rule and owner
 *   node scripts/checks/check-code-structure.mjs --ratchet          lower baseline buckets only
 *   node scripts/checks/check-code-structure.mjs --update-baseline  rewrite the baseline (review the diff)
 *   node scripts/checks/check-code-structure.mjs --files a.ts b.rs  only the given files (changed-file mode)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const baselineFile = "scripts/checks/code-structure-baseline.json";

/**
 * Line targets per layer. Above `limit` a file is only reported as an advisory
 * (`file-lines-target`, never counted or gated): a prompt to look for a separable
 * responsibility, not a reason to stop or to split mechanically. Above
 * `limit * hardCeilingRatio` it is the gated `file-lines` finding.
 */
export const hardCeilingRatio = 2;
export const lineBudgets = [
  {
    rule: "rust-test-file",
    test: (f) => f.endsWith(".rs") && /(_tests?|\/tests)\.rs$/.test(f),
    limit: 3000,
  },
  { rule: "rust-file", test: (f) => f.endsWith(".rs"), limit: 1500 },
  { rule: "ts-test-file", test: (f) => /\.(test|spec)\.(ts|tsx|mts)$/.test(f), limit: 1500 },
  { rule: "tsx-file", test: (f) => f.endsWith(".tsx"), limit: 600 },
  { rule: "ts-file", test: (f) => /\.(ts|mts|mjs)$/.test(f), limit: 800 },
];

/** Directories whose direct children must be folders (plus the listed entry files). */
export const folderOnlyRoots = [
  {
    dir: "host",
    allow: new Set(["cli.ts", "mcp-entry.ts", "server.ts", "service.ts", "vitest.config.ts"]),
    rule: "loose-host-file",
  },
  { dir: "src/features/*", allow: new Set(["index.ts"]), rule: "loose-feature-file" },
];

const scannedRoots = ["src", "host", "src-tauri/src", "packages", "apps"];
const skipDirs = new Set([
  "node_modules",
  "dist",
  "target",
  "generated",
  "vendor",
  "fixtures",
  "locales",
]);
const sourceFile = /\.(ts|tsx|mts|mjs|rs)$/;
const testFile = /\.(test|spec|perf\.test)\.(ts|tsx|mts|mjs)$|(_tests?|\/tests)\.rs$|\/__tests__\//;

export const owners = (file) => {
  const parts = file.split("/");
  if (parts[0] === "src") return parts.slice(0, parts[1] === "features" ? 3 : 2).join("/");
  if (parts[0] === "host") return parts.length > 2 ? `host/${parts[1]}` : "host";
  if (parts[0] === "src-tauri") return "src-tauri";
  return parts.slice(0, 2).join("/");
};

export function listSourceFiles(base = root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name) && !entry.name.startsWith("."))
          walk(path.join(dir, entry.name));
      } else if (entry.isFile() && sourceFile.test(entry.name)) {
        out.push(path.relative(base, path.join(dir, entry.name)).split(path.sep).join("/"));
      }
    }
  };
  for (const scanned of scannedRoots) walk(path.join(base, scanned));
  return out.sort();
}

const layerOf = (file) => {
  if (file.startsWith("src/app/")) return "app";
  if (file.startsWith("src/features/")) return "features";
  if (
    file.startsWith("src/shared/") ||
    file.startsWith("src/platform/") ||
    file.startsWith("src/integrations/")
  )
    return "foundation";
  if (file.startsWith("host/")) return "host";
  if (file.startsWith("packages/")) return "packages";
  return null;
};

const featureOf = (file) => file.match(/^src\/features\/([^/]+)/)?.[1] ?? null;

/** Resolve an import specifier to a repo-relative path prefix, or null for packages. */
export function resolveSpecifier(file, specifier) {
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`;
  if (!specifier.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
}

const publicEntryDeclaration =
  /\bexport\s+type\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s*["'](\.\/public\/[^"']+)["']/g;

/** Public feature contracts explicitly declared by each feature index.ts. */
export function declaredPublicEntries(
  files,
  read = (file) => readFileSync(path.join(root, file), "utf8"),
) {
  const entries = new Set();
  for (const file of files) {
    if (!/^src\/features\/[^/]+\/index\.ts$/.test(file)) continue;
    for (const match of read(file).matchAll(publicEntryDeclaration)) {
      const target = resolveSpecifier(file, match[1]);
      if (target && /^src\/features\/[^/]+\/public\/[^/]+$/.test(target)) entries.add(target);
    }
  }
  return entries;
}

const importPattern =
  /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

export function scanImports(file, text, publicEntries = new Set()) {
  const findings = [];
  const layer = layerOf(file);
  if (!layer || layer === "packages" || file.endsWith(".rs")) return findings;
  const feature = featureOf(file);
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    const target = resolveSpecifier(file, specifier);
    if (!target) continue;
    const targetLayer = layerOf(target);
    if (layer === "foundation" && (targetLayer === "features" || targetLayer === "app"))
      findings.push({ rule: "foundation-imports-app", detail: specifier });
    else if (layer === "features" && targetLayer === "app")
      findings.push({ rule: "feature-imports-app", detail: specifier });
    else if (
      layer === "host" &&
      (targetLayer === "app" || /^src\/features\/[^/]+\/ui\//.test(target))
    )
      findings.push({ rule: "host-imports-ui", detail: specifier });
    else if (layer === "features" && targetLayer === "features") {
      const other = featureOf(target);
      const deep = target.replace(/^src\/features\/[^/]+\/?/, "");
      const featureRoot = !deep || deep === "index" || deep === "index.ts";
      const publicTarget = target.replace(/\.(?:tsx?|mts?)$/, "");
      const declaredPublicEntry = publicEntries.has(target) || publicEntries.has(publicTarget);
      if (other && other !== feature && !featureRoot && !declaredPublicEntry)
        findings.push({ rule: "cross-feature-deep-import", detail: specifier });
    }
  }
  return findings;
}

export function scanFile(file, text, publicEntries = new Set()) {
  const findings = [];
  const lines = text.split("\n").length;
  const budget = lineBudgets.find((candidate) => candidate.test(file));
  if (budget && lines > budget.limit) {
    const ceiling = budget.limit * hardCeilingRatio;
    findings.push(
      lines > ceiling
        ? {
            rule: "file-lines",
            detail: `${lines} lines > ${ceiling} (${budget.rule} hard ceiling)`,
            lines,
          }
        : {
            rule: "file-lines-target",
            advisory: true,
            detail: `${lines} lines > ${budget.limit} (${budget.rule} target)`,
            lines,
          },
    );
  }
  if (!testFile.test(file)) {
    const dir = path.posix.dirname(file);
    const name = path.posix.basename(file);
    for (const spec of folderOnlyRoots) {
      const pattern = new RegExp(`^${spec.dir.replace(/\*/g, "[^/]+")}$`);
      if (pattern.test(dir) && !spec.allow.has(name) && /\.(ts|tsx)$/.test(name))
        findings.push({ rule: spec.rule, detail: `${name} belongs in a feature or module folder` });
    }
  }
  if (!testFile.test(file)) findings.push(...scanImports(file, text, publicEntries));
  return findings;
}

/**
 * counts: { [file]: { [rule]: number } }; `file-lines` stores the line count, not 1.
 * Advisory findings (`file-lines-target`) are returned separately and never counted.
 */
export function countFindings(
  files,
  read = (file) => readFileSync(path.join(root, file), "utf8"),
  publicEntries = new Set(),
) {
  const counts = {};
  const details = [];
  const advisories = [];
  for (const file of files) {
    const findings = scanFile(file, read(file), publicEntries);
    for (const finding of findings) {
      if (finding.advisory) {
        advisories.push({ file, ...finding });
        continue;
      }
      counts[file] ??= {};
      counts[file][finding.rule] =
        finding.rule === "file-lines" ? finding.lines : (counts[file][finding.rule] ?? 0) + 1;
      details.push({ file, ...finding });
    }
  }
  return { counts, details, advisories };
}

/**
 * Lines a baselined file over its hard ceiling may grow past its recorded count, so a fix
 * or a small needed addition is never blocked. Not renewed by `--ratchet`; moving a
 * responsibility out lowers the count and frees the room again.
 */
export const growthTolerance = 50;

export function compare(counts, baseline, files) {
  const increases = [];
  const scope = files ? new Set(files) : null;
  for (const [file, rules] of Object.entries(counts)) {
    if (scope && !scope.has(file)) continue;
    for (const [rule, count] of Object.entries(rules)) {
      const allowed = baseline[file]?.[rule] ?? 0;
      const tolerance = rule === "file-lines" && allowed > 0 ? growthTolerance : 0;
      if (count > allowed + tolerance) increases.push({ file, rule, count, allowed, tolerance });
    }
  }
  return increases;
}

function sortedCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, rules]) => [file, Object.fromEntries(Object.entries(rules).sort())]),
  );
}

export function main(argv = process.argv.slice(2)) {
  const options = { files: null };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === "--update-baseline") options.update = true;
    else if (argument === "--ratchet") options.ratchet = true;
    else if (argument === "--report") options.report = true;
    else if (argument === "--files")
      options.files = argv.slice(i + 1).map((f) => f.replaceAll("\\", "/"));
    if (options.files) break;
  }
  const all = listSourceFiles();
  const publicEntries = declaredPublicEntries(all);
  const files = options.files
    ? all.filter((file) =>
        options.files.some((given) => given.endsWith(file) || file.endsWith(given)),
      )
    : all;
  const { counts, details, advisories } = countFindings(files, undefined, publicEntries);
  const baselinePath = path.join(root, baselineFile);
  let previous = null;
  try {
    previous = JSON.parse(readFileSync(baselinePath, "utf8")).counts;
  } catch {
    previous = null;
  }

  if (options.report) {
    const perRule = {};
    const perOwner = {};
    for (const finding of details) {
      perRule[finding.rule] = (perRule[finding.rule] ?? 0) + 1;
      const owner = owners(finding.file);
      perOwner[owner] = (perOwner[owner] ?? 0) + 1;
    }
    console.log("Findings per rule:");
    for (const [rule, count] of Object.entries(perRule).sort((a, b) => b[1] - a[1]))
      console.log(`${count}\t${rule}`);
    console.log("\nFindings per owner:");
    for (const [owner, count] of Object.entries(perOwner).sort((a, b) => b[1] - a[1]))
      console.log(`${count}\t${owner}`);
    const largest = details
      .filter((f) => f.rule === "file-lines")
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 25);
    console.log("\nLargest files over the hard ceiling:");
    for (const finding of largest) console.log(`${finding.lines}\t${finding.file}`);
    console.log(`\n${advisories.length} files over their line target (advisory, not gated).`);
    return 0;
  }

  if (options.update || options.ratchet) {
    let next = counts;
    if (options.ratchet) {
      if (!previous) throw new Error(`--ratchet needs an existing ${baselineFile}`);
      next = {};
      for (const [file, rules] of Object.entries(previous)) {
        for (const [rule, allowed] of Object.entries(rules)) {
          const current = counts[file]?.[rule] ?? 0;
          const kept = Math.min(allowed, current);
          if (kept > 0) (next[file] ??= {})[rule] = kept;
        }
      }
    }
    writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          purpose:
            "Existing code-structure findings counted per file and rule by scripts/checks/check-code-structure.mjs. file-lines stores the current line count of a file over its hard ceiling. Counts may only fall; regenerate with --update-baseline after reducing them and review the diff.",
          counts: sortedCounts(next),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`Wrote ${baselineFile} with ${Object.keys(next).length} files.`);
    return 0;
  }

  if (!previous) {
    console.error(
      `Missing ${baselineFile}. Run with --update-baseline to lock the current tree in.`,
    );
    return 1;
  }
  const increases = compare(counts, previous, options.files ? files : null);
  for (const increase of increases) {
    const detail =
      details.find((f) => f.file === increase.file && f.rule === increase.rule)?.detail ?? "";
    const allowance = increase.tolerance
      ? ` (baseline ${increase.allowed} + ${increase.tolerance} tolerated)`
      : "";
    console.error(
      `${increase.file}: ${increase.rule} ${increase.count} > ${increase.allowed + increase.tolerance}${allowance} ${detail}`,
    );
  }
  if (increases.length) {
    console.error(
      `\nA file may not cross its hard ceiling (${hardCeilingRatio}x the line target). A baselined file already over it may grow by up to ${growthTolerance} lines over its baseline for fixes and small needed additions; beyond that, move a responsibility into its owning feature/module folder or import through the layer's public entry (docs/reference/code-structure.md). Only an owner-approved exception may be accepted with --update-baseline.`,
    );
  }
  // Advisories never fail the check. Listed per file only in changed-file mode to keep full runs quiet.
  if (options.files) {
    for (const advisory of advisories)
      console.log(`note: ${advisory.file}: ${advisory.detail}, advisory only`);
  }
  console.log(
    `Code structure: ${files.length} files scanned, ${details.length} baselined findings, ${increases.length} increases, ${advisories.length} over line target (advisory).`,
  );
  return increases.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
