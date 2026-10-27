#!/usr/bin/env node
/** Real-provider development acceptance. This command never attaches to an installed app. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { readBuildIdentity } from "./build-info.mjs";
import { verifyNativeIdentity } from "./dev-shot.mjs";
import { nativeDevDesktopDataPath } from "../../host/workspace-bootstrap.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
let stageTimeoutOccurred = false;
const pageMethods = new WeakMap();

export async function acceptanceStage(context, stage, work, timeoutMs = 30000) {
  const record = {
    id: (context.stageSequence = (context.stageSequence ?? 0) + 1),
    stage,
    startedAt: Date.now(),
    timeoutMs,
  };
  context.activeStages ??= [];
  context.activeStages.push(record);
  const save = async (status, error) => {
    const event = {
      ...record,
      status,
      at: Date.now(),
      scenario: context.currentScenario ?? null,
      sessionId: context.state?.sessionId ?? null,
      userBlockId: context.state?.lastUserBlockId ?? null,
      ...(error ? { error: error.message, code: error.code } : {}),
    };
    const snapshot = {
      schemaVersion: 1,
      runId: context.run?.runId,
      event,
      active: context.activeStages.map((entry) => ({ ...entry })),
      lastFailure: context.lastStageFailure ?? null,
    };
    context.stageWrites = (context.stageWrites ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await writeFile(
          join(context.output, "native-stage.json"),
          `${JSON.stringify(snapshot, null, 2)}\n`,
        );
        if ((context.stageEvents ?? 0) < 10000) {
          context.stageEvents = (context.stageEvents ?? 0) + 1;
          await appendFile(
            join(context.output, "native-stages.jsonl"),
            `${JSON.stringify(event)}\n`,
          );
        }
      });
    await context.stageWrites;
  };
  await save("running");
  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(work),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          context.stageTimedOut = true;
          stageTimeoutOccurred = true;
          reject(
            Object.assign(
              new Error(`Native acceptance stage timed out after ${timeoutMs} ms: ${stage}`),
              { code: "NATIVE_ACCEPTANCE_STAGE_TIMEOUT", stage, timeoutMs },
            ),
          );
        }, timeoutMs);
      }),
    ]);
    context.activeStages = context.activeStages.filter((entry) => entry.id !== record.id);
    await save("passed");
    return result;
  } catch (error) {
    context.lastStageFailure = { ...record, error: error.message, code: error.code };
    context.activeStages = context.activeStages.filter((entry) => entry.id !== record.id);
    await save(error.code === "NATIVE_ACCEPTANCE_STAGE_TIMEOUT" ? "timed_out" : "failed", error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function instrumentAcceptancePage(context, page) {
  let originals = pageMethods.get(page);
  if (!originals) {
    originals = Object.fromEntries(
      ["evaluate", "screenshot", "setViewportSize", "emulateMedia", "reload", "goto"].map(
        (name) => [name, page[name].bind(page)],
      ),
    );
    pageMethods.set(page, originals);
  }
  for (const [name, original] of Object.entries(originals)) {
    page[name] = (...args) => {
      const caller = new Error().stack
        ?.split("\n")
        .slice(2)
        .find((line) => line.includes("acceptance-native.mjs:"))
        ?.trim();
      return acceptanceStage(context, `page.${name}${caller ? ` (${caller})` : ""}`, () =>
        original(...args),
      );
    };
  }
}

async function disconnectAcceptance(browser) {
  let timer;
  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("CDP disconnect timed out")), 5000);
      }),
    ]);
  } catch {
    /* Disconnect is bounded; a timed-out CLI exits only its own process. */
  } finally {
    clearTimeout(timer);
  }
}
const titles = {
  1: "Current checkout: three consecutive real Codex turns",
  2: "Worktree: three commits, rewind and exact Undo",
  3: "Rejected admission, restart and retained starting-row recovery",
  4: "Codex model switch with a Turkish message larger than 20 KiB",
  5: "Old Host capability and reconnect",
  6: "Review, approved merge, finish and junction-safe directory deletion",
  7: "Task and automation current defaults with explicit worktree selection",
  8: "Workspace settings policy controls the next session",
};

export function acceptanceOptions(args) {
  const option = (key, fallback) => {
    const index = args.indexOf(key);
    if (index < 0) return fallback;
    if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing ${key}`);
    return args[index + 1];
  };
  const id = option("--id", `native-${Date.now()}`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(id) || id.includes(".."))
    throw new Error("--id must be a simple task name");
  const scenario = option("--scenario", "all");
  const scenarios =
    scenario === "all" ? Object.keys(titles).map(Number) : scenario.split(",").map(Number);
  if (!scenarios.length || scenarios.some((value) => !titles[value]))
    throw new Error("Expected scenarios 1..8 or all");
  const timeout = Number(option("--turn-timeout", "240000"));
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 900000)
    throw new Error("Invalid turn timeout");
  return {
    id,
    run: option("--run"),
    scenarios,
    model: option("--model", "GPT-6-Luna"),
    switchModel: option("--switch-model", "GPT-6.1-Sol"),
    timeout,
    action: option("--action"),
    sharedTarget: option("--shared-target"),
  };
}

export function assertWithin(root, path, label = "path") {
  if (!isAbsolute(path)) throw new Error(`Expected absolute ${label}`);
  const rel = relative(resolve(root), resolve(path));
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error(`Refusing ${label} outside ${root}`);
  return resolve(path);
}

export function acceptanceProjectName(id, runId) {
  const digest = (value) => createHash("sha256").update(value).digest("hex").slice(0, 8);
  const task = id.length <= 32 ? id : `${id.slice(0, 20)}-${digest(id)}`;
  const run = runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 12);
  return `provider-repo-${task}-${run}-${digest(runId)}`;
}

/** Validate all mutable locations before CDP connection or any filesystem write. */
export async function validateAcceptanceRun(root, recordPath) {
  const runs = await realpath(join(root, "temp", "build", "managed-runs"));
  const path = assertWithin(runs, await realpath(resolve(recordPath)), "run record");
  const run = JSON.parse(await readFile(path, "utf8"));
  for (const [key, value] of Object.entries({
    hostDataPath: run.hostDataPath,
    executableRunDir: run.executableRunDir,
    executable: run.executable,
    buildManifest: run.buildManifest,
  })) {
    assertWithin(runs, await realpath(value), key);
  }
  const expectedDesktop = nativeDevDesktopDataPath(run.instanceId);
  assert.equal(
    resolve(run.desktopDataPath).toLowerCase(),
    resolve(expectedDesktop).toLowerCase(),
    "Unexpected desktop profile",
  );
  assert.match(basename(run.desktopDataPath), /^com\.bycoda\.desktop\.dev\.[a-f0-9]{20}$/);
  const origin = new URL(run.devUrl);
  assert.equal(origin.hostname, "127.0.0.1");
  assert.equal(origin.protocol, "http:");
  assert.equal(Number(origin.port), run.ports?.ports?.vite);
  for (const port of Object.values(run.ports.ports)) {
    assert(
      Number.isInteger(port) && port > 1024 && port <= 65535 && port !== 1420 && port !== 1421,
      "Invalid isolated port",
    );
  }
  if (run.acceptanceControlPath)
    assertWithin(dirname(path), resolve(run.acceptanceControlPath), "control file");
  const identity = await readBuildIdentity(run.buildManifest);
  assert.equal(identity?.channel, "dev", "Acceptance requires a stamped development app");
  return { run, identity, recordPath: path };
}

export async function command(command, args, cwd) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", fail);
    child.once("close", (code) =>
      code === 0
        ? done(output.trim())
        : fail(new Error(`${command} ${args[0]} exited ${code}: ${output.slice(-3000)}`)),
    );
  });
}

export async function connectAcceptance(root, options) {
  const verified = await validateAcceptanceRun(root, options.run);
  const output = join(root, "temp", "verification", options.id);
  const scratch = join(root, "temp", "local", options.id);
  await Promise.all([mkdir(output, { recursive: true }), mkdir(scratch, { recursive: true })]);
  const context = { root, options, ...verified, output, scratch, state: {}, steps: [] };
  context.stage = (name, work, timeoutMs) => acceptanceStage(context, name, work, timeoutMs);
  const browser = await context.stage(
    "CDP connect",
    () =>
      chromium.connectOverCDP(`http://127.0.0.1:${verified.run.ports.ports.cdp}`, {
        timeout: 15000,
      }),
    20000,
  );
  context.browser = browser;
  try {
    const candidates = browser
      .contexts()
      .flatMap((context) => context.pages())
      .filter((entry) => entry.url().startsWith(verified.run.devUrl));
    let page;
    for (const candidate of candidates) {
      const windowLabel = await context.stage(
        "Read native window identity",
        () => candidate.evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label),
        10000,
      );
      if (windowLabel === "main") {
        page = candidate;
        break;
      }
    }
    assert(page, "The isolated native development page is unavailable");
    context.page = page;
    instrumentAcceptancePage(context, page);
    await context.stage(
      "Verify native build identity",
      () => verifyNativeIdentity(page, verified.identity),
      15000,
    );
    await Promise.all(
      [output, scratch].map((path) =>
        writeFile(
          join(path, "README.md"),
          "Isolated real Codex/native acceptance. Generated by scripts/build/acceptance-native.mjs. Contains only fake repositories and development evidence; never installed or release acceptance.\n",
        ),
      ),
    );
    context.step = async (text, work) => {
      console.log(text);
      const result = await context.stage(text, work, options.timeout + 30000);
      context.steps.push({ step: text, actual: result ?? "completed" });
      return result;
    };
    context.capture = (name) =>
      context.stage(`Capture ${name}`, () => captureMatrix(context, name), 90000);
    context.rpc = (method, params, cwd = context.state.project) =>
      context.stage(`RPC ${method}`, () =>
        context.page.evaluate(
          async ({ method, params, cwd }) => {
            const { workspaceRequest } =
              await import("/src/features/workspaces/model/workspaceClient.ts");
            return workspaceRequest(method, params, { cwd });
          },
          { method, params, cwd },
        ),
      );
    return context;
  } catch (error) {
    await disconnectAcceptance(browser);
    throw error;
  }
}

