import { createServer } from "node:http";
import {
  readFileSync,
  existsSync,
  statSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve, relative, extname, join, isAbsolute, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { artifactPath, repositoryRoot } from "./browser-test-support.mjs";
import { sourceIdentity, parseBuildIdentity } from "../build/build-info.mjs";

export function verifyEmbeddedBuildIdentity(expected, embedded) {
  const source = parseBuildIdentity(expected),
    artifact = parseBuildIdentity(embedded);
  if (!source || !artifact || !isDeepStrictEqual(source, artifact))
    throw new Error(
      "Built web identity does not match the explicitly selected frozen build identity",
    );
  return source;
}

export function builtArtifactIdentity(directory) {
  const files = [];
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Built web artifacts may not contain symlinks");
      const filename = join(path, entry.name);
      if (entry.isDirectory()) walk(filename);
      else
        files.push({
          path: relative(directory, filename).replaceAll("\\", "/"),
          bytes: statSync(filename).size,
          sha256: createHash("sha256").update(readFileSync(filename)).digest("hex"),
        });
    }
  };
  walk(directory);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {
    contentDigest: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
    files: files.length,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
  };
}

export async function serveBuiltWeb(directory) {
  const root = realpathSync(directory);
  if (!existsSync(join(root, "index.html")))
    throw new Error("No dist/index.html. This command never builds the application.");
  const mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
  };
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://fixture.invalid").pathname);
      const path = resolve(root, `.${pathname}`);
      const inside = relative(root, path);
      if (inside.startsWith("..") || isAbsolute(inside)) {
        response.writeHead(403).end();
        return;
      }
      let file = path;
      if (!existsSync(file) || !statSync(file).isFile()) {
        if (extname(pathname)) {
          response.writeHead(404).end();
          return;
        }
        file = join(root, "index.html");
      }
      const actual = relative(root, realpathSync(file));
      if (actual.startsWith("..") || isAbsolute(actual)) {
        response.writeHead(403).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(readFileSync(file));
    } catch {
      response.writeHead(400).end();
    }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      dist: { type: "string", default: "dist" },
      "ready-selector": { type: "string", default: "[data-workspace-chrome]" },
      plan: { type: "boolean" },
      build: { type: "boolean" },
      boundary: { type: "string", default: "workspace" },
      receipt: { type: "string" },
      "expected-build-identity": { type: "string" },
      output: { type: "string", default: "temp/test-results/built-web-boot" },
    },
  });
  if (!["workspace", "native-unavailable"].includes(values.boundary))
    throw new Error("Use --boundary workspace|native-unavailable");
  if (values.build && values["expected-build-identity"])
    throw new Error(
      "Choose a captured new build or an existing artifact's explicit frozen identity",
    );
  const directory = resolve(repositoryRoot, values.dist);
  const report = {
    schemaVersion: 1,
    evidence: "built-web-boot",
    artifact: {
      directory,
      sourceIdentity: "unknown; no build/provenance assertion is inferred from existing dist",
    },
    selector:
      values.boundary === "native-unavailable"
        ? "[data-native-unavailable]"
        : values["ready-selector"],
    boundary: values.boundary,
    startedAt: new Date().toISOString(),
    native: "not-run",
    installed: "not-run",
  };
  if (values.plan) {
    console.log(
      JSON.stringify(
        {
          ...report,
          evidence: "built-web-boot-plan",
          exists: existsSync(join(directory, "index.html")),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const output = artifactPath(join(values.output, `${Date.now()}-${process.pid}`));
  mkdirSync(output, { recursive: true });
  let server;
  let browser;
  let page;
  try {
    if (values.build) {
      artifactPath(directory);
      if (existsSync(directory))
        throw new Error("--build requires a new output directory, never reused dist");
      const before = await sourceIdentity(repositoryRoot);
      const { build } = await import("vite");
      await build({
        root: repositoryRoot,
        configFile: join(repositoryRoot, "vite.config.ts"),
        build: { outDir: directory, emptyOutDir: false },
      });
      const after = await sourceIdentity(repositoryRoot);
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error(
          "Source changed during production web build; freeze it before accepting this output",
        );
      report.source = {
        sha: before.head,
        sourceFingerprint: before.sourceFingerprint,
        dirty: before.dirtyPaths.length > 0,
      };
      report.artifact.sourceIdentity =
        "built by this command from the captured unchanged source bytes";
    }
    if (values["expected-build-identity"]) {
      const expectedFile = resolve(values["expected-build-identity"]);
      if (
        statSync(expectedFile).size > 512 * 1024 ||
        statSync(join(directory, "build-info.json")).size > 512 * 1024
      )
        throw new Error("Build identity is not bounded JSON metadata");
      const bytes = readFileSync(expectedFile);
      const stamp = verifyEmbeddedBuildIdentity(
        JSON.parse(bytes),
        JSON.parse(readFileSync(join(directory, "build-info.json"), "utf8")),
      );
      report.source = {
        sha: stamp.head,
        sourceFingerprint: stamp.sourceFingerprint,
        dirty: stamp.dirtyPaths.length > 0,
        buildId: stamp.buildId,
        version: stamp.version,
        expectedIdentityDigest: createHash("sha256").update(bytes).digest("hex"),
      };
      report.artifact.sourceIdentity =
        "embedded web stamp matches the explicitly selected frozen producer identity; dirty source is not a complete HEAD inclusion claim";
    }
    Object.assign(report.artifact, builtArtifactIdentity(directory));
    server = await serveBuiltWeb(directory);
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch();
    page = await browser.newPage();
    const errors = [];
    report.runtimeErrors = errors;
    page.on("pageerror", (error) => errors.push(error.message.slice(0, 1000)));
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === server.origin ? route.continue() : route.abort(),
    );
    await page.goto(server.origin);
    await page.locator(report.selector).waitFor({ state: "visible", timeout: 60_000 });
    if (values.boundary === "native-unavailable") {
      // The alert announces only the failure message; recovery actions sit beside it.
      const surface = page.locator(report.selector);
      await surface.getByRole("alert").waitFor({ state: "visible" });
      const reload = surface.getByRole("button").first();
      await reload.waitFor({ state: "visible" });
      report.reloadLabel = await reload.innerText();
      if (!report.reloadLabel.trim()) throw new Error("The reload control has no accessible label");
      if (await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__)))
        throw new Error("A browser native-unavailable check may not inject a Tauri bridge");
      report.workspaceRuntime = "not-run; desktop native bridge is unavailable in this browser";
      await Promise.all([page.waitForEvent("domcontentloaded"), reload.click()]);
      await page.locator(report.selector).waitFor({ state: "visible", timeout: 60_000 });
      report.reloadControl = "exercised";
    }
    if (errors.length) throw new Error(`Built-client page errors: ${errors.join("\n")}`);
    report.outcome = "passed";
    report.captures = [];
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate(
          (value) => document.documentElement.classList.toggle("theme-light", value === "light"),
          theme,
        );
        const screenshot = join(output, `mounted-${width}-${theme}.png`);
        await page.screenshot({ path: screenshot, animations: "disabled" });
        report.captures.push(relative(repositoryRoot, screenshot));
      }
    }
    return 0;
  } catch (error) {
    report.outcome = "failed";
    report.message = String(error).slice(0, 4000);
    await page?.screenshot({ path: join(output, "failure.png"), timeout: 5000 }).catch(() => {});
    throw error;
  } finally {
    await browser?.close();
    await server?.close();
    report.completedAt = new Date().toISOString();
    writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
    if (values.receipt) {
      const receipt = artifactPath(values.receipt);
      mkdirSync(dirname(receipt), { recursive: true });
      writeFileSync(receipt, JSON.stringify(report, null, 2));
    }
    console.log(
      `Built-web boot report: ${relative(repositoryRoot, output)}; ${report.artifact.sourceIdentity}.`,
    );
  }
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
