/**
 * React Compiler coverage ratchet.
 *
 * The folders the compiler compiles in full (scripts/build/react-compiler.ts) only stay fast
 * while the compiler really compiles their components and hooks. It skips a function silently:
 * the guard pass opts it out when it reads state React cannot see during render (the module
 * `t()`, localStorage, the clock), and the compiler bails out on code it cannot prove safe. A
 * skipped function re-runs in full on every render and none of its values are memoized.
 *
 * This check runs the same guard and compiler as the build over those folders and counts the
 * functions that do not compile, per file, against compiler-coverage-baseline.json. The count
 * may only fall: a new skipped function fails, and a fix lowers the baseline with --ratchet.
 * Rule bycoda/compiler-owns-memo reads the same baseline, so manual memoization is banned only
 * in files where every function compiles.
 *
 * Usage:
 *   node scripts/checks/check-compiler-coverage.mjs             compare with the baseline
 *   node scripts/checks/check-compiler-coverage.mjs --report    totals, reasons and worst files
 *   node scripts/checks/check-compiler-coverage.mjs --ratchet   lower baseline counts that fell
 *   node scripts/checks/check-compiler-coverage.mjs --write     record the current counts
 */
import { transformSync } from "@babel/core";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
export const baselineFile = "scripts/checks/compiler-coverage-baseline.json";
/** The one rule of this baseline, as check-baselines.mjs totals it. */
export const rule = "uncompiled-function";
/** Compiled in full; keep in step with INFERRED in scripts/build/react-compiler.ts. */
export const compiledFolders = ["src/shared/ui", "src/features/sessions/ui", "src/app/shell"];

const SOURCE = /\.[jt]sx?$/;
const NOT_SOURCE = /\.(?:test|spec|stories)\.[jt]sx?$|\.d\.ts$|\.worker\.[jt]sx?$/;
const WORKER_FOLDER = /(?:^|\/)workers?\//;