export async function captureMatrix(context, name) {
  const { page, output } = context;
  await dismissHarnessUpdateNotice(context);
  const captures = [];
  const previous = page.viewportSize();
  try {
    for (const width of [1280, 800])
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        await page.evaluate(async (theme) => {
          const { applyThemePreference } =
            await import("/src/features/settings/model/appearance.ts");
          applyThemePreference(theme);
        }, theme);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        });
        const path = join(output, `${name}-${width}-${theme}.png`);
        await page.screenshot({ path, animations: "disabled" });
        captures.push(path);
      }
  } finally {
    if (context.stageTimedOut) {
      /* Avoid a second blocked renderer operation after a diagnosed timeout. */
    } else if (previous) await page.setViewportSize(previous);
    else {
      const session = await page.context().newCDPSession(page);
      try {
        await session.send("Emulation.clearDeviceMetricsOverride");
      } finally {
        await session.detach();
      }
    }
  }
  return captures;
}

/** Query-backed screens intentionally pause while the native window is unfocused. */
export async function focusNativeWindow(context) {
  await context.page.bringToFront();
  if (process.platform === "win32") {
    await validateAcceptanceRun(context.root, context.recordPath);
    await command(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(context.root, "scripts", "build", "acceptance-native-focus.ps1"),
        "-Run",
        context.recordPath,
      ],
      context.root,
    );
  }
  await context.page.evaluate(async () => {
    const { getCurrentWindow } = await import("/node_modules/@tauri-apps/api/window.js");
    const native = getCurrentWindow();
    await native.unminimize();
    await native.show();
    await native.setFocus();
  });
  await waitUntil(
    async () =>
      context.page.evaluate(async () => {
        const state = await import("/src/platform/tauri/windowState.ts");
        await state.refreshWindowState();
        const current = state.getWindowState();
        return current?.visible && !current.minimized && current.focused;
      }),
    "The isolated native window could not receive focus for live UI queries",
    15000,
  );
  context.steps.push({
    step: "Focus the verified development window",
    actual: "Native window is visible, restored and focused; live query gates are open",
  });
}

