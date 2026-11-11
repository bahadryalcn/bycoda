import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Required CI gate (and `pnpm check:changed` via --files): lint findings may only fall
// per file and rule. Counts for files absent from the baseline start at zero.
// Lint debt is every rule the `lint` block of vite.config.ts reports as a warning; rules set to "error" are the
// code invariants, which check-invariants.mjs ratchets against its own baseline.
const root = fileURLToPath(new URL("../../", import.meta.url));
const baselinePath = new URL("./lint-baseline.json", import.meta.url);
const LINTABLE = /\.[cm]?[jt]sx?$/;

/**
 * Compare per `file|rule` counts with the baseline.
 * Fails on any increase (absent baseline entry = 0).
 */
export function compareLintCounts({ counts, baseline }) {
  const increases = Object.entries(counts)
    .filter(([key, count]) => count > (baseline[key] ?? 0))
    .map(([key, count]) => ({ key, added: count - (baseline[key] ?? 0) }));
  return { increases, failed: increases.length > 0 };
}

function lint(args) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/vite-plus/bin/vp", "lint", ...args, "--format", "json"],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 600000,
    },
  );
  // oxlint exits 1 when a rule set to "error" reports; anything else is a tool failure.
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    console.error(result.error?.message ?? result.stderr ?? "Lint failed");
    process.exit(1);
  }
  return JSON.parse(result.stdout).diagnostics.filter(
    (diagnostic) => diagnostic.severity !== "error",
  );
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
  const counts = {};
  const owners = {};
  const targets = files ?? ["."];
  if (targets.length) {
    for (const diagnostic of lint(targets)) {
      const filename = diagnostic.filename.replaceAll("\\", "/");
      const key = `${filename}|${diagnostic.code}`;
      counts[key] = (counts[key] ?? 0) + 1;
      const parts = filename.split("/");
      const owner = parts[0] === "src" ? parts.slice(0, 3).join("/") : parts[0];
      owners[owner] = (owners[owner] ?? 0) + 1;
    }
  }
  if (argv.includes("--update")) {
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
    const result = compareLintCounts({ counts, baseline });
    for (const { key, added } of result.increases) console.error(`+${added} ${key}`);
    if (result.failed) process.exitCode = 1;
    console.log(`${result.increases.length} increased file/rule counts.`);
  }
  if (!files)
    for (const [owner, count] of Object.entries(owners).sort((a, b) => b[1] - a[1]))
      console.log(`${count}\t${owner}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main(process.argv.slice(2));
