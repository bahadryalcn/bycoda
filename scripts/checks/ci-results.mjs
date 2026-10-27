import assert from "node:assert/strict";
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gates, repositoryRoot } from "./ci-changes.mjs";
import { browserCiVariants, expectedCiSelection, validateBrowserReceipt } from "./browser-ci.mjs";

const hostVariants = [
  "ubuntu-latest-1-of-1",
  ...[1, 2].map((n) => `macos-latest-${n}-of-2`),
  ...[1, 2, 3, 4, 5, 6].map((n) => `windows-latest-${n}-of-6`),
];
export const jobs = {
  changes: { gate: null, variants: [] },
  "repository-hygiene": { gate: null, variants: [] },
  web: {
    gate: "web",
    variants: ["linux"],
    requiredFiles: ["temp/test-results/web-ci/results.json", "temp/test-results/web-ci/boot.json"],
  },
  host: {
    gate: "host",
    variants: hostVariants,
    requiredFiles: ["temp/test-results/host-ci/results.json"],
  },
  check: { gate: "native", variants: ["ubuntu-latest", "macos-latest", "windows-latest"] },
  rpm: { gate: "rpm", variants: ["fedora:43", "almalinux:10"] },
  "rpm-clean-install": { gate: "rpm", variants: ["linux"] },
  scripts: {
    gate: "scripts",
    variants: ["linux"],
    requiredFiles: [
      "temp/test-results/scripts-ci/results.json",
      "temp/test-results/scripts-ci/evals.json",
    ],
  },
  python: {
    gate: "python",
    variants: ["ubuntu-latest", "windows-latest"],
    requiredFiles: ["temp/test-results/python-ci/results.log"],
  },
  browser: {
    gate: "browser",
    events: ["pull_request"],
    variants: ["chromium-smoke"],
    requiredFiles: ["temp/test-results/browser-ci/run.json"],
  },
  "browser-full": {
    gate: "browser",
    events: ["push", "workflow_dispatch"],
    variants: browserCiVariants().map((entry) => entry.variant),
    requiredFiles: ["temp/test-results/browser-full/run.json"],
  },
};
const validResults = new Set(["success", "failure", "cancelled", "skipped"]);
const exactKeys = (value, names) => {
  assert(value && typeof value === "object" && !Array.isArray(value), "Expected an object");
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), "Unexpected evidence fields");
};

export function validateEvidence(value) {
  exactKeys(value, [
    "schemaVersion",
    "job",
    "variant",
    "sourceSha",
    "runId",
    "runAttempt",
    "result",
    "files",
    ...(["browser", "browser-full"].includes(value?.job) ? ["browser"] : []),
    ...(value?.job === "web" ? ["webBoot"] : []),
  ]);
  assert.equal(value.schemaVersion, 1, "Unsupported evidence schema");
  assert(
    Object.hasOwn(jobs, value.job) && jobs[value.job].variants.includes(value.variant),
    "Unknown job variant",
  );
  assert(/^[a-f0-9]{40}$/i.test(value.sourceSha), "Invalid source SHA");
  assert(
    /^[1-9]\d*$/.test(value.runId) && /^[1-9]\d*$/.test(value.runAttempt),
    "Invalid run identity",
  );
  assert(validResults.has(value.result), "Unknown evidence result");
  assert(Array.isArray(value.files), "Evidence files must be an array");
  if (value.job === "web" && value.result === "success") {
    assert(
      value.webBoot?.boundary === "native-unavailable" &&
        /^[a-f0-9]{64}$/.test(value.webBoot.artifactDigest) &&
        /^[a-f0-9]{64}$/.test(value.webBoot.sourceFingerprint),
      "Production web mount proof is missing",
    );
  }
  if (["browser", "browser-full"].includes(value.job) && value.result === "success") {
    assert(
      value.browser && typeof value.browser === "object",
      "Browser execution summary is missing",
    );
    const expected = expectedCiSelection(value.variant);
    assert.equal(
      value.browser.selectionDigest,
      expected.digest,
      "Wrong browser partition selection",
    );
    assert.deepEqual(
      value.browser.suites.map((suite) => suite.suite),
      expected.suites.map((suite) => suite.id),
      "Browser partition lost a suite or explicit variant",
    );
    for (const suite of value.browser.suites) {
      assert(
        Number.isSafeInteger(suite.cases) &&
          suite.cases > 0 &&
          suite.passed > 0 &&
          suite.passed + suite.skipped === suite.cases,
        "Incomplete browser result summary",
      );
      assert(
        /^[a-f0-9]{64}$/.test(suite.reportDigest) && /^[a-f0-9]{64}$/.test(suite.discoveryDigest),
        "Unbound browser report summary",
      );
    }
  }
  for (const file of value.files) {
    exactKeys(file, ["path", "bytes"]);
    assert(
      typeof file.path === "string" && file.path.length > 0 && !/[\r\n\0]/.test(file.path),
      "Invalid evidence path",
    );
    assert(Number.isSafeInteger(file.bytes) && file.bytes > 0, "Empty or invalid evidence file");
  }
  return value;
}