export async function controlNative(context, action) {
  const path = context.run.acceptanceControlPath;
  if (!path)
    throw new Error(
      "Start pnpm dev:native --acceptance-controls to enable run-owned restart acceptance",
    );
  const id = randomUUID();
  await writeFile(path, JSON.stringify({ id, action }));
  const resultPath = join(dirname(path), "acceptance-result.json");
  for (const deadline = Date.now() + 60000; Date.now() < deadline; await sleep(200)) {
    const result = await readFile(context.run.acceptanceResultPath ?? resultPath, "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (result?.id !== id) continue;
    assert.equal(result.ok, true, result.error ?? `Native control ${action} failed`);
    return result;
  }
  throw new Error(`Native control ${action} timed out`);
}

async function label(page, text) {
  return page.evaluate(async (text) => (await import("/src/shared/i18n/index.ts")).t(text), text);
}
async function button(context, text) {
  return context.page
    .getByRole("button", { name: await label(context.page, text), exact: true })
    .first();
}
async function click(context, text) {
  await dismissHarnessUpdateNotice(context);
  await context.stage(
    `UI click ${text}`,
    async () => (await button(context, text)).click({ timeout: 20000 }),
    25000,
  );
  context.steps.push({ step: `Activate ${text}`, actual: "Control activated" });
}
async function dismissHarnessUpdateNotice(context) {
  const notice = context.page.getByRole("status", { name: "Harness updates", exact: true });
  if (!(await notice.isVisible())) return;
  await context.stage(
    "Dismiss the existing harness update notice",
    () =>
      notice.getByRole("button", { name: "Dismiss notice", exact: true }).click({ timeout: 10000 }),
    15000,
  );
  await notice.waitFor({ state: "hidden", timeout: 5000 });
  context.steps.push({
    step: "Dismiss the existing harness update notice",
    actual: "Notice closed through its own dismiss control; no provider update requested",
  });
}
async function getSessions(page) {
  return page.evaluate(
    async () => (await import("/src/features/sessions/model/sessionsStore.ts")).sessionsRef.current,
  );
}
async function session(context, id = context.state.sessionId) {
  const found = (await getSessions(context.page)).find((entry) => entry.id === id);
  assert(found, `Session ${id} not loaded`);
  return found;
}
async function closeRecoveredSessions(context) {
  const recovered = context.page.getByRole("dialog").filter({ hasText: "Recovered sessions" });
  await recovered.waitFor({ state: "visible", timeout: 1000 }).catch(() => {});
  if (await recovered.isVisible())
    await recovered.getByRole("button", { name: "Close", exact: true }).last().click();
}
async function dismissVisibleOverlays(context) {
  for (let remaining = 3; remaining > 0; remaining--) {
    const visible = context.page.locator('[role="dialog"]:visible,[role="menu"]:visible');
    const before = await visible.count();
    if (!before) return;
    const overlay = visible.last();
    const close = overlay.getByRole("button", { name: "Close", exact: true }).last();
    const cancel = overlay.getByRole("button", { name: "Cancel", exact: true }).last();
    if ((await close.isVisible()) && (await close.isEnabled())) await close.click();
    else if ((await cancel.isVisible()) && (await cancel.isEnabled())) await cancel.click();
    else {
      const target = overlay.locator("button,input,textarea,[tabindex]").first();
      if (await target.count()) await target.focus();
      else throw new Error("Existing development overlay has no safe dismissal target");
      await context.page.keyboard.press("Escape");
    }
    await waitUntil(
      async () => (await visible.count()) < before,
      "Existing development overlay did not close",
      5000,
    );
  }
  if (await context.page.locator('[role="dialog"]:visible,[role="menu"]:visible').count())
    throw new Error("Existing development overlays did not close during setup");
}
async function closeSettings(context) {
  const settings = context.page.getByRole("region", { name: "Settings", exact: true });
  if (await settings.isVisible())
    await settings.getByRole("button", { name: "Back to workspace", exact: true }).click();
}
async function waitUntil(check, message, timeout = 30000) {
  let last;
  for (const deadline = Date.now() + timeout; Date.now() < deadline; await sleep(200)) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      if (error.code === "NATIVE_ACCEPTANCE_STAGE_TIMEOUT") throw error;
      last = error;
    }
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ""}`);
}

export async function prepareProject(context) {
  if (context.preparedProject && context.state.project) return context.state.project;
  const project =
    context.state.project ??
    join(context.scratch, acceptanceProjectName(context.options.id, context.run.runId));
  assertWithin(context.scratch, project, "acceptance project");
  if (!existsSync(project)) {
    await mkdir(project, { recursive: true });
    await command("git", ["init", "-b", "main"], project);
    await command("git", ["config", "user.name", "bycoda native acceptance"], project);
    await command("git", ["config", "user.email", "native-acceptance@localhost"], project);
    await writeFile(join(project, "counter.txt"), "0\n");
    await writeFile(join(project, "preserve.txt"), "baseline\n");
    await writeFile(join(project, ".gitignore"), "node_modules/\n");
    await command("git", ["add", "counter.txt", "preserve.txt", ".gitignore"], project);
    await command("git", ["commit", "-m", "Create isolated native acceptance repository"], project);
  }
  context.state.project = project;
  await context.page.evaluate(async () =>
    (await import("/src/shared/i18n/index.ts")).setLanguagePreference("en"),
  );
  const skip = await button(context, "Set up later");
  if (await skip.isVisible()) await skip.click();
  const normalizedProject = await context.page.evaluate(async (cwd) => {
    const recents = await import("/src/features/projects/model/recents.ts");
    recents.rememberProject(cwd);
    recents.notifyProjectPathsChanged();
    return recents.normalizeProjectPath(cwd);
  }, project);
  await closeRecoveredSessions(context);
  await dismissVisibleOverlays(context);
  await closeSettings(context);
  const card = context.page
    .locator(`[data-project-path=${JSON.stringify(normalizedProject)}]`)
    .first();
  const projectButton = card.locator(":scope > button[title]").first();
  if (!(await projectButton.isVisible())) {
    await projectButton.waitFor({ state: "visible", timeout: 5000 }).catch(async () => {
      await context.page.reload({ waitUntil: "domcontentloaded" });
      await closeRecoveredSessions(context);
    });
  }
  const title = await projectButton.getAttribute("title");
  assert(
    title
      ?.split(/\r?\n/)
      .some(
        (line) =>
          line.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase() ===
          normalizedProject.toLowerCase(),
      ),
    "Project rail title does not match the exact acceptance project path",
  );
  await projectButton.click();
  await waitUntil(
    async () => (await card.getAttribute("data-selected")) === "true",
    "The exact acceptance project was not selected",
  );
  await context.page.evaluate(async (cwd) => {
    await (
      await import("/src/features/workspaces/model/workspaceClient.ts")
    ).getWorkspaceCapabilities({ cwd });
  }, project);
  context.preparedProject = true;
  return project;
}

export async function selectCodex(context, model = context.options.model) {
  const { page } = context;
  await focusNativeWindow(context);
  await dismissVisibleOverlays(context);
  const trigger = page
    .getByRole("button", { name: /^(Claude Code|Cursor|Codex|OpenCode|Pi|OMP|Grok) / })
    .first();
  await trigger.click();
  const modelEntry = page.getByRole("menuitem", { name: /^Model|^Model seç/ }).first();
  const codexTab = page.getByRole("tab", { name: "Codex", exact: true });
  const pickerVisible = async () => (await modelEntry.isVisible()) || (await codexTab.isVisible());
  try {
    await waitUntil(
      pickerVisible,
      "Model picker did not open on the focused development window",
      10000,
    );
  } catch (error) {
    if (!(await pickerVisible())) {
      const focused = await page.evaluate(async () =>
        (await import("/node_modules/@tauri-apps/api/window.js")).getCurrentWindow().isFocused(),
      );
      if (focused) throw error;
      await focusNativeWindow(context);
      if (!(await pickerVisible())) {
        if ((await trigger.getAttribute("aria-expanded")) === "true") await trigger.click();
        await trigger.click();
      }
      await waitUntil(
        pickerVisible,
        "Model picker did not reopen after one verified native focus-loss recovery",
        10000,
      );
      context.steps.push({
        step: "Recover model-picker interaction after native focus loss",
        actual: "Reactivated only the verified development PID and reopened its picker once",
      });
    }
  }
  if (await modelEntry.isVisible()) await modelEntry.click();
  await codexTab.click();
  const choice = page.getByRole("option").filter({ hasText: model }).first();
  await choice.click();
  await waitUntil(
    async () => (await trigger.getAttribute("aria-label"))?.includes(model),
    "Selected Codex model did not reach the composer",
  );
  const supervised = page.getByRole("button", { name: "Supervised", exact: true });
  if (await supervised.isVisible()) {
    await supervised.click();
    await page.getByText("Full access", { exact: true }).click();
  }
}

/** Tool views keep project state but replace the project rail with recent sessions. */
export async function activateAcceptanceProject(context) {
  const newButton = await button(context, "New session");
  if (await newButton.isVisible()) return;
  const normalize = (value) => value.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
  const normalizedProject = context.state.project.replaceAll("\\", "/").replace(/\/+$/, "");
  const card = context.page
    .locator(`[data-project-path=${JSON.stringify(normalizedProject)}]`)
    .first();
  if (!(await card.isVisible())) {
    const ownSessions = (await getSessions(context.page)).filter(
      (entry) => normalize(entry.cwd) === normalize(normalizedProject) && !entry.busy,
    );
    ownSessions.sort((a, b) => Number(Boolean(a.worktreeCwd)) - Number(Boolean(b.worktreeCwd)));
    let selected = false;
    for (const entry of ownSessions) {
      const row = context.page.locator(`[data-session-select=${JSON.stringify(entry.id)}]`).first();
      if (!(await row.isVisible())) continue;
      await row.click();
      selected = true;
      context.steps.push({
        step: "Return from tools through this fixture's retained session",
        actual: { sessionId: entry.id, cwd: entry.cwd },
      });
      break;
    }
    assert(
      selected,
      "No visible retained session can return to this acceptance project from the tools view",
    );
  }
  await card.waitFor({ state: "visible", timeout: 15000 });
  const projectButton = card.locator(":scope > button[title]").first();
  const title = await projectButton.getAttribute("title");
  assert(
    title?.split(/\r?\n/).some((line) => normalize(line) === normalize(normalizedProject)),
    "Route-back project title differs from this acceptance fixture",
  );
  await projectButton.click();
  await waitUntil(
    async () => (await card.getAttribute("data-selected")) === "true",
    "Route-back did not select the exact acceptance project",
  );
  await newButton.waitFor({ state: "visible", timeout: 15000 });
  context.steps.push({
    step: "Activate the exact acceptance project surface",
    actual: { cwd: normalizedProject, newSessionVisible: true },
  });
}

export async function newSession(context, mode = "current", model = context.options.model) {
  await prepareProject(context);
  await closeRecoveredSessions(context);
  await dismissVisibleOverlays(context);
  await closeSettings(context);
  await activateAcceptanceProject(context);
  await click(context, "New session");
  try {
    const trigger = context.page
      .getByRole("button", { name: /^Workspace (Current checkout|New worktree)$/ })
      .first();
    await waitUntil(
      async () => (await trigger.isVisible()) && (await trigger.isEnabled()),
      "New-session workspace controls did not finish loading",
      45000,
    );
    if (mode) {
      const selectedLabel = mode === "worktree" ? "New worktree" : "Current checkout";
      const expected = `Workspace ${selectedLabel}`;
      if ((await trigger.getAttribute("aria-label")) !== expected) {
        await trigger.click();
        await context.page
          .getByRole("dialog", { name: "Workspace", exact: true })
          .getByRole("button", { name: selectedLabel, exact: true })
          .click();
      }
      await context.page
        .getByRole("button", { name: expected, exact: true })
        .waitFor({ state: "visible", timeout: 45000 });
    }
    await selectCodex(context, model);
  } catch (error) {
    await dismissVisibleOverlays(context).catch(() => {});
    throw error;
  }
}

export async function assertCodexComposer(context, expectedSessionId) {
  const textarea = context.page.locator("textarea:visible").first();
  const sessionId = await textarea.evaluate((element) =>
    element.closest("[data-session-drop]")?.getAttribute("data-session-drop"),
  );
  assert(sessionId, "The visible composer has no native session identity; refusing to send");
  if (expectedSessionId)
    assert.equal(
      sessionId,
      expectedSessionId,
      "The visible composer belongs to a different session; refusing to send",
    );
  const current = await session(context, sessionId);
  assert.equal(
    current.harness,
    "codex",
    "The visible composer is not configured for Codex; refusing to send",
  );
  assert.equal(
    resolve(current.cwd).toLowerCase(),
    resolve(context.state.project).toLowerCase(),
    "The composer belongs to a different project; refusing to send",
  );
  const pane = context.page.locator(
    `[data-session-drop=${JSON.stringify(sessionId)}][data-session-visible="true"]`,
  );
  const model = pane
    .getByRole("button", { name: /^Codex (?:GPT[- ]|Codex(?:[- ]|$)|o[134](?:[- ]|$))/i })
    .first();
  assert(
    await model.isVisible(),
    "The visible session's model control does not confirm Codex; refusing to send",
  );
  return { textarea, sessionId };
}

export async function selectAcceptanceSession(context, sessionId) {
  const current = await waitUntil(
    async () => (await getSessions(context.page)).find((entry) => entry.id === sessionId),
    "The retained acceptance session did not hydrate after native restart",
    45000,
  );
  assert.equal(current.harness, "codex", "The retained acceptance session is not Codex");
  assert.equal(
    resolve(current.cwd).toLowerCase(),
    resolve(context.state.project).toLowerCase(),
    "The retained session belongs to a different project",
  );
  await focusNativeWindow(context);
  await closeRecoveredSessions(context);
  await dismissVisibleOverlays(context);
  await closeSettings(context);
  const row = context.page
    .locator(`[data-session-select=${JSON.stringify(sessionId)}]:visible`)
    .first();
  await row.waitFor({ state: "visible", timeout: 30000 });
  await row.click();
  await waitUntil(
    () => assertCodexComposer(context, sessionId),
    "The exact retained Codex session did not reopen",
    30000,
  );
  context.steps.push({
    step: "Reopen the exact retained Codex session after native restart",
    actual: { sessionId, cwd: current.cwd, harness: "codex" },
  });
}

export async function sendPrompt(
  context,
  prompt,
  { allowFailure = false, wait = true, expectedSessionId } = {},
) {
  const { page } = context;
  const { textarea } = await assertCodexComposer(context, expectedSessionId);
  const selected = await page
    .locator('[data-project-path][data-selected="true"]')
    .first()
    .getAttribute("data-project-path");
  assert(
    selected && resolve(selected).toLowerCase() === resolve(context.state.project).toLowerCase(),
    "The visible project differs from this acceptance fixture; refusing to send",
  );
  const prior = new Set(
    (await getSessions(page)).flatMap((entry) =>
      entry.blocks.filter((block) => block.role === "user").map((block) => block.id),
    ),
  );
  await textarea.fill(prompt);
  await click(context, "Send");
  const accepted = await waitUntil(
    async () =>
      (await getSessions(page)).find((entry) =>
        entry.blocks.some((block) => block.role === "user" && !block.draft && !prior.has(block.id)),
      ),
    "Send was not accepted",
  );
  context.state.sessionId = accepted.id;
  const acceptedUser = accepted.blocks.findLast(
    (block) => block.role === "user" && !block.draft && !prior.has(block.id),
  );
  context.state.lastUserBlockId = acceptedUser.id;
  if (!wait) return accepted;
  const settled = await waitUntil(
    async () => {
      const current = (await getSessions(page)).find((entry) => entry.id === accepted.id);
      const boundary = current?.blocks.findIndex((block) => block.id === acceptedUser.id) ?? -1;
      return current &&
        !current.busy &&
        boundary >= 0 &&
        current.blocks
          .slice(boundary + 1)
          .some(
            (block) =>
              (block.role === "assistant" && block.text.trim()) ||
              block.notice === "error" ||
              block.error,
          )
        ? current
        : false;
    },
    "Codex native turn did not settle",
    context.options.timeout,
  );
  assert.equal(settled.harness, "codex", "Acceptance must run real Codex");
  const last = settled.blocks.slice(
    settled.blocks.findIndex((block) => block.id === acceptedUser.id) + 1,
  );
  const text = last.map((block) => block.text).join("\n");
  if (!allowFailure) {
    assert(
      !/A different managed turn is still active|Target context capacity cannot fit/.test(text),
      "Owner-reported error remains",
    );
    assert(
      !last.some(
        (block) =>
          block.error ||
          block.notice === "error" ||
          (block.role === "system" && /could not start|recovery blocked/i.test(block.text)),
      ),
      "Native turn failed",
    );
    assert(
      last.some((block) => block.role === "assistant" && block.text.trim()),
      "Codex did not produce a completed assistant reply",
    );
    if (settled.workspaceId) {
      const { DatabaseSync } = await import("node:sqlite");
      await waitUntil(() => {
        const database = new DatabaseSync(join(context.run.desktopDataPath, "bycoda.db"));
        try {
          return (
            database
              .prepare("SELECT phase FROM native_managed_turns WHERE session_id=?")
              .get(settled.id)?.phase === "complete"
          );
        } finally {
          database.close();
        }
      }, "Native turn did not finish its durable after-capture");
    }
  } else {
    assert(
      last.some((block) => block.error || block.notice === "error"),
      "Expected native admission failure was not observed",
    );
  }
  context.steps.push({
    step: `Send real Codex turn in ${settled.id}`,
    actual: allowFailure
      ? "Expected rejection observed"
      : "Assistant completed; managed capture complete when applicable",
  });
  return settled;
}

export async function commitTurn(context, number, prefix) {
  const prompt = `Isolated acceptance ${prefix} turn ${number}. Set counter.txt to exactly ${number} followed by a newline. Commit ONLY counter.txt with message "Acceptance ${prefix} turn ${number}". Use the terminal and git in this session's assigned checkout. Do not change any other path or push. Reply DONE${number} after committing.`;
  const current = await sendPrompt(context, prompt);
  const cwd = current.worktreeCwd || current.cwd;
  assertWithin(context.scratch, cwd, "provider checkout");
  assert.equal((await readFile(join(cwd, "counter.txt"), "utf8")).trim(), String(number));
  assert.equal(
    await command("git", ["log", "-1", "--format=%s"], cwd),
    `Acceptance ${prefix} turn ${number}`,
  );
  assert.equal(await command("git", ["status", "--porcelain"], cwd), "");
  return {
    id: current.id,
    cwd,
    head: await command("git", ["rev-parse", "HEAD"], cwd),
    prompt,
    userBlockId: current.blocks.findLast((block) => block.role === "user").id,
    blocks: current.blocks,
  };
}

