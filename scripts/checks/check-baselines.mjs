/**
 * Guards the ratchet baselines against being raised without a recorded reason.
 *
 * Each baseline in the working tree is compared with the same file at a base ref, per
 * rule and summed over all files, so moving a finding between files is not a rise. A
 * rise is accepted only through an entry in baseline-approvals.json whose `from` equals
 * the base total (so it stops applying once merged) and whose `to` covers the new total.
 *
 * Usage: node scripts/checks/check-baselines.mjs [--base <ref>]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const checksDir = "scripts/checks";
const approvalsFile = "baseline-approvals.json";

function countsOf(json, file) {
  const counts = json?.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts))
    throw new Error(`${file}: "counts" must be an object`);
  return counts;
}

function addTotal(totals, rule, amount) {
  totals.set(rule, (totals.get(rule) ?? 0) + amount);
}

/** counts[file][rule]; `file-lines` stores a line count, so it counts carrying files. */
function nestedTotals(json, file) {
  const totals = new Map();
  for (const [source, rules] of Object.entries(countsOf(json, file))) {
    if (!rules || typeof rules !== "object") throw new Error(`${file}: bad entry for ${source}`);
    for (const [rule, value] of Object.entries(rules)) {
      if (!Number.isFinite(value)) throw new Error(`${file}: bad count for ${source} ${rule}`);
      addTotal(totals, rule, rule === "file-lines" ? 1 : value);
    }
  }
  return totals;
}

/** counts["file|rule"]; rule ids such as `eslint(no-unused-vars)` never contain "|". */
function lintTotals(json, file) {
  const totals = new Map();
  for (const [key, value] of Object.entries(countsOf(json, file))) {
    const split = key.lastIndexOf("|");
    if (split < 0 || !Number.isFinite(value)) throw new Error(`${file}: bad entry ${key}`);
    addTotal(totals, key.slice(split + 1), value);
  }
  return totals;
}

/** counts[file] = error count; all of it is one pseudo-rule. */
function testTypeTotals(json, file) {
  const totals = new Map();
  for (const [source, value] of Object.entries(countsOf(json, file))) {
    if (!Number.isFinite(value)) throw new Error(`${file}: bad count for ${source}`);
    addTotal(totals, "type-errors", value);
  }
  return totals;
}

/** Each baseline names how its JSON turns into per-rule totals. */
export const baselines = [
  { file: "invariants-baseline.json", totals: nestedTotals },
  { file: "code-structure-baseline.json", totals: nestedTotals },
  { file: "ui-drift-baseline.json", totals: nestedTotals },
  { file: "lint-baseline.json", totals: lintTotals },
  { file: "test-types-baseline.json", totals: testTypeTotals },
];

export function parseApprovals(json) {
  if (!Array.isArray(json?.approvals))
    throw new Error(`${approvalsFile}: "approvals" must be an array`);
  return json.approvals.map((entry, index) => {
    const where = `${approvalsFile}: approvals[${index}]`;
    for (const key of ["baseline", "rule", "reason"])
      if (typeof entry?.[key] !== "string" || !entry[key].trim())
        throw new Error(`${where} needs a non-empty "${key}"`);
    for (const key of ["from", "to"])
      if (!Number.isInteger(entry[key]) || entry[key] < 0)
        throw new Error(`${where} needs a non-negative integer "${key}"`);
    return entry;
  });
}

/**
 * @param {{ baseline: string, base: Map<string, number>, current: Map<string, number>, approvals: object[] }} input
 * @returns {{ failures: string[], notices: string[] }}
 */
export function compareBaseline({ baseline, base, current, approvals }) {
  const failures = [];
  const notices = [];
  const mine = approvals.filter((entry) => entry.baseline === baseline);
  const used = new Set();
  for (const [rule, now] of [...current].sort(([a], [b]) => a.localeCompare(b))) {
    const before = base.get(rule) ?? 0;
    if (now <= before) continue;
    const approval = mine.find(
      (entry) => entry.rule === rule && entry.from === before && entry.to >= now,
    );
    if (approval) {
      used.add(approval);
      continue;
    }
    const near = mine.find((entry) => entry.rule === rule);
    const hint = near
      ? ` The approval has from ${near.from} to ${near.to}, which does not cover ${before} to ${now}.`
      : "";
    failures.push(
      `${baseline}: ${rule} rose from ${before} to ${now}. Reduce the findings instead, or record an approval in ${checksDir}/${approvalsFile} with "from": ${before}, "to": ${now} and a reason.${hint}`,
    );
  }
  for (const entry of mine)
    if (!used.has(entry))
      notices.push(
        `${baseline}: approval for ${entry.rule} (from ${entry.from}, to ${entry.to}) no longer applies; delete it from ${approvalsFile}.`,
      );
  return { failures, notices };
}

export function unknownApprovalNotices(approvals) {
  const known = new Set(baselines.map((entry) => entry.file));
  return approvals
    .filter((entry) => !known.has(entry.baseline))
    .map(
      (entry) => `${approvalsFile}: approval names unknown baseline ${entry.baseline}; delete it.`,
    );
}

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 60000,
    windowsHide: true,
  });
}

export function resolveBase(requested) {
  try {
    if (requested) return git(["rev-parse", "--verify", `${requested}^{commit}`]).trim();
    return git(["merge-base", "HEAD", "origin/main"]).trim();
  } catch {
    return null;
  }
}

function readAtBase(base, file) {
  let text;
  try {
    text = git(["show", `${base}:${checksDir}/${file}`]);
  } catch {
    // Absent at the base (a new baseline) counts as empty.
    return { counts: {} };
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${file} at ${base} is not valid JSON`);
  }
}

function readCurrent(file) {
  const full = path.join(root, checksDir, file);
  if (!existsSync(full)) return { counts: {} };
  try {
    return JSON.parse(readFileSync(full, "utf8"));
  } catch {
    throw new Error(`${file} is not valid JSON`);
  }
}

export function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--base") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --base");
      options.base = value;
    } else throw new Error(`Unknown argument ${args[index]}`);
  }
  return options;
}

export function main(args = process.argv.slice(2)) {
  let approvals;
  const results = [];
  try {
    const options = parseArguments(args);
    approvals = parseApprovals(
      JSON.parse(readFileSync(path.join(root, checksDir, approvalsFile), "utf8")),
    );
    const base = resolveBase(options.base);
    if (!base) {
      console.log(
        `Baseline guard skipped: no base commit is available${options.base ? ` for ${options.base}` : " (merge base of HEAD and origin/main)"}. Pass --base <ref> or fetch more history.`,
      );
      return 0;
    }
    for (const { file, totals } of baselines)
      results.push(
        compareBaseline({
          baseline: file,
          base: totals(readAtBase(base, file), `${file} at ${base}`),
          current: totals(readCurrent(file), file),
          approvals,
        }),
      );
    console.log(
      `Baseline guard: compared ${baselines.length} baselines with ${base.slice(0, 12)}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  for (const notice of [
    ...results.flatMap((result) => result.notices),
    ...unknownApprovalNotices(approvals),
  ])
    console.log(`Notice: ${notice}`);
  const failures = results.flatMap((result) => result.failures);
  for (const failure of failures) console.error(failure);
  return failures.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