export function recordEvidence({
  job,
  variant,
  result,
  sourceSha,
  runId,
  runAttempt,
  files = [],
  browserReceipt,
  webReceipt,
  root = repositoryRoot,
}) {
  let browser;
  let webBoot;
  if (webReceipt && result === "success") {
    const receipt = JSON.parse(readFileSync(path.resolve(root, webReceipt), "utf8"));
    assert(
      receipt.schemaVersion === 1 &&
        receipt.evidence === "built-web-boot" &&
        receipt.outcome === "passed",
      "Production web boot did not pass",
    );
    assert(
      receipt.source?.sha === sourceSha &&
        receipt.source.dirty === false &&
        /^[a-f0-9]{64}$/.test(receipt.source.sourceFingerprint),
      "Web boot has no exact clean source provenance",
    );
    assert(
      receipt.boundary === "native-unavailable" &&
        receipt.selector === "[data-native-unavailable]" &&
        receipt.runtimeErrors?.length === 0 &&
        receipt.reloadControl === "exercised",
      "Unexpected production web boundary/errors",
    );
    const started = Date.parse(receipt.startedAt),
      completed = Date.parse(receipt.completedAt);
    assert(
      Number.isFinite(started) &&
        completed >= started &&
        completed <= Date.now() + 60000 &&
        completed >= Date.now() - 86400000,
      "Stale web boot receipt",
    );
    assert(
      receipt.artifact?.files > 0 &&
        receipt.artifact?.bytes > 0 &&
        /^[a-f0-9]{64}$/.test(receipt.artifact?.contentDigest),
      "Unbound built web artifact",
    );
    webBoot = {
      boundary: receipt.boundary,
      artifactDigest: receipt.artifact.contentDigest,
      sourceFingerprint: receipt.source.sourceFingerprint,
    };
    files = [...files, webReceipt];
  }
  if (browserReceipt) {
    const receiptFile = path.resolve(root, browserReceipt);
    const stat = lstatSync(receiptFile);
    assert(
      stat.isFile() && stat.size <= 64 * 1024,
      "Browser receipt must be bounded regular JSON data",
    );
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    if (result === "success") {
      const validated = validateBrowserReceipt(receipt, { sourceSha, variant, root });
      const { files: reports, ...summary } = validated;
      browser = summary;
      files = [...files, ...reports];
    }
    files = [...files, browserReceipt];
  }
  const measuredFiles = files.map((file) => {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    assert(
      relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      "Evidence must belong to this checkout",
    );
    const stat = lstatSync(absolute);
    assert(stat.isFile() && stat.size > 0, `Required evidence is missing or empty: ${file}`);
    return { path: relative.replaceAll("\\", "/"), bytes: stat.size };
  });
  return validateEvidence({
    schemaVersion: 1,
    job,
    variant,
    sourceSha,
    runId: String(runId),
    runAttempt: String(runAttempt),
    result,
    files: measuredFiles,
    ...(["browser", "browser-full"].includes(job) ? { browser: browser ?? null } : {}),
    ...(job === "web" ? { webBoot: webBoot ?? null } : {}),
  });
}

