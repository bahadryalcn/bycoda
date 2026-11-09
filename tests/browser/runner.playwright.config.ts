import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, resolve } from "node:path";
import { fixtureConfigs } from "./fixture-configs";
import { manifest, artifactPath } from "../../scripts/checks/browser-test-support.mjs";

type BrowserSuite = {
  id: string;
  config: keyof typeof fixtureConfigs;
  files: string[];
  projects: { name: string; browser: "chromium" | "webkit" | "firefox"; files: string[] }[];
  fixture: { fixedPort?: number; path: string };
  variantOf?: string;
};

const suite = (manifest.suites as BrowserSuite[]).find(
  (entry) => entry.id === (process.env.BYCODA_BROWSER_SUITE ?? "transcript"),
);
if (!suite) throw new Error("Unknown BYCODA_BROWSER_SUITE");
const base = fixtureConfigs[suite.config as keyof typeof fixtureConfigs];
if (!base) throw new Error(`Browser suite ${suite.id} has no registered config: ${suite.config}`);
const root = fileURLToPath(new URL("../../", import.meta.url));
const baseDirectory = dirname(resolve(root, suite.config));
const originalPort = new URL(base.use!.baseURL!).port;
const port = Number(process.env.BYCODA_BROWSER_PORT ?? suite.fixture.fixedPort ?? originalPort);
const directory = artifactPath(
  process.env.BYCODA_BROWSER_RUN_DIR ??
    `temp/test-results/browser-direct/${Date.now()}-${process.pid}/${suite.id}`,
);
const baseURL = `http://127.0.0.1:${port}`;
const setup = base.globalSetup;

export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL("./", import.meta.url)),
  testMatch: suite.files,
  testIgnore: [],
  outputDir: resolve(directory, "results"),
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["line"], ["json", { outputFile: resolve(directory, "report.json") }]],
  globalSetup: setup
    ? (Array.isArray(setup) ? setup : [setup]).map((path) =>
        isAbsolute(path) ? path : resolve(baseDirectory, path),
      )
    : undefined,
  use: { ...base.use, baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  metadata: {
    ...base.metadata,
    evidence: "browser-fixture",
    suite: suite.id,
    variantOf: suite.variantOf ?? null,
  },
  projects: suite.projects.map((project) => ({
    ...base.projects?.find((entry) => entry.name === project.name),
    name: project.name,
    testMatch: project.files,
    use: {
      ...base.projects?.find((entry) => entry.name === project.name)?.use,
      browserName: project.browser as "chromium" | "webkit" | "firefox",
    },
  })),
  webServer: {
    ...base.webServer,
    cwd: root,
    command: `node scripts/checks/browser-fixture-server.mjs --suite ${suite.id}`,
    url: `${baseURL}${suite.fixture.path}`,
    reuseExistingServer: false,
    env: { BYCODA_BROWSER_PORT: String(port), BYCODA_BROWSER_RUN_DIR: directory },
  },
});
