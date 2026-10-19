import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Optional debt check; normal development lint remains available independently.
const root = fileURLToPath(new URL("../../", import.meta.url));
const baselinePath = new URL("./lint-baseline.json", import.meta.url);
const counts = {};
const owners = {};
let errors = 0;
for (const args of [["."], ["--config", ".oxlint-hooks.json", "src"]]) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/oxlint/bin/oxlint", ...args, "--format", "json"],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? result.stderr ?? "Lint failed");
    process.exit(1);
  }
  const { diagnostics } = JSON.parse(result.stdout);
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errors++;
    const filename = diagnostic.filename.replaceAll("\\", "/");
    const key = `${filename}|${diagnostic.code}`;
    counts[key] = (counts[key] ?? 0) + 1;
    const parts = filename.split("/");
    const owner = parts[0] === "src" ? parts.slice(0, 3).join("/") : parts[0];
    owners[owner] = (owners[owner] ?? 0) + 1;
  }
}
if (process.argv.includes("--update")) {
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
  const increases = Object.entries(counts).filter(([key, count]) => count > (baseline[key] ?? 0));
  for (const [key, count] of increases) console.error(`+${count - (baseline[key] ?? 0)} ${key}`);
  if (increases.length || errors) process.exitCode = 1;
  console.log(`${increases.length} increased file/rule counts; ${errors} errors.`);
}
for (const [owner, count] of Object.entries(owners).sort((a, b) => b[1] - a[1]))
  console.log(`${count}\t${owner}`);
