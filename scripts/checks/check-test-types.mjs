/**
 * Test type ratchet: tsconfig.json and host/tsconfig.json exclude test files and vitest does not
 * type-check, so nothing else sees type errors in tests. This runs tsc-rs over
 * tsconfig.tests.json and host/tsconfig.tests.json and counts errors per file against
 * scripts/checks/test-types-baseline.json. A file may not exceed its baseline (absent = 0) and a
 * non-test file may not have any error. Counts may only fall.
 *
 *   node scripts/checks/check-test-types.mjs                    gate against the baseline
 *   node scripts/checks/check-test-types.mjs --report           totals per top folder and TS code
 *   node scripts/checks/check-test-types.mjs --ratchet          lower baseline buckets only
 *   node scripts/checks/check-test-types.mjs --update-baseline  rewrite the baseline (review the diff)
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../../", import.meta.url));
export const baselineFile = "scripts/checks/test-types-baseline.json";
export const projects = ["tsconfig.tests.json", "host/tsconfig.tests.json"];
const typeCheckTimeoutMs = 10 * 60_000;

const testFile = /\.(test|spec)\.(ts|tsx|mts)$|\/(__tests__|test-support)\//;
export const isTestFile = (file) => testFile.test(file);

const diagnostic = /^(.+?)\((\d+),(\d+)\): error (TS\d+): /;

/** Parses tsc `--pretty false` output into `{ file, code }` entries (continuation lines are skipped). */
export function parseDiagnostics(output) {
  const found = [];
  for (const line of output.split(/\r?\n/)) {
    const match = diagnostic.exec(line);
    if (match) found.push({ file: match[1].replaceAll("\\", "/"), code: match[4] });
  }
  return found;
}

/** Errors per file. */
export function countPerFile(diagnostics) {
  const counts = {};
  for (const { file } of diagnostics) counts[file] = (counts[file] ?? 0) + 1;
  return counts;
}

/**
 * Regressions against the baseline: a file above its allowance (absent = 0) and any error in a
 * non-test file, which no baseline may excuse.
 */
export function compare(counts, baseline) {
  const regressions = [];
  for (const [file, count] of Object.entries(counts)) {
    if (!isTestFile(file)) {
      regressions.push({ file, count, allowed: 0, reason: "non-test file" });
    } else if (count > (baseline[file] ?? 0)) {
      regressions.push({ file, count, allowed: baseline[file] ?? 0, reason: "above baseline" });
    }
  }
  return regressions;
}

/** Keeps only buckets that still exist, lowered to the current count. */
export function ratchet(counts, baseline) {
  const next = {};
  for (const [file, allowed] of Object.entries(baseline)) {
    const kept = Math.min(allowed, counts[file] ?? 0);
    if (kept > 0) next[file] = kept;
  }
  return next;
}

const sorted = (counts) =>
  Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export function topFolder(file) {
  const parts = file.split("/");
  return parts.length > 2 ? parts.slice(0, parts[0] === "src" ? 3 : 2).join("/") : parts[0];
}

export function runProject(project, platform = process.platform, execute = spawnSync) {
  const bin = path.join(root, "node_modules/.bin", platform === "win32" ? "tsc-rs.cmd" : "tsc-rs");
  // One command string: passing args with shell:true is deprecated, and the .cmd shim needs a shell.
  const options = {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: typeCheckTimeoutMs,
    maxBuffer: 256 * 1024 * 1024,
  };
  const args = ["--noEmit", "--pretty", "false", "-p", project];
  const result =
    platform === "win32"
      ? execute(`"${bin}" ${args.join(" ")}`, { ...options, shell: true })
      : execute(bin, args, options);
  if (result.error) throw new Error(`tsc-rs failed for ${project}: ${result.error.message}`);
  const diagnostics = parseDiagnostics(`${result.stdout}\n${result.stderr}`);
  // A failing exit with diagnostics is the normal "errors found" case; without any it is a crash.
  if (result.status !== 0 && diagnostics.length === 0) {
    throw new Error(
      `tsc-rs exited ${result.status} for ${project} without diagnostics:\n${result.stderr}`,
    );
  }
  return diagnostics;
}

export function main(argv = process.argv.slice(2)) {
  const diagnostics = [];
  for (const project of projects) diagnostics.push(...runProject(project));
  const counts = countPerFile(diagnostics);
  const baselinePath = path.join(root, baselineFile);
  let previous = null;
  try {
    previous = JSON.parse(readFileSync(baselinePath, "utf8")).counts;
  } catch {
    previous = null;
  }

  if (argv.includes("--report")) {
    const perFolder = {};
    const perCode = {};
    for (const { file, code } of diagnostics) {
      const folder = topFolder(file);
      perFolder[folder] = (perFolder[folder] ?? 0) + 1;
      perCode[code] = (perCode[code] ?? 0) + 1;
    }
    const print = (title, table) => {
      console.log(title);
      for (const [key, n] of Object.entries(table).sort((a, b) => b[1] - a[1]))
        console.log(`  ${String(n).padStart(5)}  ${key}`);
    };
    print("Per folder", perFolder);
    print("Per TS code", perCode);
    console.log(`Total ${diagnostics.length} errors in ${Object.keys(counts).length} files.`);
    return 0;
  }

  if (argv.includes("--update-baseline") || argv.includes("--ratchet")) {
    const isRatchet = argv.includes("--ratchet");
    if (isRatchet && !previous) throw new Error(`--ratchet needs an existing ${baselineFile}`);
    const next = isRatchet ? ratchet(counts, previous) : counts;
    writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          schemaVersion: 1,
          purpose:
            "Existing type errors in test files, counted per file by scripts/checks/check-test-types.mjs (tsconfig.tests.json and host/tsconfig.tests.json). Counts may only fall; regenerate with --ratchet after fixing them.",
          counts: sorted(next),
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
  const regressions = compare(counts, previous);
  for (const r of regressions) {
    console.error(`${r.file}: ${r.count} type errors > ${r.allowed} (${r.reason})`);
  }
  if (regressions.length) {
    console.error(
      "\nFix the type errors in tests (non-test files may have none); only an owner-approved exception may be accepted with --update-baseline.",
    );
  }
  console.log(
    `Test types: ${diagnostics.length} baselined errors in ${Object.keys(counts).length} files, ${regressions.length} regressions.`,
  );
  return regressions.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