async function scenario1(context) {
  await newSession(context, null);
  const current = context.page.getByRole("button", {
    name: "Workspace Current checkout",
    exact: true,
  });
  assert(await current.isVisible(), "New session does not display Current checkout by default");
  await context.capture("01-default-current");
  const turns = [];
  for (const number of [1, 2, 3]) {
    const result = await context.step(`Current checkout turn ${number}`, () =>
      commitTurn(context, number, "current"),
    );
    assert.equal(resolve(result.cwd).toLowerCase(), resolve(context.state.project).toLowerCase());
    assert(
      !(await session(context)).workspaceId,
      "Current checkout incorrectly acquired managed admission",
    );
    turns.push(result);
  }
  context.state.currentTurns = turns;
  return { turns, screenshots: await context.capture("01-current-three-turns") };
}

async function scenario2(context) {
  await newSession(context, "worktree");
  const turns = [];
  for (const number of [1, 2, 3])
    turns.push(
      await context.step(`Worktree turn ${number}`, () => commitTurn(context, number, "worktree")),
    );
  const third = turns[2];
  const bytes = await readFile(join(third.cwd, "counter.txt"), "utf8");
  const before = await session(context);
  assert(
    before.workspaceId && before.worktreeCwd,
    "Opt-in session did not acquire a managed worktree",
  );
  context.state.worktreeSessionId = before.id;
  context.state.worktreeTurns = turns;
  const screenshots = await context.capture("02-three-worktree-turns");
  const anchor = context.page.locator(`[data-prompt-anchor="${third.userBlockId}"]`);
  await anchor
    .getByRole("button", { name: await label(context.page, "Message actions"), exact: true })
    .click();
  await context.page
    .getByRole("menuitem", {
      name: await label(context.page, "Return before this message"),
      exact: true,
    })
    .click();
  const rewindDialog = context.page.getByRole("dialog", {
    name: "Rewind conversation and files",
    exact: true,
  });
  await rewindDialog.waitFor();
  await waitUntil(
    () =>
      rewindDialog
        .getByRole("button", { name: "Rewind conversation and files", exact: true })
        .isEnabled(),
    "Rewind preview was not ready",
  );
  screenshots.push(...(await context.capture("02-rewind-preview")));
  await context.page
    .getByRole("dialog")
    .getByRole("button", {
      name: await label(context.page, "Rewind conversation and files"),
      exact: true,
    })
    .click();
  await rewindDialog.waitFor({ state: "hidden", timeout: 30000 });
  await waitUntil(
    async () => (await command("git", ["rev-parse", "HEAD"], third.cwd)) === turns[1].head,
    "Rewind did not restore second commit",
  );
  assert.equal((await readFile(join(third.cwd, "counter.txt"), "utf8")).trim(), "2");
  await click(context, "Undo rewind");
  const undoDialog = context.page.getByRole("dialog", { name: "Undo rewind", exact: true });
  await undoDialog.waitFor();
  await waitUntil(
    () => undoDialog.getByRole("button", { name: "Undo rewind", exact: true }).isEnabled(),
    "Undo preview was not ready",
  );
  screenshots.push(...(await context.capture("02-undo-preview")));
  await context.page
    .getByRole("dialog")
    .getByRole("button", { name: await label(context.page, "Undo rewind"), exact: true })
    .click();
  await undoDialog.waitFor({ state: "hidden", timeout: 30000 });
  await waitUntil(
    async () => (await command("git", ["rev-parse", "HEAD"], third.cwd)) === third.head,
    "Undo did not restore third commit",
  );
  assert.equal(await readFile(join(third.cwd, "counter.txt"), "utf8"), bytes);
  const expectedTranscript = JSON.stringify(
    before.blocks.map(({ id, role, text }) => ({ id, role, text })),
  );
  await waitUntil(
    async () =>
      JSON.stringify(
        (await session(context)).blocks.map(({ id, role, text }) => ({ id, role, text })),
      ) === expectedTranscript,
    "Undo did not reconcile the exact restored transcript",
  );
  screenshots.push(...(await context.capture("02-after-undo")));
  return { turns, restoredHead: third.head, restoredBlocks: before.blocks.length, screenshots };
}

async function waitForActiveNativeProcess(context, sessionId, userBlockId) {
  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = join(context.run.desktopDataPath, "bycoda.db");
  return waitUntil(
    async () => {
      const check = new DatabaseSync(databasePath);
      let row;
      try {
        row = check
          .prepare("SELECT request_json,phase FROM native_managed_turns WHERE session_id=?")
          .get(sessionId);
      } finally {
        check.close();
      }
      if (row?.phase !== "active") return false;
      const request = JSON.parse(row.request_json);
      if (request.userBlockId !== userBlockId) return false;
      const crashBindingPath = join(
        context.run.hostDataPath,
        "managed-workspaces",
        "native-turns",
        request.workspaceId,
        `${request.userBlockId}.json`,
      );
      const crashBinding = JSON.parse(await readFile(crashBindingPath, "utf8"));
      if (!crashBinding.processActivityOwnerId) return false;
      const processDirectory = join(
        context.run.hostDataPath,
        "managed-workspaces",
        "native-activity",
        "processes",
      );
      for (const filename of await readdir(processDirectory)) {
        if (!filename.endsWith(".json")) continue;
        const lease = JSON.parse(await readFile(join(processDirectory, filename), "utf8"));
        if (
          lease.activityOwnerId !== crashBinding.processActivityOwnerId ||
          lease.sessionId !== sessionId ||
          lease.kind !== "provider"
        )
          continue;
        if (
          !Number.isSafeInteger(lease.processId) ||
          lease.processId < 1 ||
          lease.phase !== "active"
        )
          return false;
        process.kill(lease.processId, 0);
        return { request, processId: lease.processId, activityOwnerId: lease.activityOwnerId };
      }
      return false;
    },
    "Native turn did not reach an accepted native turn with a live durably bound provider PID",
    60000,
  );
}

export function assertRejectedNativeAdmission(error, request, expected) {
  assert.match(
    error ?? "",
    /Another workspace writer or unknown activity is still active|Workspace has another writer or unsettled native buffers/,
    "Native begin did not reach the expected Host dirty-writer rejection",
  );
  assert(request, "Rejected begin did not retain a native reservation");
  for (const key of ["sessionId", "workspaceId", "userBlockId", "runId"])
    assert.equal(request[key], expected[key], `Rejected native reservation has a different ${key}`);
}

