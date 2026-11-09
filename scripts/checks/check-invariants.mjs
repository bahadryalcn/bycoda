/**
 * Code invariants ratchet. Two engines, one baseline:
 *
 *   - ast-grep structural rules in scripts/checks/invariants/rules/*.yml (TypeScript and Rust)
 *   - oxlint restricted-API rules in .oxlint-invariants.json (TypeScript)
 *
 * Existing findings are counted per (file, rule) in scripts/checks/invariants-baseline.json.
 * Only counts above the baseline fail, so debt stays visible without blocking unrelated work.
 * Every rule explains the sanctioned alternative; docs/reference/code-invariants.md is the index.
 *
 *   node scripts/checks/check-invariants.mjs                    fail on new findings (whole tree)
 *   node scripts/checks/check-invariants.mjs --files a.ts b.rs   limit the comparison to files
 *   node scripts/checks/check-invariants.mjs --update-baseline  rewrite the baseline from the tree
 *   node scripts/checks/check-invariants.mjs --ratchet          lower baseline buckets only
 *   node scripts/checks/check-invariants.mjs --report           totals per rule and folder
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareCounts, countFindings, sortedCounts } from "./check-ui-drift.mjs";
import { checkPrivacyWriterCalls } from "./check-privacy-writers.mjs";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
export const baselineFile = "scripts/checks/invariants-baseline.json";
export const astGrepConfig = "scripts/checks/invariants/sgconfig.yml";
export const oxlintConfig = ".oxlint-invariants.json";
/** Roots the oxlint engine scans; ast-grep applies its own per-rule globs under the tree. */
const oxlintRoots = ["src", "host", "packages"];
const astGrepRoots = ["src", "host", "packages", "src-tauri/src"];

