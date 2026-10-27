#!/usr/bin/env node
/** Real-provider development acceptance. This command never attaches to an installed app. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { readBuildIdentity } from "./build-info.mjs";
import { verifyNativeIdentity } from "./dev-shot.mjs";
import { nativeDevDesktopDataPath } from "../../host/workspace-bootstrap.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
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
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${verified.run.ports.ports.cdp}`,
    { timeout: 15000 },
  );
  try {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((entry) => entry.url().startsWith(verified.run.devUrl));
    assert(page, "The isolated native development page is unavailable");
    await verifyNativeIdentity(page, verified.identity);
    const output = join(root, "temp", "verification", options.id);
    const scratch = join(root, "temp", "local", options.id);
    await Promise.all([mkdir(output, { recursive: true }), mkdir(scratch, { recursive: true })]);
    await Promise.all(
      [output, scratch].map((path) =>
        writeFile(
          join(path, "README.md"),
          "Isolated real Codex/native acceptance. Generated by scripts/build/acceptance-native.mjs. Contains only fake repositories and development evidence; never installed or release acceptance.\n",
        ),
      ),
    );
    const context = {
      root,
      options,
      ...verified,
      browser,
      page,
      output,
      scratch,
      state: {},
      steps: [],
    };
    context.step = async (text, work) => {
      console.log(text);
      const result = await work();
      context.steps.push({ step: text, actual: result ?? "completed" });
      return result;
    };
    context.capture = (name) => captureMatrix(context, name);
    context.rpc = (method, params, cwd = context.state.project) =>
      context.page.evaluate(
        async ({ method, params, cwd }) => {
          const { workspaceRequest } =
            await import("/src/features/workspaces/model/workspaceClient.ts");
          return workspaceRequest(method, params, { cwd });
        },
        { method, params, cwd },
      );
    return context;
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function captureMatrix(context, name) {
  const { page, output } = context;
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
    if (previous) await page.setViewportSize(previous);
  }
  return captures;
}

/** Query-backed screens intentionally pause while the native window is unfocused. */
export async function focusNativeWindow(context) {
  await context.page.bringToFront();
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
  await (await button(context, text)).click();
  context.steps.push({ step: `Activate ${text}`, actual: "Control activated" });
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
async function waitUntil(check, message, timeout = 30000) {
  let last;
  for (const deadline = Date.now() + timeout; Date.now() < deadline; await sleep(200)) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      last = error;
    }
  }
  throw new Error(`${message}${last ? `: ${last.message}` : ""}`);
}

export async function prepareProject(context) {
  if (context.preparedProject && context.state.project) return context.state.project;
  const project =
    context.state.project ??
    join(
      context.scratch,
      `provider-repo-${context.run.runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40)}`,
    );
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
  await context.page.evaluate(async (cwd) => {
    const recents = await import("/src/features/projects/model/recents.ts");
    recents.rememberProject(cwd);
    recents.notifyProjectPathsChanged();
  }, project);
  await closeRecoveredSessions(context);
  const projectButton = context.page
    .getByRole("button", { name: basename(project), exact: true })
    .first();
  if (!(await projectButton.isVisible())) {
    await projectButton.waitFor({ state: "visible", timeout: 5000 }).catch(async () => {
      await context.page.reload({ waitUntil: "domcontentloaded" });
      await closeRecoveredSessions(context);
    });
  }
  await projectButton.click();
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
  await page
    .getByRole("button", { name: /^(Claude Code|Cursor|Codex|OpenCode|Pi|OMP|Grok) / })
    .first()
    .click();
  await page
    .getByRole("menuitem", { name: /^Model|^Model seç/ })
    .first()
    .click();
  await page.getByRole("tab", { name: "Codex", exact: true }).click();
  const choice = page.getByRole("option").filter({ hasText: model }).first();
  await choice.click();
  await page.keyboard.press("Escape");
  const supervised = page.getByRole("button", { name: "Supervised", exact: true });
  if (await supervised.isVisible()) {
    await supervised.click();
    await page.getByText("Full access", { exact: true }).click();
  }
}

export async function newSession(context, mode = "current", model = context.options.model) {
  await prepareProject(context);
  await closeRecoveredSessions(context);
  await context.page.keyboard.press("Escape");
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
    await context.page.keyboard.press("Escape").catch(() => {});
    throw error;
  }
}

