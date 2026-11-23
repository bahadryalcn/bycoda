/**
 * Visual acceptance matrix: one capture per screen archetype x light/dark x 1280/800 against the
 * browser fixture server. Fixtures supply the worst-case data (long names, Turkish, RTL, emoji,
 * empty/one/many/error) where they model it; evidence from here is fixture evidence, never
 * installed-app acceptance (see docs/reference/testing.md).
 *
 *   pnpm exec vp dev --config tests/browser/vite.config.ts --port 14395 --strictPort   (background)
 *   node scripts/checks/ui-acceptance-matrix.mjs --out temp/verification/<id>/matrix [--only a,b] [--base http://127.0.0.1:14395]
 *   node scripts/checks/ui-acceptance-matrix.mjs --list     print the archetype table
 *
 * Output: <out>/<name>-<light|dark>-<width>.png; log lines are `ok`, `ERR <pageerror>` or `FAIL`.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const widths = [1280, 800];
export const schemes = ["dark", "light"];

/** [name, fixture route under tests/browser, archetype from DESIGN.md "Screen archetypes"]. */
export const archetypes = [
  ["sessions-transcript", "chat/transcript.html?chat-layout", "list and detail"],
  ["sessions-composer", "chat/composer-compact.html", "panel with toolbar"],
  ["shell-sidebar", "app-shell/compact-navigation.html?railPolish&expandedRail", "collection"],
  ["settings-general", "settings/settings.html?section=general", "settings"],
  ["settings-appearance", "settings/settings.html?section=appearance", "settings"],
  ["settings-providers", "settings/settings.html?section=providers", "settings"],
  ["inbox", "inbox/jira-board.html?inbox", "collection"],
  ["tasks", "tasks/tasks.html", "list and detail"],
  ["notes", "notes/notes.html", "list and detail"],
  ["automations", "automations/automations.html", "collection"],
  ["servers", "terminal/servers.html", "collection"],
  ["skills", "skills/skill-catalog.html", "collection"],
  ["source-control", "source-control/git-workspace.html?checkouts", "panel with toolbar"],
  ["host-tools", "host-tools/host-tools.html", "panel with toolbar"],
  ["devices", "devices/device-stage.html", "panel with toolbar"],
  ["social", "social/social.html?programs", "collection"],
  ["assistant-room", "assistant/assistant-room.html", "list and detail"],
  ["onboarding", "onboarding/onboarding.html?providers=all", "dialog or sheet form"],
  ["crews", "crews/crews.html", "collection"],
];

export const fixtureFile = (route) => path.join(root, "tests/browser", route.split("?")[0]);

function option(args, name) {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
}

/** The compact-navigation fixture installs its native shell stub from its own Playwright spec. */
async function shellInit() {
  const require = createRequire(path.join(root, "package.json"));
  const spec = readFileSync(
    path.join(root, "tests/browser/app-shell/compact-navigation.spec.ts"),
    "utf8",
  );
  // Other tests in the spec also call addInitScript; the shell stub lives in the fixture installer.
  const installer = Math.max(0, spec.indexOf("async function installNavigationFixture("));
  const start = spec.indexOf("page.addInitScript(", installer) + "page.addInitScript(".length;
  const stop = spec.indexOf("\n  });\n}", start) + 4;
  if (start < "page.addInitScript(".length || stop < start) return null;
  return require("esbuild").transformSync(`(${spec.slice(start, stop)})()`, { loader: "ts" }).code;
}

async function main(args) {
  if (args.includes("--list")) {
    for (const [name, route, kind] of archetypes) console.log(`${name}\t${kind}\t${route}`);
    return;
  }
  const out = option(args, "out");
  if (!out) throw new Error("--out <dir> is required");
  const base = option(args, "base") ?? "http://127.0.0.1:14395";
  const only = option(args, "only")?.split(",");
  const { chromium } = await import(
    pathToFileURL(path.join(root, "node_modules/@playwright/test/index.mjs")).href
  );
  mkdirSync(out, { recursive: true });
  const init = await shellInit();
  const browser = await chromium.launch({ headless: true });
  let failed = 0;
  for (const [name, route] of archetypes) {
    if (only && !only.includes(name)) continue;
    for (const scheme of schemes)
      for (const width of widths) {
        const context = await browser.newContext({
          viewport: { width, height: 800 },
          colorScheme: scheme,
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        if (init && route.startsWith("app-shell/")) await page.addInitScript(init);
        const errors = [];
        page.on("pageerror", (error) => errors.push(String(error).slice(0, 150)));
        try {
          await page.goto(
            `${base}/tests/browser/${route}${route.includes("?") ? "&" : "?"}theme=${scheme}`,
            {
              waitUntil: "load",
            },
          );
          await page.waitForTimeout(2500);
          await page.evaluate(
            (value) => document.documentElement.classList.toggle("theme-light", value === "light"),
            scheme,
          );
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(out, `${name}-${scheme}-${width}.png`) });
          if (errors.length) failed++;
          console.log("ok", name, scheme, width, errors.length ? `ERR ${errors[0]}` : "");
        } catch (error) {
          failed++;
          console.log("FAIL", name, scheme, width, String(error).slice(0, 120));
        }
        await context.close();
      }
  }
  await browser.close();
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await main(process.argv.slice(2));