export function readEvidence(directory) {
  let names;
  try {
    names = readdirSync(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return names.map((name) => {
    assert(name.endsWith(".json"), "Only JSON evidence manifests may be downloaded here");
    const filename = path.join(directory, name);
    const stat = lstatSync(filename);
    assert(
      stat.isFile() && stat.size <= 64 * 1024,
      "Evidence must be a regular file of at most 64 KiB",
    );
    return validateEvidence(JSON.parse(readFileSync(filename, "utf8")));
  });
}

export function evaluateResults({
  needs,
  evidence = [],
  sourceSha,
  runId,
  runAttempt,
  eventName = "push",
}) {
  const errors = [];
  const selected = needs?.changes?.outputs ?? {};
  for (const gate of gates)
    if (!["true", "false"].includes(selected[gate]))
      errors.push(`Missing or invalid change gate: ${gate}`);
  if (selected.source_sha !== sourceSha)
    errors.push("Change selection does not match this source SHA");
  const reports = new Map();
  for (const report of evidence) {
    try {
      validateEvidence(report);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    const key = `${report.job}/${report.variant}`;
    if (reports.has(key)) errors.push(`Duplicate evidence: ${key}`);
    if (
      report.sourceSha !== sourceSha ||
      report.runId !== String(runId) ||
      report.runAttempt !== String(runAttempt)
    )
      errors.push(`Stale or foreign evidence: ${key}`);
    reports.set(key, report);
  }
  for (const [name, contract] of Object.entries(jobs)) {
    const result = needs?.[name]?.result;
    if (contract.events && !contract.events.includes(eventName)) {
      if (result !== "skipped")
        errors.push(`${name}: must explicitly skip outside its event policy`);
      continue;
    }
    if (result === "skipped" && contract.gate && selected[contract.gate] === "false") continue;
    if (result !== "success") {
      errors.push(`${name}: ${result ?? "missing"} (not an explicitly irrelevant skip)`);
      continue;
    }
    for (const variant of contract.variants) {
      const report = reports.get(`${name}/${variant}`);
      if (!report || report.result !== "success")
        errors.push(`Missing successful evidence: ${name}/${variant}`);
      for (const file of contract.requiredFiles ?? [])
        if (!report?.files.some((entry) => entry.path === file && entry.bytes > 0))
          errors.push(`Missing required report: ${name}/${variant}: ${file}`);
    }
  }
  for (const name of Object.keys(needs ?? {}))
    if (!Object.hasOwn(jobs, name)) errors.push(`Unrecognized aggregate dependency: ${name}`);
  return { success: errors.length === 0, errors };
}

function argumentsFor(args) {
  const options = { files: [] };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    if (argument === "--require") options.files.push(value);
    else if (argument === "--browser-receipt") options.browserReceipt = value;
    else if (argument === "--web-receipt") options.webReceipt = value;
    else if (["--job", "--variant", "--result", "--directory"].includes(argument))
      options[argument.slice(2)] = value;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, ...args] = process.argv.slice(2);
  const options = argumentsFor(args);
  const identity = {
    sourceSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  };
  if (command === "record") {
    const report = recordEvidence({ ...options, ...identity });
    const directory = path.resolve(options.directory);
    mkdirSync(directory, { recursive: true });
    const name = `${report.job}-${report.variant}`.replaceAll(/[^A-Za-z0-9_.-]/g, "_");
    writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  } else if (command === "check") {
    const result = evaluateResults({
      needs: JSON.parse(process.env.CI_NEEDS ?? "{}"),
      evidence: readEvidence(options.directory),
      ...identity,
      eventName: process.env.GITHUB_EVENT_NAME,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exitCode = 1;
  } else throw new Error("Usage: ci-results.mjs record|check [options]");
}