/** Source files of the compiled folders, repository-relative with forward slashes. */
export function listSources(root = defaultRoot) {
  const files = [];
  const walk = (folder) => {
    for (const entry of readdirSync(path.join(root, folder), { withFileTypes: true })) {
      const file = `${folder}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(file);
      } else if (SOURCE.test(file) && !NOT_SOURCE.test(file) && !WORKER_FOLDER.test(file))
        files.push(file);
    }
  };
  for (const folder of compiledFolders) walk(folder);
  return files.sort();
}

let pipeline;
/** The guard and the compiler the build uses, loaded once. */
async function loadPipeline(root) {
  if (pipeline) return pipeline;
  const guard = await import(
    pathToFileURL(path.join(root, "scripts/build/reactCompilerGuard.ts")).href
  );
  const compiler = createRequire(path.join(root, "package.json")).resolve(
    "babel-plugin-react-compiler",
  );
  pipeline = { guard: guard.reactCompilerGuard, compiler };
  return pipeline;
}

/**
 * Compiles one file the way the build does and lists what happened to its components and hooks:
 * `compiled` is their number, `skipped` holds a line and reason for each one that did not compile.
 */
export async function scanSource(file, code, root = defaultRoot) {
  const { guard, compiler } = await loadPipeline(root);
  const skipped = [];
  let compiled = 0;
  const logEvent = (_filename, event) => {
    const line = event.fnLoc?.start.line ?? 0;
    if (event.kind === "CompileSuccess") compiled++;
    else if (event.kind === "CompileError" || event.kind === "CompileDiagnostic")
      skipped.push({ line, reason: `compiler: ${event.detail.reason}` });
    else if (event.kind === "PipelineError")
      skipped.push({ line, reason: `compiler: ${event.data}` });
  };
  const warn = console.warn;
  // The guard reports each opt-out on console.warn when its report switch is set.
  const report = process.env.BYCODA_COMPILER_GUARD_REPORT;
  process.env.BYCODA_COMPILER_GUARD_REPORT = "1";
  console.warn = (message) => {
    const match = /^\[compiler-guard\].*:(\d+) use no memo: (.*)$/.exec(String(message));
    if (match) skipped.push({ line: Number(match[1]), reason: `guard: ${match[2]}` });
  };
  try {
    transformSync(code, {
      filename: path.join(root, file),
      babelrc: false,
      configFile: false,
      sourceType: "module",
      parserOpts: { plugins: ["typescript", "jsx"] },
      plugins: [
        guard({ annotation: false }),
        [compiler, { compilationMode: "infer", logger: { logEvent } }],
      ],
    });
  } catch (error) {
    skipped.push({ line: 0, reason: `file: ${String(error.message).split("\n")[0]}` });
  } finally {
    console.warn = warn;
    if (report === undefined) delete process.env.BYCODA_COMPILER_GUARD_REPORT;
    else process.env.BYCODA_COMPILER_GUARD_REPORT = report;
  }
  // One function can be reported twice (a diagnostic and then an error); a line is one function.
  const seen = new Set();
  const unique = skipped.filter(({ line }) => !seen.has(line) && seen.add(line));
  return { compiled, skipped: unique.sort((a, b) => a.line - b.line) };
}

/** `{ file: { compiled, skipped } }` for every source of the compiled folders. */
export async function scanTree(root = defaultRoot, files = listSources(root)) {
  const result = {};
  for (const file of files)
    result[file] = await scanSource(file, readFileSync(path.join(root, file), "utf8"), root);
  return result;
}

/** Baseline shape: only files with a skipped function, sorted. */
export function countsOf(scan) {
  const counts = {};
  for (const file of Object.keys(scan).sort())
    if (scan[file].skipped.length > 0) counts[file] = { [rule]: scan[file].skipped.length };
  return counts;
}

export function readBaseline(root = defaultRoot) {
  try {
    return JSON.parse(readFileSync(path.join(root, baselineFile), "utf8")).counts ?? {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

/** Files whose skipped count rose above the baseline, and those where it fell. */
export function compareCounts(scan, baseline) {
  const regressions = [];
  const improvements = [];
  for (const [file, { skipped }] of Object.entries(scan)) {
    const allowed = baseline[file]?.[rule] ?? 0;
    if (skipped.length > allowed) regressions.push({ file, allowed, skipped });
    else if (skipped.length < allowed) improvements.push({ file, allowed, now: skipped.length });
  }
  return { regressions, improvements };
}

export function formatRegressions(regressions) {
  const lines = [];
  for (const { file, allowed, skipped } of regressions) {
    lines.push(`${file}: ${skipped.length} functions do not compile (baseline ${allowed})`);
    for (const { line, reason } of skipped) lines.push(`  ${file}:${line}  ${reason}`);
  }
  lines.push(
    "",
    "A function the React Compiler skips re-runs in full on every render. Fix the cause the reason",
    "names: read the locale with useT() instead of the module t(), read storage and the clock in an",
    "effect, a handler or a useState initializer, and do not mutate a value after render.",
  );
  return lines.join("\n");
}

function totals(scan) {
  let compiled = 0;
  let skipped = 0;
  for (const entry of Object.values(scan)) {
    compiled += entry.compiled;
    skipped += entry.skipped.length;
  }
  return { compiled, skipped, share: Math.round((compiled / (compiled + skipped || 1)) * 100) };
}

export function formatReport(scan) {
  const { compiled, skipped, share } = totals(scan);
  const reasons = new Map();
  for (const entry of Object.values(scan))
    for (const { reason } of entry.skipped) {
      // A guard reason ends in the line of the hidden read; group by the read itself.
      const key = reason.replace(/:\d+$/, "");
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
  const byCount = (a, b) => b[1] - a[1];
  const worst = Object.entries(scan)
    .map(([file, entry]) => [file, entry.skipped.length])
    .filter(([, count]) => count > 0)
    .sort(byCount);
  return [
    `Compiled ${compiled} of ${compiled + skipped} components and hooks (${share}%); ${skipped} skipped in ${worst.length} files.`,
    "",
    "Reasons:",
    ...[...reasons].sort(byCount).map(([reason, count]) => `  ${count}  ${reason}`),
    "",
    "Files with the most skipped functions:",
    ...worst.slice(0, 30).map(([file, count]) => `  ${count}  ${file}`),
  ].join("\n");
}

function writeBaseline(root, counts) {
  const body = {
    note: "Components and hooks the React Compiler does not compile in the folders it compiles in full, counted per file by scripts/checks/check-compiler-coverage.mjs. Counts may only fall; lower them with --ratchet after a fix. Rule bycoda/compiler-owns-memo allows manual memoization only in the files listed here.",
    counts,
  };
  writeFileSync(path.join(root, baselineFile), `${JSON.stringify(body, null, 2)}\n`);
}

async function main(argv) {
  const root = defaultRoot;
  const scan = await scanTree(root);
  if (argv.includes("--report")) {
    console.log(formatReport(scan));
    return 0;
  }
  if (argv.includes("--write")) {
    writeBaseline(root, countsOf(scan));
    const { compiled, skipped, share } = totals(scan);
    console.log(
      `Compiler coverage: recorded ${skipped} skipped, ${compiled} compiled (${share}%).`,
    );
    return 0;
  }
  const baseline = readBaseline(root);
  const { regressions, improvements } = compareCounts(scan, baseline);
  if (argv.includes("--ratchet")) {
    const lowered = structuredClone(baseline);
    for (const { file, now } of improvements) {
      if (now === 0) delete lowered[file];
      else lowered[file] = { [rule]: now };
    }
    for (const file of Object.keys(lowered)) if (!(file in scan)) delete lowered[file];
    writeBaseline(root, lowered);
    console.log(`Compiler coverage: lowered ${improvements.length} file(s).`);
  }
  if (regressions.length > 0) {
    console.error(formatRegressions(regressions));
    return 1;
  }
  const { compiled, skipped, share } = totals(scan);
  const hint =
    improvements.length > 0 && !argv.includes("--ratchet")
      ? ` ${improvements.length} file(s) improved: run with --ratchet.`
      : "";
  console.log(
    `Compiler coverage: no new skipped function (${compiled} compiled, ${skipped} baseline-tracked, ${share}%).${hint}`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
