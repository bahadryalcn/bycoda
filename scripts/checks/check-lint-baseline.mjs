import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Required CI gate (and `pnpm check:changed` via --files): lint findings may only fall
// per file and rule. Counts for files absent from the baseline start at zero.
const root = fileURLToPath(new URL("../../", import.meta.url));
const baselinePath = new URL("./lint-baseline.json", import.meta.url);
const LINTABLE = /\.[cm]?[jt]sx?$/;

/**
 * Compare per `file|rule` counts with the baseline.
 * Fails on any increase (absent baseline entry = 0) or any error-severity diagnostic.
 */
export function compareLintCounts({ counts, baseline, errors = 0 }) {
  const increases = Object.entries(counts)
    .filter(([key, count]) => count > (baseline[key] ?? 0))
    .map(([key, count]) => ({ key, added: count - (baseline[key] ?? 0) }));
  return { increases, errors, failed: increases.length > 0 || errors > 0 };
}

function lint(args) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/oxlint/bin/oxlint", ...args, "--format", "json"],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 600000,
    },
  );
  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? result.stderr ?? "Lint failed");
    process.exit(1);
  }
  return JSON.parse(result.stdout).diagnostics;
}

function main(argv) {
  const filesAt = argv.indexOf("--files");
  const files =
    filesAt === -1
      ? null
      : argv
          .slice(filesAt + 1)
          .map((file) => path.relative(root, path.resolve(root, file)).replaceAll("\\", "/"))
          .filter((file) => LINTABLE.test(file) && existsSync(path.join(root, file)));
  if (files && argv.includes("--update")) throw new Error("--files never writes the baseline");
  const runs = files
    ? [files, files.filter((file) => file.startsWith("src/"))].map((list, index) => ({
        list,
        args: index ? ["--config", ".oxlint-hooks.json"] : [],
      }))
    : [
        { list: ["."], args: [] },
        { list: ["src"], args: ["--config", ".oxlint-hooks.json"] },
      ];
  const counts = {};
  const owners = {};
  let errors = 0;
  for (const { list, args } of runs) {
    if (!list.length) continue;
    for (const diagnostic of lint([...args, ...list])) {
      if (diagnostic.severity === "error") errors++;
      const filename = diagnostic.filename.replaceAll("\\", "/");
      const key = `${filename}|${diagnostic.code}`;
      counts[key] = (counts[key] ?? 0) + 1;
      const parts = filename.split("/");
      const owner = parts[0] === "src" ? parts.slice(0, 3).join("/") : parts[0];
      owners[owner] = (owners[owner] ?? 0) + 1;
    }
  }
  if (argv.includes("--update")) {
    if (errors) throw new Error("Cannot baseline lint errors");
    writeFileSync(
      baselinePath,
      JSON.stringify(
        { version: 1, counts: Object.fromEntries(Object.entries(counts).sort()) },
        null,
        2,
      ) + "\n",
    );
    console.log("Updated reviewed lint debt counts; review the baseline diff.");
  } else {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")).counts;
    const result = compareLintCounts({ counts, baseline, errors });
    for (const { key, added } of result.increases) console.error(`+${added} ${key}`);
    if (result.failed) process.exitCode = 1;
    console.log(`${result.increases.length} increased file/rule counts; ${errors} errors.`);
  }
  if (!files)
    for (const [owner, count] of Object.entries(owners).sort((a, b) => b[1] - a[1]))
      console.log(`${count}\t${owner}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main(process.argv.slice(2));
