#!/usr/bin/env node
/**
 * pnpm dev:shot --id REVIEW_ID (--run PATH_TO_DEV_RUN_JSON | --url LOOPBACK_URL)
 *               [--route /path] [--surface CSS_SELECTOR] [--width 1280]
 *               [--height 800] [--scheme light|dark]
 * Connects to an isolated Windows native CDP run, or captures a browser fixture.
 * Writes PNG + source/build metadata to temp/verification/REVIEW_ID/.
 * Native CDP connections are disconnected without closing the application.
 */
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { parseBuildIdentity, readBuildIdentity, sourceIdentity } from "./build-info.mjs";

const option = (args, key, fallback) => {
  const index = args.indexOf(key);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing ${key} value`);
  return args[index + 1];
};

export function screenshotOptions(args) {
  const id = option(args, "--id");
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(id) || id.includes(".."))
    throw new Error("--id must be a simple verification directory name");
  const width = Number(option(args, "--width", "1280"));
  const height = Number(option(args, "--height", "800"));
  if (![width, height].every((value) => Number.isInteger(value) && value >= 240 && value <= 7680))
    throw new Error("Screenshot dimensions must be integers between 240 and 7680");
  const scheme = option(args, "--scheme", "dark");
  if (!["light", "dark"].includes(scheme)) throw new Error("--scheme must be light or dark");
  const run = option(args, "--run");
  const url = option(args, "--url");
  if (Boolean(run) === Boolean(url)) throw new Error("Specify exactly one of --run or --url");
  if (url) loopbackUrl(url);
  return {
    id,
    width,
    height,
    scheme,
    run,
    url,
    route: option(args, "--route"),
    surface: option(args, "--surface"),
  };
}

export function loopbackUrl(value) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("Development screenshots require a loopback HTTP URL without credentials");
  return url;
}

export async function verifyNativeIdentity(page, expected) {
  const actual = parseBuildIdentity(
    await page.evaluate(async () => {
      return await window.__TAURI_INTERNALS__?.invoke("build_identity");
    }),
  );
  if (
    !actual ||
    !expected ||
    actual.buildId !== expected.buildId ||
    actual.sourceFingerprint !== expected.sourceFingerprint ||
    actual.head !== expected.head
  ) {
    throw Object.assign(
      new Error("The native app identity does not match this run record; select the current run"),
      {
        code: !actual || !expected ? "NATIVE_IDENTITY_UNAVAILABLE" : "NATIVE_IDENTITY_MISMATCH",
      },
    );
  }
  return actual;
}

export async function captureDevShot(args = process.argv.slice(2)) {
  const options = screenshotOptions(args);
  const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), "../.."));
  const source = await sourceIdentity(root);
  const run = options.run ? JSON.parse(await readFile(resolve(options.run), "utf8")) : null;
  const origin = loopbackUrl(options.url ?? run?.devUrl);
  const route = options.route ? new URL(options.route, origin) : origin;
  if (route.origin !== origin.origin)
    throw new Error("The screenshot route must remain on the selected development origin");
  let buildIdentity = run ? await readBuildIdentity(run.buildManifest) : null;
  if (
    run &&
    (!Number.isInteger(run.ports?.ports?.cdp) ||
      run.ports.ports.cdp < 1024 ||
      run.ports.ports.cdp > 65535)
  )
    throw new Error("The run record has no valid native CDP port");
  const browser = run
    ? await chromium.connectOverCDP(`http://127.0.0.1:${run.ports.ports.cdp}`, { timeout: 10_000 })
    : await chromium.launch({ headless: true });
  let restoreNativePage;
  try {
    const context = run
      ? browser.contexts()[0]
      : await browser.newContext({
          viewport: { width: options.width, height: options.height },
          colorScheme: options.scheme,
          reducedMotion: "reduce",
        });
    const page = run
      ? context.pages().find((candidate) => {
          try {
            return new URL(candidate.url()).origin === origin.origin;
          } catch {
            return false;
          }
        })
      : await context.newPage();
    if (!page) throw new Error("No native page matches the development run origin");
    if (run) {
      buildIdentity = await verifyNativeIdentity(page, buildIdentity);
      const originalUrl = page.url();
      const viewport = page.viewportSize();
      const media = await page.evaluate(() => ({
        colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "reduce"
          : "no-preference",
      }));
      restoreNativePage = async () => {
        if (options.route && page.url() !== originalUrl)
          await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 10_000 });
        await page.emulateMedia(media);
        if (viewport) await page.setViewportSize(viewport);
        else {
          const session = await context.newCDPSession(page);
          try {
            await session.send("Emulation.clearDeviceMetricsOverride");
          } finally {
            await session.detach();
          }
        }
      };
    }
    await page.setViewportSize({ width: options.width, height: options.height });
    await page.emulateMedia({ colorScheme: options.scheme, reducedMotion: "reduce" });
    if (!run || options.route)
      await page.goto(route.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    const outputDir = join(root, "temp", "verification", options.id);
    await mkdir(outputDir, { recursive: true });
    const name = `${run ? "native" : "fixture"}-${source.head.slice(0, 8)}-${source.sourceFingerprint.slice(0, 8)}-${options.width}-${options.scheme}`;
    const screenshotPath = join(outputDir, `${name}.png`);
    const target = options.surface ? page.locator(options.surface) : page;
    await target.screenshot({ path: screenshotPath, animations: "disabled" });
    const after = await sourceIdentity(root);
    const metadata = {
      schemaVersion: 1,
      evidence: run ? "native-dev-cdp" : "browser-fixture",
      source,
      runningBuildIdentity: buildIdentity,
      sourceStableDuringCapture: JSON.stringify(source) === JSON.stringify(after),
      capturedAt: Date.now(),
      width: options.width,
      height: options.height,
      colorScheme: options.scheme,
      route: `${new URL(page.url()).pathname}${new URL(page.url()).hash}`,
      surface: options.surface ?? null,
      workspaceId: run?.workspaceId ?? null,
      runId: run?.runId ?? null,
      sourceComparison: buildIdentity
        ? buildIdentity.sourceFingerprint === source.sourceFingerprint &&
          buildIdentity.head === source.head
          ? "exact"
          : "different"
        : "source identity unknown",
    };
    await writeFile(join(outputDir, `${name}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
    if (!metadata.sourceStableDuringCapture)
      throw new Error(
        `Source changed during capture; evidence is marked unstable: ${screenshotPath}`,
      );
    console.log(screenshotPath);
    return { screenshotPath, metadata };
  } finally {
    // Restore the observed native media/viewport/route before disconnecting CDP.
    // Playwright closes its remote connection here, preserving the default native context.
    if (restoreNativePage)
      await restoreNativePage().catch((error) =>
        console.error(`Native screenshot state restore failed: ${error.message}`),
      );
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes("--help"))
    console.log(
      "pnpm dev:shot --id REVIEW_ID (--run DEV_RUN_JSON | --url LOOPBACK_URL) [--route /path] [--surface CSS_SELECTOR] [--width 1280] [--height 800] [--scheme light|dark]\nWrites PNG and source metadata under temp/verification/REVIEW_ID/.",
    );
  else
    captureDevShot().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