const normalize = (file) => file.replaceAll("\\", "/").replace(/^\.\//, "");

function run(root, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function astGrepBinary(root) {
  const installer = path.join(root, "node_modules", "@ast-grep", "cli", "postinstall.js");
  if (!fs.existsSync(installer))
    throw new Error("ast-grep is not installed; run pnpm install before the invariants check");
  const binary = createRequire(import.meta.url)(installer).resolveBinaryPath();
  if (!binary) throw new Error("ast-grep native binary is missing; install optional dependencies");
  return binary;
}

/** ast-grep findings as { file, rule, line, text, message }. */
export function scanAstGrep(root, files) {
  const targets = files ?? astGrepRoots.filter((dir) => fs.existsSync(path.join(root, dir)));
  if (!targets.length) return [];
  const result = run(root, astGrepBinary(root), [
    "scan",
    "--config",
    astGrepConfig,
    "--json=compact",
    ...targets,
  ]);
  // ast-grep exits 1 when it reports findings; anything else is a tool failure.
  if (result.status !== 0 && result.status !== 1)
    throw new Error(`ast-grep failed (${result.status}): ${result.stderr}`);
  const matches = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  return matches.map((match) => ({
    file: normalize(match.file),
    rule: match.ruleId,
    line: match.range.start.line + 1,
    text: match.lines.trim().slice(0, 160),
    message: match.message,
  }));
}

/** oxlint findings from the invariants configuration, same shape. */
export function scanOxlint(root, files) {
  const targets = files
    ? files.filter((file) => /\.[cm]?[jt]sx?$/.test(file))
    : oxlintRoots.filter((dir) => fs.existsSync(path.join(root, dir)));
  if (!targets.length) return [];
  const result = run(root, process.execPath, [
    path.join(root, "node_modules", "oxlint", "bin", "oxlint"),
    "--config",
    oxlintConfig,
    "--format",
    "json",
    ...targets,
  ]);
  if (result.status !== 0 && result.status !== 1)
    throw new Error(`oxlint failed (${result.status}): ${result.stderr}`);
  return parseOxlintOutput(result.stdout, result.status);
}

/** Tool-level diagnostics cannot be assigned to a baseline bucket. */
export function parseOxlintOutput(stdout, status) {
  let output;
  try {
    output = JSON.parse(stdout);
  } catch {
    throw new Error(`oxlint returned invalid JSON: ${stdout.slice(0, 500)}`);
  }
  if (!output || !Array.isArray(output.diagnostics))
    throw new Error("oxlint returned malformed output: missing diagnostics array");
  if (status !== 0 && output.diagnostics.length === 0)
    throw new Error(`oxlint failed (${status}) without diagnostics`);
  return output.diagnostics.map((diagnostic) => {
    if (
      !diagnostic ||
      typeof diagnostic.filename !== "string" ||
      !diagnostic.filename ||
      typeof diagnostic.code !== "string" ||
      !diagnostic.code ||
      typeof diagnostic.message !== "string"
    ) {
      const detail =
        typeof diagnostic?.message === "string" ? diagnostic.message : JSON.stringify(diagnostic);
      throw new Error(`oxlint reported a tool diagnostic: ${detail}`);
    }
    return {
      file: normalize(diagnostic.filename),
      rule: diagnostic.code
        .replace(/^eslint\(/, "oxlint(")
        .replace(/^(\w[\w-]*)\((.+)\)$/, "$1/$2"),
      line: diagnostic.labels?.[0]?.span?.line ?? 0,
      text: diagnostic.message.slice(0, 160),
      message: diagnostic.help ?? diagnostic.message,
    };
  });
}

export function scanAll(root, files) {
  return [...scanAstGrep(root, files), ...scanOxlint(root, files)].sort(
    (a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file) || a.line - b.line,
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

/** Programmatic entry: compares the current tree (or `files`) against the baseline. */
export function checkInvariants({ root = defaultRoot, files } = {}) {
  const baseline = readBaseline(root);
  if (!baseline) return { success: true, skipped: `${baselineFile} is missing`, regressions: [] };
  const scope = files ? files.map(normalize) : undefined;
  const findings = scanAll(root, scope);
  const current = countFindings(findings);
  const result = compareCounts(current, baseline, scope ? new Set(scope) : undefined);
  const regressions = result.regressions.map((bucket) => ({
    ...bucket,
    items: findings.filter((item) => item.file === bucket.file && item.rule === bucket.rule),
  }));
  const privacyCalls = checkPrivacyWriterCalls({ root, files: scope });
  for (const item of privacyCalls) {
    const rule = "privacy-writer-outside-fence";
    regressions.push({
      file: item.file,
      rule,
      count: 1,
      baseline: 0,
      items: [
        {
          file: item.file,
          line: item.line,
          rule,
          message:
            "Privacy writers must run inside withRoomPrivacyMutation or a reviewed delegate.",
          text: item.text,
        },
      ],
    });
  }
  return { success: regressions.length === 0, ...result, regressions, findings, current };
}

export function formatRegressions(regressions) {
  const out = [];
  let rule = null;
  for (const bucket of regressions) {
    if (bucket.rule !== rule) {
      rule = bucket.rule;
      out.push(`\n${rule}: ${bucket.items[0]?.message ?? ""}`);
    }
    out.push(`  ${bucket.file}: ${bucket.count} (baseline ${bucket.baseline})`);
    for (const item of bucket.items.slice(0, 12))
      out.push(`    ${item.file}:${item.line}  ${item.text}`);
    if (bucket.items.length > 12) out.push(`    … ${bucket.items.length - 12} more`);
  }
  out.push(
    "\nFix the new finding, or suppress one line with a reason: `// ast-grep-ignore: <rule> -- <why>` or `// oxlint-disable-next-line <rule> -- <why>`. See docs/reference/code-invariants.md.",
  );
  return out.join("\n");
}

const folderOf = (file) =>
  /^(?:src\/(?:features|app|shared|platform|integrations)\/[^/]+|host|packages\/[^/]+|src-tauri)/.exec(
    file,
  )?.[0] ?? "other";

export function formatReport(findings) {
  const byRule = new Map();
  const byFolder = new Map();
  for (const { file, rule } of findings) {
    byRule.set(rule, (byRule.get(rule) ?? 0) + 1);
    byFolder.set(folderOf(file), (byFolder.get(folderOf(file)) ?? 0) + 1);
  }
  const table = (map) =>
    [...map]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => `  ${String(count).padStart(5)}  ${name}`);
  return [
    `Code invariants report: ${findings.length} findings`,
    "\nPer rule:",
    ...table(byRule),
    "\nPer folder:",
    ...table(byFolder),
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
        options.files.push(normalize(args[++index]));
    } else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

export function writeBaseline(root, counts) {
  fs.writeFileSync(
    path.join(root, baselineFile),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        purpose:
          "Existing code-invariant findings counted per file and rule by scripts/checks/check-invariants.mjs. Counts may only fall; regenerate with --update-baseline after reducing them and review the diff.",
        counts,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = defaultRoot;
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.update || options.ratchet || options.report) {
      const findings = scanAll(root);
      if (options.report) process.stdout.write(formatReport(findings));
      if (options.update || options.ratchet) {
        const previous = readBaseline(root);
        let counts = sortedCounts(countFindings(findings));
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
        writeBaseline(root, counts);
        const total = Object.values(counts)
          .flatMap(Object.values)
          .reduce((sum, count) => sum + count, 0);
        console.log(
          `Wrote ${baselineFile}: ${total} findings in ${Object.keys(counts).length} files (${improvements.length} buckets lowered, ${regressions.length} raised).`,
        );
        for (const bucket of previous ? regressions : [])
          console.log(
            `  raised ${bucket.file} ${bucket.rule}: ${bucket.baseline} -> ${bucket.count}`,
          );
      }
    } else {
      const result = checkInvariants({ root, files: options.files });
      if (result.skipped) console.log(`Code invariants: skipped (${result.skipped})`);
      else if (result.success)
        console.log(
          `Code invariants: no new findings (${result.findings.length} known, ${result.improvements.length} buckets below baseline).`,
        );
      else {
        console.error(
          `Code invariants: ${result.regressions.length} bucket(s) above baseline.` +
            formatRegressions(result.regressions),
        );
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
