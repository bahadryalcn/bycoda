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
      page.evaluate(
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
        const path = join(output, `${name}-${width}-${theme}.png`);
        await page.screenshot({ path, animations: "disabled" });
        captures.push(path);
      }
  } finally {
    if (previous) await page.setViewportSize(previous);
  }
  return captures;
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
  return (await button(context, text)).click();
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
  if (context.state.project) return context.state.project;
  const project = join(
    context.scratch,
    `provider-repo-${context.run.runId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40)}`,
  );
  if (!existsSync(project)) {
    await mkdir(project, { recursive: true });
    await command("git", ["init", "-b", "acceptance-target"], project);
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
  await context.page.reload({ waitUntil: "domcontentloaded" });
  await context.page
    .getByRole("button", { name: basename(project), exact: true })
    .first()
    .click();
  await context.page.evaluate(async (cwd) => {
    await (
      await import("/src/features/workspaces/model/workspaceClient.ts")
    ).getWorkspaceCapabilities({ cwd });
  }, project);
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
  await click(context, "New session");
  if (mode) {
    const trigger = context.page
      .getByRole("button", { name: /^Workspace (Current checkout|New worktree)$/ })
      .first();
    await trigger.click();
    await context.page
      .getByRole("button", {
        name: await label(context.page, mode === "worktree" ? "New worktree" : "Current checkout"),
        exact: true,
      })
      .last()
      .click();
  }
  await selectCodex(context, model);
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
          (block.role === "system" && /could not start|recovery blocked/i.test(block.text)),
      ),
      "Native turn failed",
    );
  }
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
  screenshots.push(...(await context.capture("02-rewind-preview")));
  await context.page
    .getByRole("dialog")
    .getByRole("button", {
      name: await label(context.page, "Rewind conversation and files"),
      exact: true,
    })
    .click();
  await waitUntil(
    async () => (await command("git", ["rev-parse", "HEAD"], third.cwd)) === turns[1].head,
    "Rewind did not restore second commit",
  );
  assert.equal((await readFile(join(third.cwd, "counter.txt"), "utf8")).trim(), "2");
  await click(context, "Undo rewind");
  screenshots.push(...(await context.capture("02-undo-preview")));
  await context.page
    .getByRole("dialog")
    .getByRole("button", { name: await label(context.page, "Undo rewind"), exact: true })
    .click();
  await waitUntil(
    async () => (await command("git", ["rev-parse", "HEAD"], third.cwd)) === third.head,
    "Undo did not restore third commit",
  );
  assert.equal(await readFile(join(third.cwd, "counter.txt"), "utf8"), bytes);
  assert.deepEqual(
    (await session(context)).blocks.map(({ id, role, text }) => ({ id, role, text })),
    before.blocks.map(({ id, role, text }) => ({ id, role, text })),
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
    await sendPrompt(
      context,
      "Isolated rejected admission. Reply RECOVERY without editing files.",
      { allowFailure: true },
    );
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
    database
      .prepare("UPDATE native_managed_turns SET request_json=?,phase='starting' WHERE session_id=?")
      .run(rejectedRequest, current.id);
  } finally {
    database.close();
  }
  await context.page.reload({ waitUntil: "domcontentloaded" });
  await sendPrompt(context, "Reply LEGACYRECOVERED without editing files.");
  await sendPrompt(
    context,
    "Wait 20 seconds using the terminal, then reply RESTARTTEST. Do not edit any files.",
    { wait: false },
  );
  await controlNative(context, "restart-app");
  await context.browser.close();
  const replacement = await connectAcceptance(context.root, context.options);
  context.browser = replacement.browser;
  context.page = replacement.page;
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
  await selectCodex(context, context.options.switchModel);
  const prompt =
    "Bu yalıtılmış kabul denemesidir. Dosyaları değiştirme. Yalnızca TAMAM yaz.\n" +
    "Türkiye İstanbul çalışma alanı, geçmiş konuşma ve güvenli model değişimi. ".repeat(400);
  assert(Buffer.byteLength(prompt, "utf8") > 20480);
  const switched = await sendPrompt(context, prompt);
  assert(
    switched.blocks.some((block) => /TAMAM/.test(block.text)),
    "Switched Codex model did not answer",
  );
  return {
    bytes: Buffer.byteLength(prompt, "utf8"),
    model: switched.model,
    screenshots: await context.capture("04-long-turkish-switch"),
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
  const sourceControl = await button(context, "Source control");
  if (await sourceControl.isVisible()) await sourceControl.click();
  else {
    await click(context, "Workspace");
    await click(context, "Source control");
  }
}