export async function isolatedHostEditorActivity(context, current) {
  assertWithin(context.scratch, current.worktreeCwd, "foreign editor fixture");
  assert.equal(resolve(current.cwd).toLowerCase(), resolve(context.state.project).toLowerCase());
  const storePath = await realpath(join(context.run.desktopDataPath, "remote-machines.json"));
  assertWithin(
    await realpath(context.run.desktopDataPath),
    storePath,
    "isolated paired connection",
  );
  const endpoint = `http://127.0.0.1:${context.run.ports.ports.host}`;
  // The generic desktop RPC allowlist does not expose editor registration.
  // Reuse ONLY the exact isolated Host's paired credential privately; never log it.
  const machines = JSON.parse(await readFile(storePath, "utf8"));
  const machine = machines.find(
    (entry) => entry.localHost === true && !entry.ssh && entry.endpoint === endpoint,
  );
  assert(
    machine && /^[A-Za-z0-9_-]{43}$/.test(machine.token),
    "The isolated Host pairing is unavailable",
  );
  assert.equal(typeof machine.environmentId, "string");
  const call = async (method, params) =>
    context.stage(
      `Isolated Host ${method}`,
      async () => {
        const response = await fetch(`${endpoint}/rpc`, {
          method: "POST",
          headers: { Authorization: `Bearer ${machine.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            version: 1,
            environmentId: machine.environmentId,
            method,
            params,
          }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        const body = await response.json();
        if (!response.ok || body.error)
          throw new Error(
            `Isolated Host editor activity failed (${response.status}): ${body.error ?? "invalid response"}`,
          );
        assert(Object.hasOwn(body, "result"), "The isolated Host activity result is absent");
        return body.result;
      },
      20000,
    );
  const descriptor = await call("environment.describe", {});
  assert.equal(
    descriptor.environmentId,
    machine.environmentId,
    "The paired Host environment changed",
  );
  assert.equal(
    descriptor.buildIdentity?.channel,
    "dev",
    "The editor fixture requires a development Host",
  );
  assert.equal(
    descriptor.buildIdentity?.buildId,
    context.identity.buildId,
    "The paired Host build differs from the verified native build",
  );
  assert.equal(
    descriptor.buildIdentity?.head,
    context.identity.head,
    "The paired Host source differs from the verified native build",
  );
  const activity = await call("workspaces.activities.start", {
    workspaceId: current.workspaceId,
    kind: "editor",
    dirtyBuffer: true,
  });
  assert(
    activity?.id &&
      activity.workspaceId === current.workspaceId &&
      activity.kind === "editor" &&
      activity.dirtyBuffer === true,
    "The isolated Host returned a different editor activity",
  );
  return {
    activityId: activity.id,
    release: async () => {
      const stopped = await call("workspaces.activities.stop", {
        workspaceId: current.workspaceId,
        activityId: activity.id,
      });
      assert.equal(stopped.stopped, true, "The exact foreign editor activity did not stop");
    },
  };
}

async function scenario3(context) {
  await newSession(context, "worktree");
  const screenshots = [];
  const recoveryCounter = Number(
    (await readFile(join(context.state.project, "counter.txt"), "utf8")).trim(),
  );
  assert(Number.isSafeInteger(recoveryCounter), "Fake target counter is invalid");
  await commitTurn(context, recoveryCounter + 1, "recovery");
  let current = await session(context);
  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = join(context.run.desktopDataPath, "bycoda.db");
  assert(existsSync(databasePath), "Isolated desktop database was not found");
  const dirtyPath = join(current.worktreeCwd, "counter.txt");
  assertWithin(context.scratch, dirtyPath, "simulated dirty buffer");
  const dirtyOwner = await isolatedHostEditorActivity(context, current);
  let rejectedRequest;
  try {
    const rejectedBoundary = await context.page.evaluate(async (id) => {
      const store = await import("/src/features/sessions/model/sessionsStore.ts");
      const { upsertSession, flushSessionWrites } =
        await import("/src/features/sessions/data/sessionStore.ts");
      const original = store.sessionsRef.current.find((entry) => entry.id === id);
      const user = {
        id: crypto.randomUUID(),
        role: "user",
        text: "Isolated rejected native admission",
        startedAt: Date.now(),
      };
      const next = { ...original, blocks: [...original.blocks, user] };
      store.setSessions((entries) => entries.map((entry) => (entry.id === id ? next : entry)));
      await flushSessionWrites();
      if (!(await upsertSession(next))) throw new Error("Rejected-boundary setup was not saved");
      await flushSessionWrites();
      return {
        sessionId: id,
        workspaceId: original.workspaceId,
        userBlockId: user.id,
        runId: crypto.randomUUID(),
      };
    }, current.id);
    await waitUntil(
      () => {
        const check = new DatabaseSync(databasePath);
        try {
          return Boolean(
            check
              .prepare(
                "SELECT 1 FROM session_blocks b JOIN session_block_state s ON s.session_id=b.session_id AND s.length>=0 WHERE b.session_id=? AND block_id=? AND json_extract(block_json,'$.role')='user' AND COALESCE(json_extract(block_json,'$.draft'),0)=0",
              )
              .get(current.id, rejectedBoundary.userBlockId),
          );
        } finally {
          check.close();
        }
      },
      "The exact rejected-admission user boundary did not become durable",
      15000,
    );
    const rejected = await context.page.evaluate(async (boundary) => {
      const { desktopInstanceId } =
        await import("/src/features/connections/model/desktopInstance.ts");
      try {
        await window.__TAURI_INTERNALS__.invoke("managed_turn_begin", {
          sessionId: boundary.sessionId,
          userBlockId: boundary.userBlockId,
          runId: boundary.runId,
          clientId: desktopInstanceId(),
        });
        return { error: null };
      } catch (error) {
        return { error: String(error) };
      }
    }, rejectedBoundary);
    context.steps.push({
      step: "Register an authenticated foreign editor activity and attempt native begin after the exact user boundary is durable",
      actual: {
        path: dirtyPath,
        dirty: true,
        foreignEditorActivityId: dirtyOwner.activityId,
        ...rejectedBoundary,
        error: rejected.error,
      },
    });
    const database = new DatabaseSync(databasePath);
    try {
      rejectedRequest = database
        .prepare("SELECT request_json FROM native_managed_turns WHERE session_id=?")
        .get(current.id)?.request_json;
    } finally {
      database.close();
    }
    assertRejectedNativeAdmission(
      rejected.error,
      rejectedRequest ? JSON.parse(rejectedRequest) : null,
      rejectedBoundary,
    );
    screenshots.push(...(await context.capture("03-rejected-begin")));
  } finally {
    await dirtyOwner.release();
  }
  await sendPrompt(context, "Reply RECOVERED without editing files.");
  await sendPrompt(
    context,
    "Use the terminal to wait 10 seconds, then reply HOSTMIDTURN. Do not edit files.",
    { wait: false },
  );
  const hostUserBlockId = context.state.lastUserBlockId;
  const hostAdmission = await waitForActiveNativeProcess(context, current.id, hostUserBlockId);
  const previousHostPid = JSON.parse(await readFile(context.recordPath, "utf8")).hostPid;
  const restartedHost = await controlNative(context, "restart-host");
  assert.notEqual(
    restartedHost.hostPid,
    previousHostPid,
    "The isolated Host process did not restart",
  );
  await waitUntil(
    async () => {
      const candidate = await session(context, current.id);
      if (candidate.busy) return false;
      const boundary = candidate.blocks.findIndex((block) => block.id === hostUserBlockId);
      if (boundary < 0) return false;
      const tail = candidate.blocks.slice(boundary + 1);
      const failure = tail.find((block) => block.notice === "error" || block.error);
      if (failure) throw new Error(failure.text);
      return tail.some((block) => block.role === "assistant" && block.text.trim() === "HOSTMIDTURN")
        ? candidate
        : false;
    },
    "The real native turn did not finish after its Host restarted",
    90000,
  );
  await waitUntil(
    () => {
      const check = new DatabaseSync(databasePath);
      try {
        const row = check
          .prepare("SELECT request_json,phase FROM native_managed_turns WHERE session_id=?")
          .get(current.id);
        return (
          row?.phase === "complete" && JSON.parse(row.request_json).userBlockId === hostUserBlockId
        );
      } finally {
        check.close();
      }
    },
    "The Host-restarted native turn did not finish its durable after-capture",
    60000,
  );
  context.steps.push({
    step: "Restart the isolated Host during accepted real Codex execution",
    actual: {
      userBlockId: hostUserBlockId,
      providerPid: hostAdmission.processId,
      previousHostPid,
      restartedHostPid: restartedHost.hostPid,
      nativePhase: "complete",
      assistant: "HOSTMIDTURN",
    },
  });
  await sendPrompt(context, "Reply HOSTRECOVERED without editing files.");
  // Seed the exact legacy shape only in the validated development DB. Existing completed row provides identity.
  current = await session(context);
  assert(rejectedRequest, "Failed admission did not create the native reservation");
  const legacyRequest = JSON.parse(rejectedRequest);
  assert.match(legacyRequest.workspaceId, /^[A-Za-z0-9_-]+$/);
  assert.match(legacyRequest.userBlockId, /^[A-Za-z0-9_-]+$/);
  const bindingPath = join(
    context.run.hostDataPath,
    "managed-workspaces",
    "native-turns",
    legacyRequest.workspaceId,
    `${legacyRequest.userBlockId}.json`,
  );
  const turnPath = join(
    context.run.hostDataPath,
    "managed-workspaces",
    "turns",
    legacyRequest.workspaceId,
    `${legacyRequest.userBlockId}.json`,
  );
  const history = await readFile(turnPath, "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  assert.notEqual(history?.before?.status, "complete", "Legacy seed has a complete before-capture");
  await controlNative(context, "stop-host");
  const binding = JSON.parse(await readFile(bindingPath, "utf8"));
  assert.equal(binding.runId, legacyRequest.runId);
  assert.equal(binding.released, true, "Rejected binding was not durably cancelled");
  delete binding.released;
  await writeFile(bindingPath, JSON.stringify(binding));
  context.steps.push({
    step: "Seed the owner's unreleased starting-row shape in the development profile",
    actual: {
      sessionId: legacyRequest.sessionId,
      userBlockId: legacyRequest.userBlockId,
      runId: legacyRequest.runId,
      beforeCapture: history?.before?.status ?? "absent",
      hostBindingReleased: false,
    },
  });
  const database = new DatabaseSync(databasePath);
  try {
    assert(
      rejectedRequest,
      "Failed admission never reached the native reservation; cannot seed the legacy scenario",
    );
    const request = JSON.parse(rejectedRequest);
    assert.equal(request.sessionId, current.id);
    assert.notEqual(
      request.userBlockId,
      current.blocks.findLast((block) => block.role === "user").id,
      "Rejected request was not preserved",
    );
    const seeded = database
      .prepare("UPDATE native_managed_turns SET request_json=?,phase='starting' WHERE session_id=?")
      .run(rejectedRequest, current.id);
    assert.equal(
      Number(seeded.changes),
      1,
      "Legacy seed did not update exactly one development row",
    );
  } finally {
    database.close();
  }
  await controlNative(context, "start-host");
  await context.page.reload({ waitUntil: "domcontentloaded" });
  await closeRecoveredSessions(context);
  await selectAcceptanceSession(context, current.id);
  await waitUntil(async () => {
    const check = new DatabaseSync(databasePath);
    try {
      const row = check
        .prepare("SELECT phase,request_json FROM native_managed_turns WHERE session_id=?")
        .get(current.id);
      return row?.phase === "complete" && row.request_json === rejectedRequest;
    } finally {
      check.close();
    }
  }, "Opening updated app did not self-heal the exact retained native row");
  assert.equal(
    JSON.parse(await readFile(bindingPath, "utf8")).released,
    true,
    "Host did not durably release the legacy binding",
  );
  context.steps.push({
    step: "Reload the updated native app and reconcile the retained admission",
    actual: "Exact native request completed and matching Host binding durably released",
  });
  await sendPrompt(context, "Reply LEGACYRECOVERED without editing files.");
  await sendPrompt(
    context,
    "Wait 40 seconds using the terminal, then reply RESTARTTEST. Do not edit any files.",
    { wait: false },
  );
  const crashUserBlockId = context.state.lastUserBlockId;
  const crashAdmission = await waitForActiveNativeProcess(context, current.id, crashUserBlockId);
  context.steps.push({
    step: "Verify the crash occurs during accepted execution",
    actual: {
      phase: "active",
      userBlockId: crashUserBlockId,
      runId: crashAdmission.request.runId,
      providerPid: crashAdmission.processId,
    },
  });
  await controlNative(context, "restart-app");
  await disconnectAcceptance(context.browser);
  const replacement = await waitUntil(
    () => connectAcceptance(context.root, context.options),
    "Restarted native app CDP did not become ready",
    60000,
  );
  context.browser = replacement.browser;
  context.page = replacement.page;
  instrumentAcceptancePage(context, context.page);
  context.preparedProject = false;
  await closeRecoveredSessions(context);
  await selectAcceptanceSession(context, current.id);
  await waitUntil(
    async () =>
      (await getSessions(context.page)).find((entry) => entry.id === current.id && !entry.busy),
    "Restarted session did not settle",
    90000,
  );
  const reset = await button(context, "Reset stuck turn");
  const resetUsed = await reset.isVisible();
  const beforeNextDatabase = new DatabaseSync(databasePath);
  let beforeNextSend;
  try {
    beforeNextSend = beforeNextDatabase
      .prepare("SELECT request_json,phase FROM native_managed_turns WHERE session_id=?")
      .get(current.id);
  } finally {
    beforeNextDatabase.close();
  }
  assert(
    beforeNextSend && ["active", "finishing", "complete"].includes(beforeNextSend.phase),
    "The exact accepted crash row is unavailable before recovery",
  );
  assert.equal(
    JSON.parse(beforeNextSend.request_json).userBlockId,
    crashUserBlockId,
    "The accepted crash row changed before the next send",
  );
  screenshots.push(...(await context.capture("03-after-reopen-before-next-send")));
  if (resetUsed) await reset.click();
  const resumed = await sendPrompt(context, "Reply APPRECOVERED without editing files.", {
    expectedSessionId: current.id,
  });
  const resumedUserBlockId = context.state.lastUserBlockId;
  assert.notEqual(
    resumedUserBlockId,
    crashUserBlockId,
    "The next send did not create a new accepted boundary",
  );
  const resumedTail = resumed.blocks.slice(
    resumed.blocks.findIndex((block) => block.id === resumedUserBlockId) + 1,
  );
  assert(
    resumedTail.some((block) => block.role === "assistant" && block.text.trim() === "APPRECOVERED"),
    "The exact restored Codex session did not answer the next send",
  );
  await waitUntil(
    () => {
      const check = new DatabaseSync(databasePath);
      try {
        const row = check
          .prepare("SELECT request_json,phase FROM native_managed_turns WHERE session_id=?")
          .get(current.id);
        return (
          row?.phase === "complete" &&
          JSON.parse(row.request_json).userBlockId === resumedUserBlockId
        );
      } finally {
        check.close();
      }
    },
    "The next native turn did not complete after recovery of accepted execution",
    60000,
  );
  const crashRecordPath = join(
    context.run.hostDataPath,
    "managed-workspaces",
    "turns",
    crashAdmission.request.workspaceId,
    `${crashUserBlockId}.json`,
  );
  const crashRecord = JSON.parse(await readFile(crashRecordPath, "utf8"));
  assert.equal(
    crashRecord.userBlockId,
    crashUserBlockId,
    "The old Host record belongs to a different user boundary",
  );
  assert.equal(
    crashRecord.runId,
    crashAdmission.request.runId,
    "The old Host record belongs to a different execution",
  );
  assert.equal(
    crashRecord.before.status,
    "complete",
    "Crash test never had an accepted before-capture",
  );
  assert.equal(
    crashRecord.after?.status,
    "complete",
    "Recovered accepted turn has no durable after-capture",
  );
  context.steps.push({
    step: "Reconcile accepted execution after native restart",
    actual: {
      userBlockId: crashUserBlockId,
      nativePhaseBeforeNextSend: beforeNextSend.phase,
      nextUserBlockId: resumedUserBlockId,
      nativePhase: "complete",
      afterCapture: "complete",
      resetUsed,
      recoveryPath: resetUsed
        ? "reset"
        : beforeNextSend.phase === "complete"
          ? "startup"
          : "pre-send",
    },
  });
  screenshots.push(...(await context.capture("03-after-recovery")));
  return { sessionId: current.id, screenshots };
}

async function scenario4(context) {
  await newSession(context, "current");
  await sendPrompt(
    context,
    "Remember this isolated test: Türkiye, İstanbul, çalışma alanı. Reply READY without editing.",
  );
  const initialModel = (await session(context)).model;
  const prompt =
    "Bu yalıtılmış kabul denemesidir. Dosyaları değiştirme. Yalnızca TAMAM yaz.\n" +
    "Türkiye İstanbul çalışma alanı, geçmiş konuşma ve güvenli model değişimi. ".repeat(400);
  assert(Buffer.byteLength(prompt, "utf8") > 20480);
  const draft = context.page.locator("textarea:visible").first();
  await draft.fill(prompt);
  await selectCodex(context, context.options.switchModel);
  await waitUntil(
    async () =>
      (await session(context)).model
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .includes(context.options.switchModel.toLowerCase().replace(/[^a-z0-9]/g, "")),
    "Target model was not saved to the current session",
  );
  assert.equal(
    await draft.inputValue(),
    prompt,
    "Model selection discarded the unsent long Turkish draft",
  );
  const switched = await sendPrompt(context, prompt);
  const switchedUserId = context.state.lastUserBlockId;
  const replyBoundary = switched.blocks.findLastIndex((block) => block.id === switchedUserId);
  const storedRequest = switched.blocks[replyBoundary];
  assert.equal(
    storedRequest.text,
    prompt.trim(),
    "The complete Turkish request was not preserved by the composer",
  );
  await writeFile(
    join(context.output, "04-turkish-request.json"),
    `${JSON.stringify({ userBlockId: switchedUserId, original: prompt, stored: storedRequest.text, normalization: "Composer trims submitted text; Long text is presentation-only" }, null, 2)}\n`,
  );
  assert.notEqual(switched.model, initialModel, "Codex model selection did not change");
  assert(
    switched.model
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .includes(context.options.switchModel.toLowerCase().replace(/[^a-z0-9]/g, "")),
    "Wrong target model was used",
  );
  assert(
    switched.blocks
      .slice(replyBoundary + 1)
      .some((block) => block.role === "assistant" && block.text.trim() === "TAMAM"),
    "Switched Codex model did not answer",
  );
  const screenshots = await context.capture("04-long-turkish-switch");
  // Labelled setup: only browser discovery metadata is constrained. Codex still
  // runs the real selected model; no second provider or synthetic provider reply.
  const seed = await context.page.evaluate(async (id) => {
    const models = await import("/src/features/sessions/model/models.ts");
    const store = await import("/src/features/sessions/model/sessionsStore.ts");
    const { upsertSession } = await import("/src/features/sessions/data/sessionStore.ts");
    const originalModels = models.catalogModelsFor("codex");
    const current = store.sessionsRef.current.find((entry) => entry.id === id);
    const next = {
      ...current,
      handoffCard: {
        from: "codex",
        to: "codex",
        brief: "Seeded saved history for isolated capacity recovery. ".repeat(300),
      },
    };
    if (!(await upsertSession(next))) throw new Error("Capacity seed session was not saved");
    store.setSessions((entries) => entries.map((entry) => (entry.id === id ? next : entry)));
    models.setHarnessModels(
      "codex",
      originalModels.map((entry) => ({ ...entry, contextWindow: 32 })),
    );
    return { originalModels, contextWindow: models.modelContextWindow(current.model, "codex") };
  }, switched.id);
  assert.equal(seed.contextWindow, 32, "Capacity setup did not constrain the frontend estimate");
  let capacity;
  try {
    const capacityPrompt = `${prompt}\nBu tur kaydedilmiş geçmiş bütçesini sınar. Yalnızca TAMAM yaz.`;
    const completed = await sendPrompt(context, capacityPrompt);
    const capacityUserId = context.state.lastUserBlockId;
    const boundary = completed.blocks.findLastIndex((block) => block.id === capacityUserId);
    const tail = completed.blocks.slice(boundary + 1);
    assert(
      tail.some((block) => block.role === "assistant" && block.text.trim() === "TAMAM"),
      "Budget-constrained real Codex request did not complete",
    );
    const notice = tail.find(
      (block) =>
        block.role === "system" && block.notice === "info" && /Saved history:/.test(block.text),
    );
    assert(notice, "Reduced handoff did not leave the saved-history notice");
    const archivePath = notice.text.match(/Saved history:\s*(.+)$/m)?.[1].trim();
    assertWithin(context.run.desktopDataPath, archivePath, "isolated handoff archive");
    const archive = JSON.parse(await readFile(archivePath, "utf8"));
    assert.equal(archive.sessionId, switched.id);
    assert(
      archive.messages.some(
        (entry) => entry.id === switchedUserId && entry.text === storedRequest.text,
      ),
      "Earlier Turkish request was not preserved in saved history",
    );
    assert(
      !archive.messages.some((entry) => entry.id === capacityUserId),
      "Current request was duplicated into historical handoff",
    );
    capacity = {
      setup:
        "Explicit seeded handoff card and 32-token frontend discovery estimate; actual provider is real Codex",
      archivePath,
      savedMessages: archive.messages.length,
      notice: notice.text,
    };
    screenshots.push(...(await context.capture("04-reduced-handoff-notice")));
  } finally {
    await context.page.evaluate(
      async (models) =>
        (await import("/src/features/sessions/model/models.ts")).setHarnessModels("codex", models),
      seed.originalModels,
    );
  }
  return {
    bytes: Buffer.byteLength(prompt, "utf8"),
    model: switched.model,
    capacity,
    screenshots,
  };
}

async function scenario5(context) {
  await prepareProject(context);
  const path = join(context.run.hostDataPath, "dev-capabilities.json");
  const reconnect = async () => {
    await context.page.evaluate(async () => {
      (
        await import("/src/features/automations/model/machineSnapshot.ts")
      ).invalidateMachineSnapshot();
      await window.__TAURI_INTERNALS__.invoke("local_host_connect");
    });
    await context.page.reload({ waitUntil: "domcontentloaded" });
    context.preparedProject = false;
    await closeRecoveredSessions(context);
  };
  try {
    const screenshots = [];
    const cases = [];
    const processFiles = () =>
      readdir(
        join(context.run.hostDataPath, "managed-workspaces", "native-activity", "processes"),
      ).catch((error) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
    for (const [name, disabled] of [
      ["missing-managed", ["workspaces.managed.v1"]],
      ["missing-native-process-recovery", ["sessions.native-process-recovery.v1"]],
    ]) {
      await writeFile(path, JSON.stringify({ disabled }));
      await reconnect();
      const capabilities = await context.page.evaluate(
        async (cwd) =>
          (
            await import("/src/features/workspaces/model/workspaceClient.ts")
          ).getWorkspaceCapabilities({ cwd }),
        context.state.project,
      );
      assert(
        !capabilities.includes(disabled[0]),
        "The development Host did not apply its capability override",
      );
      if (name === "missing-native-process-recovery")
        assert(
          capabilities.includes("workspaces.managed.v1"),
          "The additive-capability case must retain managed workspace support",
        );
      await newSession(context, "current");
      await sendPrompt(context, `Reply OLDHOSTCURRENT-${name} without editing files.`);
      await newSession(context, "worktree");
      const prompt = `Reply EXPLICITCURRENT-${name} without editing files.`;
      const composer = context.page.locator("textarea:visible").first();
      await composer.fill(prompt);
      const beforeProcesses = await processFiles();
      const send = await button(context, "Send");
      if (await send.isEnabled()) await send.click();
      const useCurrent = await button(context, "Use current checkout");
      await useCurrent.waitFor({ timeout: 30000 });
      const warning = await context.page
        .locator('[data-workspace-creation-status][role="alert"]:visible')
        .first()
        .innerText();
      assert.match(
        warning,
        /Update bycoda Host/,
        "The old Host did not show an accurate update requirement",
      );
      assert.deepEqual(
        await processFiles(),
        beforeProcesses,
        "A blocked Worktree send spawned a native provider activity",
      );
      screenshots.push(...(await context.capture(`05-${name}-host-update-pending`)));
      await useCurrent.click();
      assert.equal(
        await composer.inputValue(),
        prompt,
        "Use current checkout discarded the unsent draft",
      );
      const explicit = await sendPrompt(context, prompt);
      assert(!explicit.workspaceId, "Use current checkout retained managed-workspace admission");
      assert.equal(
        resolve(explicit.cwd).toLowerCase(),
        resolve(context.state.project).toLowerCase(),
      );
      cases.push({
        name,
        disabled,
        warning,
        currentSessionId: explicit.id,
        blockedProviderActivities: 0,
      });
      context.steps.push({
        step: `Exercise the old Host without ${disabled[0]}`,
        actual: cases.at(-1),
      });
    }
    await writeFile(path, JSON.stringify({ disabled: [] }));
    await reconnect();
    await newSession(context, "worktree");
    await commitTurn(context, 1, "reconnected");
    assert(
      !(await (await button(context, "Use current checkout")).isVisible()),
      "Pending Host update did not clear",
    );
    screenshots.push(...(await context.capture("05-capability-returned")));
    return { cases, screenshots };
  } finally {
    await writeFile(path, JSON.stringify({ disabled: [] }));
    await reconnect();
  }
}

async function openWorkspaceSettings(context) {
  await context.page.keyboard.press("Control+,");
  await context.page
    .getByRole("tab", { name: await label(context.page, "Source control"), exact: true })
    .click();
}

async function scenario6(context) {
  await context.stage(
    "Scenario 6: create the worktree session",
    () => newSession(context, "worktree"),
    120000,
  );
  const targetCounter = Number(
    (await readFile(join(context.state.project, "counter.txt"), "utf8")).trim(),
  );
  assert(Number.isSafeInteger(targetCounter), "Fake target counter is invalid");
  await context.stage(
    "Scenario 6: first real native editing turn",
    () => commitTurn(context, targetCounter + 1, "lifecycle"),
    context.options.timeout + 30000,
  );
  context.state.worktreeSessionId = context.state.sessionId;
  const current = await session(context, context.state.worktreeSessionId);
  const workspace = await context.rpc("workspaces.get", { workspaceId: current.workspaceId });
  assertWithin(context.scratch, workspace.path, "deletable fake workspace");
  await writeFile(
    join(context.state.project, "preserve.txt"),
    "dirty-non-overlapping-owner-file\n",
  );
  const branch = await command("git", ["rev-parse", "HEAD"], workspace.path);
  const sentinel = join(context.scratch, `junction-sentinel-${randomUUID()}`);
  await mkdir(sentinel);
  await writeFile(join(sentinel, "survive.txt"), "must survive removal\n");
  await symlink(
    sentinel,
    join(workspace.path, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await click(context, "Workspace actions");
  await context.page.getByRole("menuitem", { name: "Mark finished", exact: true }).click();
  await waitUntil(
    async () =>
      (await context.rpc("workspaces.get", { workspaceId: workspace.id })).state === "finished",
    "Mark finished did not change workspace state",
  );
  const finishedShots = await context.capture("06-mark-finished");
  await click(context, "Review changes");
  const reviewDialog = context.page.getByRole("dialog", { name: "Review changes", exact: true });
  await reviewDialog.waitFor();
  const merge = reviewDialog.getByRole("button", { name: /^(Merge into|Birleştir)/ }).last();
  await waitUntil(() => merge.isEnabled(), "Owner merge review was not ready", 45000);
  const screenshots = [...finishedShots, ...(await context.capture("06-owner-review"))];
  await merge.click();
  await waitUntil(
    async () =>
      await command("git", ["merge-base", "--is-ancestor", branch, "HEAD"], context.state.project)
        .then(() => true)
        .catch(() => false),
    "Approved merge did not deliver commit",
  );
  assert.equal(
    await readFile(join(context.state.project, "preserve.txt"), "utf8"),
    "dirty-non-overlapping-owner-file\n",
  );
  await context.page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .last()
    .click();
  const merged = await context.rpc("workspaces.get", { workspaceId: workspace.id });
  assert.equal(merged.state, "merged", "Merged workspace was not finalized");
  await click(context, "Delete directory");
  const removalDialog = context.page.getByRole("dialog", {
    name: "Delete worktree directory",
    exact: true,
  });
  await removalDialog.waitFor();
  await waitUntil(
    () => removalDialog.getByRole("button", { name: "Delete directory", exact: true }).isEnabled(),
    "Directory removal preview was not ready",
    45000,
  );
  screenshots.push(...(await context.capture("06-directory-removal-preview")));
  await context.page
    .getByRole("dialog")
    .getByRole("button", { name: await label(context.page, "Delete directory"), exact: true })
    .click();
  await waitUntil(() => !existsSync(workspace.path), "Directory was not removed quickly", 20000);
  assert.equal(await readFile(join(sentinel, "survive.txt"), "utf8"), "must survive removal\n");
  assert.equal(
    await command("git", ["rev-parse", workspace.branchRef], context.state.project),
    branch,
  );
  screenshots.push(...(await context.capture("06-retained-branch")));
  await dismissVisibleOverlays(context);
  return {
    workspaceId: workspace.id,
    branch: workspace.branchRef,
    branchHead: branch,
    sentinel,
    screenshots,
  };
}

async function scenario7(context) {
  await prepareProject(context);
  await dismissVisibleOverlays(context);
  await focusNativeWindow(context);
  const screenshots = [];
  await click(context, "Tasks");
  await waitUntil(
    async () =>
      context.page.locator('.task-board-status[data-remote-data-state="ready"]').isVisible(),
    "Task board did not discover the connected development Host",
    45000,
  );
  const taskNames = [];
  for (const explicit of [false, true]) {
    await click(context, "New task");
    const form = context.page.getByRole("form", { name: "New task", exact: true });
    const machine = form.getByRole("button", { name: /^Machine:/ });
    await machine.waitFor();
    if (!/This computer/.test(await machine.innerText())) {
      await machine.click();
      await context.page.getByRole("option", { name: "This computer", exact: true }).click();
    }
    const name = `Acceptance ${context.options.id} ${explicit ? "worktree" : "current"} task ${Date.now()}`;
    taskNames.push(name);
    await form.getByRole("textbox", { name: "Task title", exact: true }).fill(name);
    await form.locator("summary").filter({ hasText: "Working branch and worktree" }).click();
    const mode = form.getByRole("button", { name: "Execution mode: Automatic", exact: true });
    await mode.waitFor();
    if (explicit) {
      await mode.click();
      await context.page.getByRole("option", { name: "Separate worktree", exact: true }).click();
      await form
        .getByRole("button", { name: "Execution mode: Separate worktree", exact: true })
        .waitFor();
    }
    screenshots.push(
      ...(await context.capture(`07-task-${explicit ? "explicit-worktree" : "automatic-current"}`)),
    );
    await form.getByRole("button", { name: "Add to To do", exact: true }).click();
    await form.waitFor({ state: "hidden", timeout: 30000 });
  }
  await click(context, "Automations");
  const automationNames = [];
  for (const explicit of [false, true]) {
    await click(context, "New automation");
    await context.page.getByRole("button").filter({ hasText: "Start from scratch" }).click();
    const nameField = context.page.getByRole("textbox", { name: "Automation name", exact: true });
    const form = nameField.locator("xpath=ancestor::form");
    const name = `Acceptance ${context.options.id} ${explicit ? "worktree" : "current"} automation ${Date.now()}`;
    automationNames.push(name);
    await nameField.fill(name);
    await form
      .getByRole("textbox", { name: "Instructions", exact: true })
      .fill("Reply DONE without editing files.");
    await form.getByRole("switch", { name: "Pause automation", exact: true }).click();
    const mode = form.getByRole("button", { name: "Working copy: Automatic", exact: true });
    await mode.waitFor();
    if (explicit) {
      await mode.click();
      await context.page.getByRole("option", { name: "Fresh worktree", exact: true }).click();
      await form
        .getByRole("button", { name: "Working copy: Fresh worktree", exact: true })
        .waitFor();
    }
    screenshots.push(
      ...(await context.capture(
        `07-automation-${explicit ? "explicit-worktree" : "automatic-current"}`,
      )),
    );
    await form.getByRole("button", { name: "Create", exact: true }).click();
    await waitUntil(
      async () =>
        context.page.evaluate(
          async (name) =>
            (
              await (
                await import("/src/features/automations/model/automations.ts")
              ).listAutomations()
            ).some((entry) => entry.name === name),
          name,
        ),
      "Automation was not persisted",
    );
  }
  const result = await context.page.evaluate(
    async ({ cwd, taskNames, automationNames }) => {
      const tasks = await import("/src/features/tasks/model/taskClient.ts");
      const automations = await import("/src/features/automations/model/automations.ts");
      const machines = await tasks.taskMachines(true);
      const board = await tasks.listBoardTasks(machines);
      const schedules = await automations.listAutomations();
      const { resolveWorkspaceContext, workspaceRequest } =
        await import("/src/features/workspaces/model/workspaceClient.ts");
      const scope = await resolveWorkspaceContext(cwd);
      const policy = await workspaceRequest(
        "projects.workspacePolicy.get",
        { projectId: scope.projectId, environmentId: scope.environmentId },
        { cwd },
      );
      return {
        policy: policy.resolved.policy.defaultMode,
        savedTask: board.find((entry) => entry.title === taskNames[0]),
        savedWorktreeTask: board.find((entry) => entry.title === taskNames[1]),
        savedAutomation: schedules.find((entry) => entry.name === automationNames[0]),
        savedWorktreeAutomation: schedules.find((entry) => entry.name === automationNames[1]),
      };
    },
    { cwd: context.state.project, taskNames, automationNames },
  );
  assert.equal(
    result.policy,
    "current",
    "Automatic execution did not inherit Current checkout policy",
  );
  assert(
    result.savedTask &&
      result.savedWorktreeTask &&
      result.savedAutomation &&
      result.savedWorktreeAutomation,
    "UI did not persist all four entries",
  );
  assert(
    result.savedTask.isolate !== true && !result.savedTask.workspace,
    "Saved default task changed execution mode",
  );
  assert.equal(result.savedWorktreeTask.isolate, true, "Explicit task worktree was lost");
  assert(
    !result.savedAutomation.workspaceMode || result.savedAutomation.workspaceMode === "current",
    "Default automation changed mode",
  );
  assert.equal(result.savedWorktreeAutomation.workspaceMode, "worktree");
  assert.equal(result.savedTask.status, "todo");
  assert.equal(result.savedWorktreeTask.status, "todo");
  assert.equal(result.savedAutomation.enabled, false);
  assert.equal(result.savedWorktreeAutomation.enabled, false);
  return {
    result,
    execution:
      "Drafts persisted through the real isolated Host/native DB; tasks remain todo and automations disabled",
    screenshots,
  };
}

async function scenario8(context) {
  await prepareProject(context);
  const policyState = () =>
    context.page.evaluate(async (cwd) => {
      const { resolveWorkspaceContext, workspaceRequest } =
        await import("/src/features/workspaces/model/workspaceClient.ts");
      const scope = await resolveWorkspaceContext(cwd);
      return {
        scope,
        policy: await workspaceRequest(
          "projects.workspacePolicy.get",
          { projectId: scope.projectId, environmentId: scope.environmentId },
          { cwd },
        ),
      };
    }, context.state.project);
  const restoreCurrent = async () => {
    const { scope, policy } = await policyState();
    if (policy.resolved.policy.defaultMode !== "current")
      await context.rpc("projects.workspacePolicy.update", {
        projectId: scope.projectId,
        environmentId: scope.environmentId,
        expectedRevision: policy.revision,
        idempotencyKey: randomUUID(),
        policy: { ...policy.resolved.policy, defaultMode: "current" },
      });
  };
  await restoreCurrent();
  try {
    await openWorkspaceSettings(context);
    const group = context.page.getByRole("radiogroup", {
      name: await label(context.page, "Default workspace"),
      exact: true,
    });
    const current = group.getByRole("radio", {
      name: await label(context.page, "Current checkout"),
      exact: true,
    });
    assert.equal(
      await current.getAttribute("aria-checked"),
      "true",
      "Default workspace is not Current checkout",
    );
    const screenshots = await context.capture("08-current-policy");
    await group.getByRole("radio", { name: "Worktree", exact: true }).click();
    await click(context, "Save workspace policy");
    await waitUntil(
      async () => (await policyState()).policy.resolved.policy.defaultMode === "worktree",
      "Workspace policy did not save",
    );
    await waitUntil(
      async () =>
        (await (await button(context, "Save workspace policy")).isDisabled()) &&
        (await (await button(context, "Save workspace policy")).getAttribute("aria-busy")) !==
          "true",
      "Workspace policy save control did not settle",
    );
    screenshots.push(...(await context.capture("08-worktree-policy")));
    await closeSettings(context);
    await newSession(context, null);
    await context.page
      .getByRole("button", { name: "Workspace New worktree", exact: true })
      .waitFor({ state: "visible", timeout: 30000 });
    screenshots.push(...(await context.capture("08-new-session-inherits-policy")));
    await openWorkspaceSettings(context);
    await context.page
      .getByRole("radio", { name: await label(context.page, "Current checkout"), exact: true })
      .click();
    await click(context, "Save workspace policy");
    await waitUntil(
      async () => (await policyState()).policy.resolved.policy.defaultMode === "current",
      "Current-checkout policy restoration did not save",
    );
    await closeSettings(context);
    return { screenshots };
  } finally {
    await restoreCurrent();
  }
}

export const acceptanceScenarios = {
  1: scenario1,
  2: scenario2,
  3: scenario3,
  4: scenario4,
  5: scenario5,
  6: scenario6,
  7: scenario7,
  8: scenario8,
};

export async function runAcceptance(args = process.argv.slice(2)) {
  const options = acceptanceOptions(args);
  if (!options.run)
    throw new Error(
      "Start pnpm dev:native --acceptance-controls, then pass its --run <dev-run.json>. No installed-app attachment is supported.",
    );
  const context = await connectAcceptance(ROOT, options);
  const report = {
    schemaVersion: 1,
    evidence: "isolated-native-real-codex",
    id: options.id,
    build: context.identity,
    runId: context.run.runId,
    startedAt: new Date().toISOString(),
    scenarios: [],
  };
  try {
    if (options.action) {
      assertWithin(ROOT, resolve(options.action), "custom acceptance action");
      const action = await import(pathToFileURL(resolve(options.action)).href);
      const result = await action.default(context);
      console.log(JSON.stringify(result ?? null, null, 2));
      return result;
    }
    const statePath = join(context.output, "acceptance-state.json");
    context.state = await readFile(statePath, "utf8")
      .then(JSON.parse)
      .catch(() => ({}));
    for (const number of options.scenarios) {
      context.currentScenario = number;
      console.log(`Scenario ${number}: ${titles[number]}`);
      context.steps = [];
      const started = Date.now();
      const row = {
        scenario: number,
        title: titles[number],
        expected: titles[number],
        steps: context.steps,
      };
      try {
        await dismissHarnessUpdateNotice(context);
        row.actual = await acceptanceScenarios[number](context);
        row.status = "pass";
      } catch (error) {
        row.status = "fail";
        row.error = error.stack ?? String(error);
        row.screenshots = context.stageTimedOut
          ? []
          : await context.capture(`${String(number).padStart(2, "0")}-failure`).catch(() => []);
        if (context.stageTimedOut)
          row.diagnostics = {
            stage: context.lastStageFailure,
            file: join(context.output, "native-stage.json"),
            timeline: join(context.output, "native-stages.jsonl"),
          };
        console.error(row.error);
      }
      row.durationMs = Date.now() - started;
      report.scenarios.push(row);
      await writeFile(statePath, `${JSON.stringify(context.state, null, 2)}\n`);
      await writeFile(
        join(context.output, `scenario-${number}.json`),
        `${JSON.stringify(row, null, 2)}\n`,
      );
      await writeFile(
        join(context.output, "acceptance.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      if (row.status !== "pass") break;
    }
    report.completedAt = new Date().toISOString();
    report.passed = report.scenarios.filter((entry) => entry.status === "pass").length;
    report.failed = report.scenarios.filter((entry) => entry.status === "fail").length;
    await writeFile(
      join(context.output, "acceptance.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(
      `Native acceptance: ${report.passed} passed, ${report.failed} failed. Evidence: ${context.output}`,
    );
    if (report.failed || report.scenarios.length !== options.scenarios.length) process.exitCode = 1;
    return report;
  } finally {
    await disconnectAcceptance(context.browser);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes("--help"))
    console.log(
      "pnpm acceptance:native --run <isolated dev-run.json> [--id q1] [--scenario all|1,2,...] [--model GPT-6-Luna] [--switch-model GPT-6.1-Sol] [--turn-timeout 240000]\nRequires pnpm dev:native --acceptance-controls. Real Codex, fake repositories, isolated native identity only. Screenshots and JSON evidence: temp/verification/<id>/. Stops on first failure; rerun a scenario with the same id after fixing it.",
    );
  else
    runAcceptance()
      .catch((error) => {
        console.error(error.stack ?? error);
        process.exitCode = 1;
      })
      .finally(() => {
        if (stageTimeoutOccurred) process.exit(process.exitCode || 1);
      });
}
