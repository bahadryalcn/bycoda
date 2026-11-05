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
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const baselineFile = "scripts/checks/code-structure-baseline.json";

/** Line ceilings per layer. A file at or above its ceiling is a finding (`file-lines`). */
export const lineBudgets = [
  {
    rule: "rust-test-file",
    test: (f) => /\.rs$/.test(f) && /(_tests?|\/tests)\.rs$/.test(f),
    limit: 3000,
  },
  { rule: "rust-file", test: (f) => /\.rs$/.test(f), limit: 1500 },
  { rule: "ts-test-file", test: (f) => /\.(test|spec)\.(ts|tsx|mts)$/.test(f), limit: 1500 },
  { rule: "tsx-file", test: (f) => /\.tsx$/.test(f), limit: 600 },
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
/** Report-only rules: counted in --report, never gated or baselined (staged rollout). */
export const advisoryRules = new Set(["cross-feature-deep-import"]);
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

const importPattern =
  /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

export function scanImports(file, text) {
  const findings = [];
  const layer = layerOf(file);
  if (!layer || layer === "packages" || /\.rs$/.test(file)) return findings;
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
      if (other && other !== feature && deep && deep !== "index" && deep !== "index.ts")
        findings.push({ rule: "cross-feature-deep-import", detail: specifier });
    }
  }
  return findings;
}

export function scanFile(file, text) {
  const findings = [];
  const lines = text.split("\n").length;
  const budget = lineBudgets.find((candidate) => candidate.test(file));
  if (budget && lines > budget.limit) {
    findings.push({
      rule: "file-lines",
      detail: `${lines} lines > ${budget.limit} (${budget.rule})`,
      lines,
    });
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
  if (!testFile.test(file)) findings.push(...scanImports(file, text));
  return findings;
}

/** counts: { [file]: { [rule]: number } }; `file-lines` stores the line count, not 1. */
export function countFindings(files, read = (file) => readFileSync(path.join(root, file), "utf8")) {
  const counts = {};
  const details = [];
  for (const file of files) {
    const findings = scanFile(file, read(file));
    for (const finding of findings) {
      if (advisoryRules.has(finding.rule)) {
        details.push({ file, ...finding });
        continue;
      }
      counts[file] ??= {};
      counts[file][finding.rule] =
        finding.rule === "file-lines" ? finding.lines : (counts[file][finding.rule] ?? 0) + 1;
      details.push({ file, ...finding });
    }
  }
  return { counts, details };
}

export function compare(counts, baseline, files) {
  const increases = [];
  const scope = files ? new Set(files) : null;
  for (const [file, rules] of Object.entries(counts)) {
    if (scope && !scope.has(file)) continue;
    for (const [rule, count] of Object.entries(rules)) {
      const allowed = baseline[file]?.[rule] ?? 0;
      if (count > allowed) increases.push({ file, rule, count, allowed });
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
  const files = options.files
    ? all.filter((file) =>
        options.files.some((given) => given.endsWith(file) || file.endsWith(given)),
      )
    : all;
  const { counts, details } = countFindings(files);
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
    console.log("Findings per rule (advisory rules are report-only):");
    for (const [rule, count] of Object.entries(perRule).sort((a, b) => b[1] - a[1]))
      console.log(`${count}\t${rule}`);
    console.log("\nFindings per owner:");
    for (const [owner, count] of Object.entries(perOwner).sort((a, b) => b[1] - a[1]))
      console.log(`${count}\t${owner}`);
    const largest = details
      .filter((f) => f.rule === "file-lines")
      .sort((a, b) => b.lines - a.lines)
      .slice(0, 25);
    console.log("\nLargest files over budget:");
    for (const finding of largest) console.log(`${finding.lines}\t${finding.file}`);
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
            "Existing code-structure findings counted per file and rule by scripts/checks/check-code-structure.mjs. file-lines stores the current line count of an over-budget file. Counts may only fall; regenerate with --update-baseline after reducing them and review the diff.",
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
    console.error(
      `${increase.file}: ${increase.rule} ${increase.count} > ${increase.allowed} ${detail}`,
    );
  }
  if (increases.length) {
    console.error(
      "\nSplit the file into its owning feature/module folder or import through the layer's public entry (docs/reference/code-structure.md). Only an owner-approved exception may be accepted with --update-baseline.",
    );
  }
  const gated = details.filter((f) => !advisoryRules.has(f.rule)).length;
  console.log(
    `Code structure: ${files.length} files scanned, ${gated} baselined findings, ${details.length - gated} advisory, ${increases.length} increases.`,
  );
  return increases.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