async function scenario6(context) {
  if (!context.state.worktreeSessionId) {
    await newSession(context, "worktree");
    await commitTurn(context, 1, "lifecycle");
    context.state.worktreeSessionId = context.state.sessionId;
  }
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
  await click(context, "Review changes");
  const screenshots = await context.capture("06-owner-review");
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
  const result = await context.page.evaluate(
    async ({ cwd, model }) => {
      const tasks = await import("/src/features/tasks/model/taskClient.ts");
      const automations = await import("/src/features/automations/model/automations.ts");
      const defaultTask = tasks.newTaskDraft(cwd, "codex", model);
      const defaultAutomation = automations.newAutomationDraft(cwd, "codex", model);
      const machines = await tasks.taskMachines(true);
      const savedTask = await tasks.saveTask(
        machines,
        {
          ...defaultTask,
          title: "Isolated current default",
          prompt: "Reply DONE without editing.",
          continueUntilDone: false,
        },
        "todo",
      );
      const savedWorktreeTask = await tasks.saveTask(
        machines,
        {
          ...defaultTask,
          title: "Isolated explicit worktree",
          prompt: "Reply DONE without editing.",
          continueUntilDone: false,
          isolate: true,
          workspace: { baseBranch: "acceptance-target" },
        },
        "todo",
      );
      const savedAutomation = await automations.saveAutomation({
        ...defaultAutomation,
        name: "Isolated current default",
        prompt: "Reply DONE without editing.",
        enabled: false,
      });
      const savedWorktreeAutomation = await automations.saveAutomation({
        ...defaultAutomation,
        name: "Isolated explicit worktree",
        prompt: "Reply DONE without editing.",
        enabled: false,
        workspaceMode: "worktree",
      });
      return {
        defaultTask,
        defaultAutomation,
        savedTask,
        savedWorktreeTask,
        savedAutomation,
        savedWorktreeAutomation,
      };
    },
    { cwd: context.state.project, model: context.options.model },
  );
  assert(
    !result.defaultTask.workspace && result.defaultTask.isolate !== true,
    "New task defaults to worktree",
  );
  assert(
    !result.defaultAutomation.workspaceMode || result.defaultAutomation.workspaceMode === "current",
    "New automation defaults to worktree",
  );
  assert(
    result.savedTask.isolate !== true && !result.savedTask.workspace,
    "Saved default task changed execution mode",
  );
  assert(result.savedWorktreeTask.workspace, "Explicit task worktree was lost");
  assert.equal(result.savedWorktreeAutomation.workspaceMode, "worktree");
  return {
    result,
    execution:
      "Drafts persisted through the real isolated Host/native DB; tasks remain todo and automations disabled",
    screenshots: await context.capture("07-defaults-persisted"),
  };
}

async function scenario8(context) {
  await prepareProject(context);
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
  screenshots.push(...(await context.capture("08-worktree-policy")));
  await context.page.keyboard.press("Escape");
  await newSession(context, null);
  assert(
    await context.page
      .getByRole("button", { name: "Workspace New worktree", exact: true })
      .isVisible(),
    "New session ignored saved Worktree policy",
  );
  screenshots.push(...(await context.capture("08-new-session-inherits-policy")));
  await openWorkspaceSettings(context);
  await context.page
    .getByRole("radio", { name: await label(context.page, "Current checkout"), exact: true })
    .click();
  await click(context, "Save workspace policy");
  await context.page.keyboard.press("Escape");
  return { screenshots };
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
        expected: "All assertions pass with a real isolated native app and Codex",
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