export async function sendPrompt(context, prompt, { allowFailure = false, wait = true } = {}) {
  const { page } = context;
  const prior = new Set(
    (await getSessions(page)).flatMap((entry) =>
      entry.blocks.filter((block) => block.role === "user").map((block) => block.id),
    ),
  );
  await page.locator("textarea:visible").first().fill(prompt);
  await click(context, "Send");
  const accepted = await waitUntil(
    async () =>
      (await getSessions(page)).find((entry) =>
        entry.blocks.some(
          (block) => block.role === "user" && block.text === prompt && !prior.has(block.id),
        ),
      ),
    "Send was not accepted",
  );
  context.state.sessionId = accepted.id;
  if (!wait) return accepted;
  const settled = await waitUntil(
    async () => {
      const current = (await getSessions(page)).find((entry) => entry.id === accepted.id);
      return current &&
        !current.busy &&
        current.blocks.some(
          (block) =>
            !accepted.blocks.some((previous) => previous.id === block.id) ||
            accepted.blocks.find((previous) => previous.id === block.id)?.text !== block.text,
        )
        ? current
        : false;
    },
    "Codex native turn did not settle",
    context.options.timeout,
  );
  assert.equal(settled.harness, "codex", "Acceptance must run real Codex");
  const last = settled.blocks.slice(
    settled.blocks.findLastIndex((block) => block.role === "user" && block.text === prompt) + 1,
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

async function scenario3(context) {
  await newSession(context, "worktree");
  await commitTurn(context, 1, "recovery");
  let current = await session(context);
  const machine = await context.page.evaluate(async () =>
    window.__TAURI_INTERNALS__.invoke("local_host_connect"),
  );
  const rpc = (method, params) =>
    context.page.evaluate(
      async ({ machineId, method, params }) =>
        (await import("/src/features/connections/model/connections.ts")).remoteRequest(
          machineId,
          method,
          params,
          false,
          true,
        ),
      { machineId: machine.id, method, params },
    );
  const activity = await rpc("workspaces.activities.start", {
    workspaceId: current.workspaceId,
    kind: "editor",
    dirtyBuffer: true,
  });
  const { DatabaseSync } = await import("node:sqlite");
  const databasePath = join(context.run.desktopDataPath, "bycoda.db");
  assert(existsSync(databasePath), "Isolated desktop database was not found");
  let rejectedRequest;
  try {
    const rejected = await context.page.evaluate(async (id) => {
      const store = await import("/src/features/sessions/model/sessionsStore.ts");
      const { upsertSession } = await import("/src/features/sessions/data/sessionStore.ts");
      const { desktopInstanceId } =
        await import("/src/features/connections/model/desktopInstance.ts");
      const original = store.sessionsRef.current.find((entry) => entry.id === id);
      const user = {
        id: crypto.randomUUID(),
        role: "user",
        text: "Isolated rejected native admission",
        startedAt: Date.now(),
      };
      const next = { ...original, blocks: [...original.blocks, user] };
      if (!(await upsertSession(next))) throw new Error("Rejected-boundary setup was not saved");
      store.setSessions((entries) => entries.map((entry) => (entry.id === id ? next : entry)));
      try {
        await window.__TAURI_INTERNALS__.invoke("managed_turn_begin", {
          sessionId: id,
          userBlockId: user.id,
          runId: crypto.randomUUID(),
          clientId: desktopInstanceId(),
        });
        return { error: null };
      } catch (error) {
        return { error: String(error), userBlockId: user.id };
      }
    }, current.id);
    assert(rejected.error, "Foreign editor activity did not reject native begin");
    context.steps.push({
      step: "Attempt native begin with a foreign dirty editor",
      actual: rejected.error,
    });
    const database = new DatabaseSync(databasePath);
    try {
      rejectedRequest = database
        .prepare("SELECT request_json FROM native_managed_turns WHERE session_id=?")
        .get(current.id)?.request_json;
    } finally {
      database.close();
    }
    await context.capture("03-rejected-begin");
  } finally {
    await rpc("workspaces.activities.stop", {
      workspaceId: current.workspaceId,
      activityId: activity.id,
    });
  }
  await sendPrompt(context, "Reply RECOVERED without editing files.");
  // Stop the isolated Host before admission, then restart it. This retains the desktop's exact pending row.
  await controlNative(context, "stop-host");
  await sendPrompt(context, "Reply AFTERHOSTRESTART without editing files.", {
    allowFailure: true,
  });
  await controlNative(context, "start-host");
  await context.page.evaluate(async () =>
    (
      await import("/src/features/automations/model/machineSnapshot.ts")
    ).invalidateMachineSnapshot(),
  );
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
    "Wait 20 seconds using the terminal, then reply RESTARTTEST. Do not edit any files.",
    { wait: false },
  );
  await controlNative(context, "restart-app");
  await context.browser.close();
  const replacement = await waitUntil(
    () => connectAcceptance(context.root, context.options),
    "Restarted native app CDP did not become ready",
    60000,
  );
  context.browser = replacement.browser;
  context.page = replacement.page;
  context.preparedProject = false;
  await closeRecoveredSessions(context);
  await waitUntil(
    async () =>
      (await getSessions(context.page)).find((entry) => entry.id === current.id && !entry.busy),
    "Restarted session did not settle",
    90000,
  );
  const reset = await button(context, "Reset stuck turn");
  if (await reset.isVisible()) await reset.click();
  await sendPrompt(context, "Reply APPRECOVERED without editing files.");
  return { sessionId: current.id, screenshots: await context.capture("03-after-recovery") };
}

async function scenario4(context) {
  await newSession(context, "current");
  await sendPrompt(
    context,
    "Remember this isolated test: Türkiye, İstanbul, çalışma alanı. Reply READY without editing.",
  );
  const initialModel = (await session(context)).model;
  await selectCodex(context, context.options.switchModel);
  const prompt =
    "Bu yalıtılmış kabul denemesidir. Dosyaları değiştirme. Yalnızca TAMAM yaz.\n" +
    "Türkiye İstanbul çalışma alanı, geçmiş konuşma ve güvenli model değişimi. ".repeat(400);
  assert(Buffer.byteLength(prompt, "utf8") > 20480);
  const switched = await sendPrompt(context, prompt);
  const replyBoundary = switched.blocks.findLastIndex(
    (block) => block.role === "user" && block.text === prompt,
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
    const boundary = completed.blocks.findLastIndex(
      (block) => block.role === "user" && block.text === capacityPrompt,
    );
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
      archive.messages.some((entry) => entry.text === prompt),
      "Earlier Turkish request was not preserved in saved history",
    );
    assert(
      !archive.messages.some((entry) => entry.text === capacityPrompt),
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
    await writeFile(path, JSON.stringify({ disabled: ["workspaces.managed.v1"] }));
    await reconnect();
    await newSession(context, "current");
    await sendPrompt(context, "Reply OLDHOSTCURRENT without editing files.");
    await newSession(context, "worktree");
    await context.page
      .locator("textarea:visible")
      .first()
      .fill("Reply NEVEREXECUTE without editing files.");
    await click(context, "Send");
    const useCurrent = await button(context, "Use current checkout");
    await useCurrent.waitFor({ timeout: 30000 });
    const screenshots = await context.capture("05-host-update-pending");
    await useCurrent.click();
    await sendPrompt(context, "Reply EXPLICITCURRENT without editing files.");
    await writeFile(path, JSON.stringify({ disabled: [] }));
    await reconnect();
    await newSession(context, "worktree");
    await commitTurn(context, 1, "reconnected");
    assert(
      !(await (await button(context, "Use current checkout")).isVisible()),
      "Pending Host update did not clear",
    );
    screenshots.push(...(await context.capture("05-capability-returned")));
    return { screenshots };
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
  await newSession(context, "worktree");
  await commitTurn(context, 1, "lifecycle");
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
  const screenshots = [...finishedShots, ...(await context.capture("06-owner-review"))];
  const merge = context.page.getByRole("button", { name: /^(Merge into|Birleştir)/ }).last();
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
    .click();
  const merged = await context.rpc("workspaces.get", { workspaceId: workspace.id });
  assert.equal(merged.state, "merged", "Merged workspace was not finalized");
  await click(context, "Delete directory");
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
  await context.page.keyboard.press("Escape");
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
  await context.page.keyboard.press("Escape");
  await focusNativeWindow(context);
  const screenshots = [];
  await click(context, "Tasks");
  await waitUntil(
    async () => context.page.locator('[data-remote-data-state="ready"]').count() > 0,
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
        (await button(context, "Save workspace policy")).isDisabled() &&
        (await (await button(context, "Save workspace policy")).getAttribute("aria-busy")) !==
          "true",
      "Workspace policy save control did not settle",
    );
    screenshots.push(...(await context.capture("08-worktree-policy")));
    await context.page.keyboard.press("Escape");
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
    await context.page.keyboard.press("Escape");
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
        row.actual = await acceptanceScenarios[number](context);
        row.status = "pass";
      } catch (error) {
        row.status = "fail";
        row.error = error.stack ?? String(error);
        row.screenshots = await context
          .capture(`${String(number).padStart(2, "0")}-failure`)
          .catch(() => []);
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
    await context.browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.includes("--help"))
    console.log(
      "pnpm acceptance:native --run <isolated dev-run.json> [--id q1] [--scenario all|1,2,...] [--model GPT-6-Luna] [--switch-model GPT-6.1-Sol] [--turn-timeout 240000]\nRequires pnpm dev:native --acceptance-controls. Real Codex, fake repositories, isolated native identity only. Screenshots and JSON evidence: temp/verification/<id>/. Stops on first failure; rerun a scenario with the same id after fixing it.",
    );
  else
    runAcceptance().catch((error) => {
      console.error(error.stack ?? error);
      process.exitCode = 1;
    });
}
