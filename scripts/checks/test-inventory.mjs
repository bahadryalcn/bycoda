import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { checkInventory } from "./browser-test-inventory.mjs";
import { repositoryRoot, manifest } from "./browser-test-support.mjs";

function filesUnder(directory, suffix) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path, suffix) : path.endsWith(suffix) ? [path] : [];
  });
}

export function ignoredRustTests(root = join(repositoryRoot, "src-tauri/src")) {
  return filesUnder(root, ".rs").flatMap((path) => {
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    const result = [];
    for (let index = 0; index < lines.length; index++) {
      if (!/^\s*#\[ignore(?:\s*=\s*".*")?\]/.test(lines[index])) continue;
      const following = lines.slice(index + 1, index + 14).join("\n");
      const name = following.match(/(?:async\s+)?fn\s+([A-Za-z0-9_]+)/)?.[1];
      if (!name) throw new Error(`Ignored Rust test without nearby function: ${path}:${index + 1}`);
      const comment = lines
        .slice(Math.max(0, index - 5), index)
        .filter((line) => /^\s*\/\//.test(line))
        .map((line) => line.trim().replace(/^\/+/g, "").trim())
        .join(" ");
      const reason = lines[index].match(/#\[ignore\s*=\s*"(.*)"\]/)?.[1] ?? comment;
      const context = `${name} ${reason}`;
      const category = /helper invoked|invoked only by parent|parent crash|without unwinding/.test(
        context,
      )
        ? "parent-invoked-helper"
        : /real_store|real.*logs|Termius profile/.test(context)
          ? "owner-authorized-personal-data"
          : /timings|paging cost/.test(context)
            ? "manual-performance"
            : "native-fixture";
      result.push({
        path: relative(repositoryRoot, path).replaceAll("\\", "/"),
        line: index + 1,
        name,
        reason: reason || "No reason recorded; inspect before authorizing this test.",
        category,
        execution: "not-run",
        acceptanceOwner: "Owner/platform maintainer; not assigned by this inventory",
      });
    }
    return result;
  });
}

export function inventory() {
  const browser = checkInventory();
  const ignored = ignoredRustTests();
  const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8"));
  return {
    schemaVersion: 1,
    evidence: "source-inventory-only",
    commands: Object.fromEntries(
      Object.entries(packageJson.scripts).filter(([name]) =>
        /^(pretest|test|prehost:test|host:test|check|build|host:build)/.test(name),
      ),
    ),
    browser: {
      fileCount: browser.fileCount,
      suites: manifest.suites.map((suite) => ({
        id: suite.id,
        files: suite.files,
        projects: suite.projects,
        variantOf: suite.variantOf ?? null,
      })),
      errors: browser.errors,
    },
    rustIgnored: ignored,
    mobile: {
      separateRepository: existsSync(join(repositoryRoot, "mobile/.git")),
      execution: "not-run",
      commands:
        "Run test/typecheck from mobile/ with its own dependencies; device acceptance is separate.",
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = inventory();
    if (result.browser.errors.length) throw new Error(result.browser.errors.join("\n"));
    if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(
        `${result.browser.fileCount} browser files have one default owner; ${result.rustIgnored.length} ignored Rust tests/helpers inventoried (not executed).`,
      );
      for (const test of result.rustIgnored)
        console.log(`${test.path}:${test.line} ${test.name} [${test.category}]: ${test.reason}`);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
