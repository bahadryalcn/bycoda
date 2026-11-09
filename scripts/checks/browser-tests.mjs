import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  selectSuites,
  validateManifest,
  artifactPath,
  repositoryRoot,
  runPlaywright,
  listedCases,
} from "./browser-test-support.mjs";
import { selectionPlan, digest } from "./browser-ci.mjs";

export async function reservePort(preferred = 0) {
  const socket = createServer();
  await new Promise((done, reject) => {
    socket.once("error", reject);
    socket.listen(preferred, "127.0.0.1", done);
  });
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  return port;
}

export async function main(args = process.argv.slice(2)) {
  const separator = args.indexOf("--");
  const forwarded = separator < 0 ? [] : args.slice(separator + 1);
  if (
    forwarded.some((argument) =>
      /^(?:-c|--config|--project|--list|--reporter|--output|--shard|--test-list|--test-list-invert)(?:=|$)/.test(
        argument,
      ),
    )
  ) {
    throw new Error(
      "Use the runner's suite/project/list options; forwarded arguments cannot replace its configuration or evidence outputs.",
    );
  }
  const { values } = parseArgs({
    args: separator < 0 ? args : args.slice(0, separator),
    options: {
      suite: { type: "string", multiple: true },
      project: { type: "string" },
      list: { type: "boolean" },
      plan: { type: "boolean" },
      "include-variants": { type: "boolean" },
      shard: { type: "string", default: "1/1" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "node scripts/checks/browser-tests.mjs [--suite all|smoke|id[,id]] [--project chromium|webkit] [--plan|--list] [-- <Playwright args>]\n--plan reads only the manifest; --list imports tests but starts no server/browser. Default runs each default owner once; explicit variants require their suite id.",
    );
    return 0;
  }
  const validation = validateManifest();
  if (validation.errors.length) throw new Error(validation.errors.join("\n"));
  if (!/^[1-9]\d*\/[1-9]\d*$/.test(values.shard)) throw new Error("Use --shard current/total");
  const [shard, count] = values.shard.split("/").map(Number);
  const { suites, selection } = selectionPlan({
    suites: selectSuites(values.suite ?? ["all"]),
    includeVariants: Boolean(values["include-variants"]),
    project: values.project ?? null,
    shard,
    count,
    filters: forwarded,
  });
  if (
    values.project &&
    !suites.some((suite) => suite.projects.some((project) => project.name === values.project))
  )
    throw new Error(`No selected suite has project ${values.project}`);
  const plan = suites.map((suite) => ({
    suite: suite.id,
    config: suite.config,
    files: suite.files,
    projects: suite.projects.filter(
      (project) => !values.project || project.name === values.project,
    ),
    fixture: suite.fixture,
    variantOf: suite.variantOf ?? null,
  }));
  if (values.plan) {
    console.log(JSON.stringify({ evidence: "selection-plan", selection, suites: plan }, null, 2));
    return 0;
  }
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${process.pid}-${randomBytes(3).toString("hex")}`;
  const outputRoot = artifactPath(
    process.env.BYCODA_BROWSER_ARTIFACT_DIR ?? "temp/test-results/browser",
  );
  const directory = join(outputRoot, runId);
  mkdirSync(directory, { recursive: true });
  const source = {
    sha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      windowsHide: true,
      encoding: "utf8",
    }).trim(),
    dirty: Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        cwd: repositoryRoot,
        windowsHide: true,
        encoding: "utf8",
      }).trim(),
    ),
  };
  const report = {
    schemaVersion: 1,
    runId,
    source,
    node: process.version,
    evidence: values.list ? "list-only" : "browser-fixture",
    startedAt: new Date().toISOString(),
    selection,
    suites: [],
  };
  writeFileSync(join(outputRoot, "run.json"), JSON.stringify(report, null, 2));
  let code = 0;
  for (const suite of suites) {
    if (values.project && !suite.projects.some((project) => project.name === values.project))
      continue;
    const suiteDirectory = join(directory, suite.id);
    mkdirSync(suiteDirectory, { recursive: true });
    const started = Date.now();
    const env = { BYCODA_BROWSER_SUITE: suite.id, BYCODA_BROWSER_RUN_DIR: suiteDirectory };
    if (!values.list) env.BYCODA_BROWSER_PORT = String(await reservePort(suite.fixture.fixedPort));
    const command = [
      "--config",
      "tests/browser/runner.playwright.config.ts",
      ...(values.project ? [`--project=${values.project}`] : []),
      ...(values.list ? ["--list", "--reporter=json"] : []),
      ...forwarded,
    ];
    let discovery;
    if (!values.list) {
      const listed = await runPlaywright(
        [
          "--config",
          "tests/browser/runner.playwright.config.ts",
          ...(values.project ? [`--project=${values.project}`] : []),
          "--list",
          "--reporter=json",
          ...(forwarded.length ? ["--pass-with-no-tests"] : []),
          ...forwarded,
        ],
        { env, capture: true },
      );
      if (listed.code !== 0)
        throw new Error(
          `Browser discovery failed: ${suite.id} (exit ${listed.code}): ${[
            listed.stderr.trim(),
            listed.stdout.trim().slice(-2000),
          ]
            .filter(Boolean)
            .join("\n")}`,
        );
      const discoveryFile = join(suiteDirectory, "discovery.json");
      writeFileSync(discoveryFile, listed.stdout);
      if (forwarded.length && listedCases(JSON.parse(listed.stdout)).length === 0) {
        report.suites.push({
          suite: suite.id,
          code: 0,
          filteredOut: true,
          durationMs: Date.now() - started,
        });
        console.log(`${suite.id}: no cases matched the local filters; no browser started`);
        continue;
      }
      discovery = {
        path: relative(repositoryRoot, discoveryFile).replaceAll("\\", "/"),
        sha256: digest(listed.stdout),
      };
    }
    const result = await runPlaywright(command, { env, capture: Boolean(values.list) });
    const outcome = {
      suite: suite.id,
      code: result.code,
      signal: result.signal,
      durationMs: Date.now() - started,
      directory: relative(repositoryRoot, suiteDirectory),
    };
    if (!values.list && result.code === 0) {
      const reportFile = join(suiteDirectory, "report.json");
      const bytes = readFileSync(reportFile);
      const reportData = JSON.parse(bytes);
      if (
        (reportData.errors?.length ?? 0) > 0 ||
        reportData.stats?.unexpected ||
        reportData.stats?.flaky ||
        !(reportData.stats?.expected > 0)
      )
        throw new Error(`Browser report is incomplete or failed: ${suite.id}`);
      outcome.discovery = discovery;
      outcome.report = {
        path: relative(repositoryRoot, reportFile).replaceAll("\\", "/"),
        sha256: digest(bytes),
      };
    }
    if (values.list) {
      writeFileSync(join(suiteDirectory, "list.json"), result.stdout);
      if (result.code === 0) {
        outcome.cases = listedCases(JSON.parse(result.stdout));
        console.log(`${suite.id}: ${outcome.cases.length} listed cases`);
      } else console.error(`${suite.id}: list failed\n${result.stderr}\n${result.stdout}`);
    }
    report.suites.push(outcome);
    writeFileSync(join(directory, "run.json"), JSON.stringify(report, null, 2));
    // Keep running later suites so one CI round reports every failing suite.
    if (result.code !== 0 && code === 0) code = result.code;
  }
  if (!values.list && report.suites.every((suite) => suite.filteredOut)) {
    console.error("No browser cases matched the requested filters.");
    code = 1;
  }
  report.completedAt = new Date().toISOString();
  report.code = code;
  writeFileSync(join(directory, "run.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(outputRoot, "run.json"), JSON.stringify(report, null, 2));
  console.log(`Browser ${report.evidence}: ${relative(repositoryRoot, directory)} (exit ${code})`);
  return code;
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
