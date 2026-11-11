import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, relative, isAbsolute, join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const browserDirectory = join(repositoryRoot, "tests/browser");
export const manifest = JSON.parse(readFileSync(join(browserDirectory, "suites.json"), "utf8"));
const require = createRequire(import.meta.url);

export function selectSuites(names = ["all"], source = manifest) {
  const requested = names.flatMap((name) => name.split(",")).filter(Boolean);
  if (!requested.length) throw new Error("Select at least one browser suite.");
  const ids = requested.flatMap((name) => {
    if (name === "all")
      return source.suites.filter((suite) => !suite.variantOf).map((suite) => suite.id);
    return source.aliases[name] ?? [name];
  });
  return [...new Set(ids)].map((id) => {
    const suite = source.suites.find((entry) => entry.id === id);
    if (!suite) throw new Error(`Unknown browser suite: ${id}. Use --plan to list suites.`);
    return suite;
  });
}

export function validateManifest(source = manifest, files = discoverBrowserFiles()) {
  const errors = [];
  const owners = new Map();
  const ids = new Set();
  for (const suite of source.suites) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(suite.id) || ids.has(suite.id))
      errors.push(`Invalid/duplicate suite id: ${suite.id}`);
    ids.add(suite.id);
    if (!suite.files.length) errors.push(`Empty suite: ${suite.id}`);
    if (
      suite.variantOf &&
      (!suite.reason || !source.suites.some((owner) => owner.id === suite.variantOf))
    ) {
      errors.push(`Variant needs an existing owner and reason: ${suite.id}`);
    }
    const selected = new Set();
    for (const file of suite.files) {
      if (!files.includes(file)) errors.push(`Missing test file: ${suite.id}/${file}`);
      if (selected.has(file)) errors.push(`Duplicate file inside ${suite.id}: ${file}`);
      selected.add(file);
      if (!suite.variantOf) owners.set(file, [...(owners.get(file) ?? []), suite.id]);
    }
    for (const project of suite.projects) {
      if (!project.files.length || project.files.some((file) => !selected.has(file)))
        errors.push(`Invalid project selection: ${suite.id}/${project.name}`);
    }
    for (const file of selected) {
      if (!suite.projects.some((project) => project.files.includes(file)))
        errors.push(`No browser project: ${suite.id}/${file}`);
    }
  }
  for (const file of files) {
    const selected = owners.get(file) ?? [];
    if (selected.length !== 1)
      errors.push(
        `${file}: expected one default owner, found ${selected.length} (${selected.join(", ")})`,
      );
  }
  return {
    errors,
    owners: Object.fromEntries(owners),
    fileCount: files.length,
    suiteCount: source.suites.filter((suite) => !suite.variantOf).length,
  };
}

/** Relative paths (forward slashes) of every file under tests/browser, outside temp/. */
export function listBrowserDirectory() {
  return readdirSync(browserDirectory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(browserDirectory, join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    )
    .filter((path) => !path.startsWith("temp/"));
}

/** Spec basenames; suites and Playwright `testMatch` select files by basename in any folder. */
export function discoverBrowserFiles() {
  const names = listBrowserDirectory()
    .filter((path) => /\.(?:spec|e2e)\.ts$/.test(path))
    .map((path) => path.slice(path.lastIndexOf("/") + 1));
  const duplicate = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicate) throw new Error(`Browser spec basenames must be unique: ${duplicate}`);
  return names.sort();
}

export function artifactPath(value) {
  const target = resolve(repositoryRoot, value);
  const fromTemp = relative(join(repositoryRoot, "temp"), target);
  if (!fromTemp || fromTemp.startsWith("..") || isAbsolute(fromTemp))
    throw new Error("Browser artifacts must be inside this checkout's temp/ directory.");
  return target;
}

export function runPlaywright(args, { env = {}, capture = false } = {}) {
  // CI result aggregation and source-only partition planning need the manifest,
  // not an installed browser runner (e.g. the Python/native jobs skip pnpm install).
  const playwrightCli = require.resolve("@playwright/test/cli");
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [playwrightCli, "test", ...args], {
      cwd: repositoryRoot,
      windowsHide: true,
      env: { ...process.env, ...env },
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    const forward = (signal) => {
      if (!child.killed) child.kill(signal);
    };
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      done({ code: code ?? 1, signal, stdout, stderr });
    });
  });
}

export function listedCases(report) {
  const result = [];
  const visit = (suites, parents = []) => {
    for (const suite of suites ?? []) {
      const titles = suite.title ? [...parents, suite.title] : parents;
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          const file = spec.file.replaceAll("\\", "/").split("/").at(-1);
          result.push({
            file,
            line: spec.line,
            title: [...titles.slice(1), spec.title].join(" > "),
            project: test.projectName || "chromium",
          });
        }
      }
      visit(suite.suites, titles);
    }
  };
  visit(report.suites);
  return result;
}

export function selectionKey(entry) {
  return JSON.stringify([entry.file, entry.line, entry.title, entry.project]);
}

export function compareSelections(before, after) {
  const left = new Set(before.map(selectionKey));
  const right = new Set(after.map(selectionKey));
  return {
    missing: [...left].filter((key) => !right.has(key)),
    added: [...right].filter((key) => !left.has(key)),
    before: left.size,
    after: right.size,
  };
}
