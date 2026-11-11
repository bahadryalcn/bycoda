import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { browserCiVariants, expectedCiSelection } from "./browser-ci.mjs";
import {
  manifest,
  repositoryRoot,
  browserDirectory,
  listBrowserDirectory,
  validateManifest,
  runPlaywright,
  listedCases,
  compareSelections,
  artifactPath,
  selectionKey,
} from "./browser-test-support.mjs";

async function discover(config, env = {}) {
  const result = await runPlaywright(["--config", config, "--list", "--reporter=json"], {
    env,
    capture: true,
  });
  if (result.code !== 0)
    throw new Error(
      `List-only discovery failed for ${env.BYCODA_BROWSER_SUITE ?? config}:\n${result.stderr}\n${result.stdout}`,
    );
  const report = JSON.parse(result.stdout);
  if (report.errors?.length) throw new Error(JSON.stringify(report.errors));
  return listedCases(report);
}

async function mapLimited(items, callback, concurrency = 3) {
  const result = Array.from({ length: items.length });
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const index = next++;
        result[index] = await callback(items[index], index);
      }
    }),
  );
  return result;
}

export function checkInventory() {
  const result = validateManifest();
  const registered = new Set(
    [
      ...readFileSync(join(browserDirectory, "fixture-configs.ts"), "utf8").matchAll(
        /^\s*["']([^"']+)["']\s*:/gm,
      ),
    ].map((match) => match[1]),
  );
  for (const suite of manifest.suites)
    if (!registered.has(suite.config))
      result.errors.push(
        `Suite has no registered runner configuration: ${suite.id}/${suite.config}`,
      );
  const configurations = new Set([
    ...manifest.suites.map((suite) => suite.config),
    ...manifest.legacySelections.map((entry) => entry.config),
  ]);
  for (const config of configurations)
    if (!existsSync(join(repositoryRoot, config)))
      result.errors.push(`Missing configuration: ${config}`);
  for (const suite of manifest.suites)
    if (!existsSync(join(repositoryRoot, suite.fixture.config)))
      result.errors.push(`Missing Vite fixture: ${suite.fixture.config}`);
  for (const file of listBrowserDirectory()) {
    if (
      (file.includes("playwright") && file.endsWith(".config.ts")) ||
      file.endsWith("/session-deletion.config.ts")
    ) {
      if (["runner.playwright.config.ts"].includes(file)) continue;
      if (!configurations.has(`tests/browser/${file}`))
        result.errors.push(`Configuration missing from manifest: ${file}`);
    }
  }
  return {
    ...result,
    variants: manifest.suites
      .filter((suite) => suite.variantOf)
      .map((suite) => ({ id: suite.id, owner: suite.variantOf, reason: suite.reason })),
    aliases: manifest.aliases,
  };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      check: { type: "boolean" },
      "capture-legacy": { type: "string" },
      "verify-list": { type: "boolean" },
      partitions: { type: "boolean" },
      baseline: { type: "string" },
      output: { type: "string" },
      json: { type: "boolean" },
    },
  });
  const inventory = checkInventory();
  if (inventory.errors.length) throw new Error(inventory.errors.join("\n"));
  const report = {
    schemaVersion: 1,
    evidence: "selection-inventory",
    fileCount: inventory.fileCount,
    defaultSuites: inventory.suiteCount,
    variants: inventory.variants,
    errors: [],
  };
  if (values["capture-legacy"]) {
    report.evidence = "legacy-list-only";
    report.selections = await mapLimited(manifest.legacySelections, async (entry) => ({
      config: entry.config,
      cases: await discover(entry.config),
    }));
    const target = artifactPath(values["capture-legacy"]);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2));
    console.log(
      `Legacy selection captured: ${report.selections.length} configurations; ${relative(repositoryRoot, target)}`,
    );
  } else if (values["verify-list"]) {
    report.evidence = "list-only-parity";
    report.selections = await mapLimited(manifest.suites, async (suite) => ({
      suite: suite.id,
      variantOf: suite.variantOf ?? null,
      cases: await discover("tests/browser/runner.playwright.config.ts", {
        BYCODA_BROWSER_SUITE: suite.id,
      }),
    }));
    const defaults = report.selections.filter((entry) => !entry.variantOf);
    const keys = defaults.flatMap((entry) => entry.cases.map(selectionKey));
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    if (duplicates.length)
      report.errors.push(
        `Duplicate default test identities: ${[...new Set(duplicates)].join("\n")}`,
      );
    const actualFiles = new Set(defaults.flatMap((entry) => entry.cases.map((test) => test.file)));
    for (const file of Object.keys(inventory.owners))
      if (!actualFiles.has(file)) report.errors.push(`Owner did not discover ${file}`);
    if (values.baseline) {
      const baseline = JSON.parse(readFileSync(values.baseline, "utf8").replace(/^\uFEFF/, ""));
      report.parity = compareSelections(
        baseline.selections.flatMap((entry) => entry.cases),
        report.selections.flatMap((entry) => entry.cases),
      );
      if (report.parity.missing.length || report.parity.added.length)
        report.errors.push(
          `Selection changed: ${report.parity.missing.length} missing, ${report.parity.added.length} added`,
        );
    }
    if (values.partitions) {
      const assigned = new Set();
      report.partitions = browserCiVariants().map((variant) => {
        const selection = expectedCiSelection(variant.variant);
        const cases = selection.suites.flatMap((suite) => {
          const discovered = report.selections
            .find((entry) => entry.suite === suite.id)
            .cases.filter((entry) => entry.project === variant.project);
          for (const entry of discovered) {
            const key = `${suite.id}/${selectionKey(entry)}`;
            if (assigned.has(key)) report.errors.push(`Duplicate CI partition case: ${key}`);
            assigned.add(key);
          }
          return discovered;
        });
        return {
          variant: variant.variant,
          suites: selection.suites.length,
          cases: cases.length,
          selectionDigest: selection.digest,
        };
      });
      const full = report.selections.flatMap((entry) =>
        entry.cases.map((test) => `${entry.suite}/${selectionKey(test)}`),
      );
      for (const key of full)
        if (!assigned.has(key)) report.errors.push(`Missing CI partition case: ${key}`);
      report.partitionCases = assigned.size;
      console.log(
        `Full CI partitions: ${report.partitions.length}, ${assigned.size} suite/browser cases including explicit variants; ${report.errors.length} errors.`,
      );
    }
    console.log(
      `List-only: ${actualFiles.size} files, ${keys.length} default browser cases, ${duplicates.length} duplicate default identities.`,
    );
    if (report.parity)
      console.log(
        `Before/after union: ${report.parity.before}/${report.parity.after}; missing ${report.parity.missing.length}, added ${report.parity.added.length}.`,
      );
  }
  if (values.output) {
    const target = artifactPath(values.output);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(report, null, 2));
  }
  if (values.json) console.log(JSON.stringify({ ...inventory, ...report }, null, 2));
  else
    console.log(
      `${inventory.fileCount} browser files have exactly one default owner in ${inventory.suiteCount} suites; ${inventory.variants.length} explicit fixture variants.`,
    );
  if (report.errors.length) throw new Error(report.errors.join("\n"));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
