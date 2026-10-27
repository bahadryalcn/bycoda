/** Optional index-only format/lint check. Never edits or stages owner files. */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const defaultRoot = fileURLToPath(new URL("../../", import.meta.url));
const supported = /\.(?:[cm]?[jt]sx?|jsonc?|ya?ml|md|css|html|toml)$/;
const code = /\.[cm]?[jt]sx?$/;
export function stagedBlobs(root = defaultRoot) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  const paths = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  return paths
    .filter((file) => supported.test(file) && !file.startsWith("vendor/"))
    .map((file) => {
      if (isAbsolute(file) || file.split(/[\\/]/).includes(".."))
        throw new Error("Invalid staged path");
      const entry = git("ls-files", "--stage", "-z", "--", file)
        .toString("utf8")
        .split("\0")
        .filter(Boolean);
      if (entry.length !== 1) throw new Error(`Unmerged/ambiguous staged file: ${file}`);
      const match = /^100(?:644|755) ([a-f0-9]{40}) 0\t/.exec(entry[0]);
      if (!match) throw new Error(`Only regular resolved files can be checked: ${file}`);
      const bytes = git("cat-file", "blob", match[1]);
      if (bytes.includes(0) || bytes.length > 2 * 1024 * 1024)
        throw new Error(`Binary/oversized staged source needs separate review: ${file}`);
      return { file, text: bytes.toString("utf8") };
    });
}
export function checkStaged({ root = defaultRoot, runTool } = {}) {
  const blobs = stagedBlobs(root);
  if (!blobs.length) return { evidence: "staged-source-only", checked: [], success: true };
  const require = createRequire(join(root, "package.json"));
  const tool = (name) => {
    const manifestPath = require.resolve(`${name}/package.json`);
    const manifest = require(manifestPath);
    const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin[name];
    return resolve(dirname(manifestPath), bin);
  };
  const execute =
    runTool ??
    ((name, args, input) =>
      spawnSync(process.execPath, [tool(name), ...args], {
        cwd: root,
        input,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      }));
  const cache = join(root, "temp/build");
  mkdirSync(cache, { recursive: true });
  const snapshot = mkdtempSync(join(cache, "staged-check-"));
  const location = relative(realpathSync(cache), realpathSync(snapshot));
  if (!location || location.startsWith("..") || isAbsolute(location))
    throw new Error("Unsafe staged snapshot location");
  const checked = [];
  try {
    for (const { file, text } of blobs) {
      const format = execute("oxfmt", ["--stdin-filepath", file], text);
      if (format.error || format.status !== 0)
        throw new Error(
          `Staged formatting failed: ${file}: ${format.error?.message ?? format.stderr}`,
        );
      if (format.stdout !== text)
        throw new Error(
          `Format the staged version of ${file}; working files and index were not changed`,
        );
      if (code.test(file)) {
        const copy = resolve(snapshot, file);
        const within = relative(snapshot, copy);
        if (within.startsWith("..") || isAbsolute(within))
          throw new Error("Staged snapshot escaped its root");
        mkdirSync(dirname(copy), { recursive: true });
        writeFileSync(copy, text);
        const configs = [
          ".oxlintrc.json",
          ...(file.startsWith("src/") && /\.[jt]sx?$/.test(file) ? [".oxlint-hooks.json"] : []),
        ];
        for (const config of configs) {
          const lint = execute("oxlint", [
            "--no-ignore",
            "--config",
            join(root, config),
            "--tsconfig",
            join(root, "tsconfig.json"),
            copy,
          ]);
          if (lint.error || lint.status !== 0)
            throw new Error(
              `Staged lint failed: ${file}: ${lint.error?.message ?? lint.stderr ?? "lint error"}`,
            );
        }
      }
      checked.push(file);
    }
    return {
      evidence: "staged-source-only",
      checked,
      success: true,
      excluded: "Full tests, typecheck, builds, installed/live acceptance",
    };
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2)
    throw new Error("Usage: node scripts/checks/check-staged.mjs (read-only)");
  try {
    console.log(JSON.stringify(checkStaged(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
