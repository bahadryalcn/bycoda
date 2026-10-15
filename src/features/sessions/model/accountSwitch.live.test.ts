/**
 * LIVE end-to-end check of account switching with the real Claude Code and
 * Codex CLIs and the user's real accounts. Never runs in a normal `vitest run`.
 *
 *   BYCODA_LIVE_E2E=1 pnpm exec vitest run src/features/sessions/model/accountSwitch.live.test.ts
 *
 * Optional overrides: BYCODA_E2E_CLAUDE_A (default "default"),
 * BYCODA_E2E_CLAUDE_B (account-b8bcbf60-...), BYCODA_E2E_CLAUDE_MODEL
 * ("claude:haiku-4.5"), BYCODA_E2E_CODEX_MODEL, BYCODA_E2E_CODEX_EFFORT ("low"),
 * BYCODA_E2E_APPDATA_DIR (the com.bycoda.desktop data directory).
 * BYCODA_E2E_REAL_LIMIT=1 when account A is really at its usage limit: step 2
 * must then come back limited from the provider instead of simulating it.
 *
 * Credential files are never read, printed or copied by this test; the only
 * files it copies are conversation transcripts, exactly like
 * src-tauri/src/session_transfer.rs.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";

const LIVE = !!process.env.BYCODA_LIVE_E2E;

type SpawnRecord = {
  provider: string;
  accountId: string;
  command: string;
  args: string[];
  configDir?: string;
  secureConfigDir?: string;
  codexHome?: string;
  cwd: string;
};

// Shared with the hoisted child mock below.
const live = vi.hoisted(() => ({
  spawns: [] as SpawnRecord[],
  children: new Map<string, { kill: () => void }>(),
  invoked: [] as string[],
  stderr: new Map<string, string>(),
  appdata: "",
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: async (command: string) => {
    live.invoked.push(command);
    return null;
  },
}));

vi.mock("../../../integrations/harness/core/child", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const cp = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");

  type Line = (line: string) => void;
  type Exit = (code?: number | null, reason?: string) => void;
  const lineHandlers = new Map<string, Line>();
  const exitHandlers = new Map<string, Exit>();
  const stderrHandlers = new Map<string, Line>();
  const stdins = new Map<string, NodeJS.WritableStream>();
  const pids = new Map<string, number>();

  const where = (name: string): string[] => {
    try {
      return cp
        .execFileSync("where", [name], { encoding: "utf8", windowsHide: true })
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  };

  const claudeBinary = async () => {
    const hit = where("claude.exe")[0] ?? where("claude")[0];
    if (!hit) throw new Error("claude CLI not found on PATH");
    return { path: hit };
  };

  const codexBinary = async () => {
    const shims = where("codex");
    for (const shim of shims) {
      for (const sub of ["bin", "codex"]) {
        const exe = path.join(
          path.dirname(shim),
          "node_modules",
          "@openai",
          "codex",
          "node_modules",
          "@openai",
          "codex-win32-x64",
          "vendor",
          "x86_64-pc-windows-msvc",
          sub,
          "codex.exe",
        );
        if (fs.existsSync(exe)) return { path: exe };
      }
    }
    const exe = where("codex.exe")[0];
    if (exe) return { path: exe };
    const cmd = shims.find((s) => /\.cmd$/i.test(s));
    if (cmd) return { path: cmd };
    throw new Error("codex CLI not found on PATH");
  };

  /** Same environment rules as apply_provider_account in src-tauri/src/harness.rs. */
  const childEnv = (
    provider: string,
    accountId: string,
  ): { env: NodeJS.ProcessEnv; dir?: string } => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const dir =
      accountId === "default"
        ? undefined
        : path.join(live.appdata, "provider-accounts", provider, accountId);
    if (provider === "claude") {
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
      delete env.CLAUDE_CODE_OAUTH_TOKEN;
      delete env.CLAUDE_CONFIG_DIR;
      delete env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
      if (dir) {
        env.CLAUDE_CONFIG_DIR = dir;
        env.CLAUDE_SECURESTORAGE_CONFIG_DIR = dir;
      }
    } else if (provider === "codex") {
      delete env.OPENAI_API_KEY;
      delete env.CODEX_API_KEY;
      delete env.CODEX_ACCESS_TOKEN;
      delete env.CODEX_HOME;
      if (dir) env.CODEX_HOME = dir;
    }
    return { env, dir };
  };

  const killTree = (pid: number | undefined) => {
    if (!pid) return;
    try {
      cp.execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // already gone
    }
  };

  return {
    ...actual,
    resolveClaudeBinary: claudeBinary,
    resolveCodexBinary: codexBinary,
    watchChild: (id: string, line: Line, exit: Exit, stderr?: Line) => {
      lineHandlers.set(id, line);
      exitHandlers.set(id, exit);
      if (stderr) stderrHandlers.set(id, stderr);
    },
    unwatchChild: (id: string) => {
      lineHandlers.delete(id);
      exitHandlers.delete(id);
      stderrHandlers.delete(id);
    },
    spawnChild: async (
      id: string,
      command: string,
      args: string[],
      cwd: string,
      account?: { provider: "claude" | "codex"; id: string },
    ) => {
      const provider = account?.provider ?? "claude";
      const accountId = account?.id ?? "default";
      const { env, dir } = childEnv(provider, accountId);
      live.spawns.push({
        provider,
        accountId,
        command,
        args,
        cwd,
        configDir: env.CLAUDE_CONFIG_DIR,
        secureConfigDir: env.CLAUDE_SECURESTORAGE_CONFIG_DIR,
        codexHome: env.CODEX_HOME,
      });
      if (dir && !fs.existsSync(dir)) {
        throw new Error(`Account directory is missing: ${dir}`);
      }
      const child = cp.spawn(command, args, {
        cwd,
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        shell: /\.(cmd|bat)$/i.test(command),
      });
      stdins.set(id, child.stdin);
      if (child.pid) pids.set(id, child.pid);
      live.children.set(id, { kill: () => killTree(child.pid) });
      child.stdin.on("error", () => undefined);
      let buffered = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffered += chunk;
        let at: number;
        while ((at = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, at).replace(/\r$/, "");
          buffered = buffered.slice(at + 1);
          if (line) lineHandlers.get(id)?.(line);
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        live.stderr.set(id, ((live.stderr.get(id) ?? "") + chunk).slice(-4000));
        stderrHandlers.get(id)?.(chunk);
      });
      child.on("error", (error) => {
        exitHandlers.get(id)?.(null, error.message);
      });
      child.on("exit", (code) => {
        if (pids.get(id) === child.pid) {
          pids.delete(id);
          stdins.delete(id);
          live.children.delete(id);
        }
        if (buffered) lineHandlers.get(id)?.(buffered);
        buffered = "";
        exitHandlers.get(id)?.(code);
      });
    },
    writeChild: async (id: string, line: string) => {
      const stdin = stdins.get(id);
      if (!stdin) throw new Error("Harness process is not running");
      await new Promise<void>((resolve, reject) => {
        stdin.write(`${line}\n`, (error) => (error ? reject(error) : resolve()));
      });
    },
    killChild: async (id: string) => {
      lineHandlers.delete(id);
      exitHandlers.delete(id);
      stderrHandlers.delete(id);
      killTree(pids.get(id));
      pids.delete(id);
      stdins.delete(id);
      live.children.delete(id);
    },
    killAllChildren: async () => {
      for (const pid of pids.values()) killTree(pid);
      pids.clear();
    },
  };
});

import {
  applyHarnessEvent,
  appendUser,
  stopStreaming,
} from "../../../integrations/harness/core/apply";
import { ensureClaudeRegistered } from "../../../integrations/harness/providers/claude/claudeAdapter";
import { ensureCodexRegistered } from "../../../integrations/harness/providers/codex/codexAdapter";
import {
  bindHarnessSession,
  forgetHarnessSession,
  resetHarnessIdlePark,
  sendHarnessTurn,
} from "../../../integrations/harness/core/registry";
import type { HarnessEvent } from "../../../integrations/harness/core/types";
import { usageLimitFromRateLimitEvent } from "../../../integrations/harness/providers/claude/claudeProtocol";
import {
  providerAccountLabel,
  sessionProviderAccountId,
} from "../../providers/model/providerAccounts";
import { switchSessionAccount, type AccountSwitchDeps } from "./accountSwitch";
import {
  appendPreparingHandoff,
  chooseHandoffBrief,
  completeHandoff,
  consumeHandoff,
  isPreparingHandoff,
  pendingHandoff,
  planComposerSwitch,
  withHarnessChoice,
  wrapHandoffPrompt,
} from "./handoff";
import { newSession, sessionWorkCwd, type Session } from "./session";

// ---------------------------------------------------------------------------
// Node port of src-tauri/src/session_transfer.rs (same paths, same rules).
// ---------------------------------------------------------------------------

const claudeProjectDir = (configDir: string, cwd: string) =>
  join(configDir, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));

function copyFileIfNewer(src: string, dst: string): void {
  if (existsSync(dst)) {
    const s = statSync(src);
    const d = statSync(dst);
    if (!(s.mtimeMs > d.mtimeMs) && s.size <= d.size) return;
  }
  mkdirSync(dirname(dst), { recursive: true });
  const tmp = join(dirname(dst), `.transfer-${process.pid}-${Date.now()}.tmp`);
  copyFileSync(src, tmp);
  rmSync(dst, { force: true });
  renameSync(tmp, dst);
}

function copyDirMissingOrNewer(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) copyDirMissingOrNewer(from, to);
    else if (entry.isFile()) copyFileIfNewer(from, to);
  }
}

function findCodexRollout(home: string, id: string): string | undefined {
  const walk = (dir: string): string | undefined => {
    if (!existsSync(dir)) return undefined;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const hit = walk(full);
        if (hit) return hit;
      } else if (entry.name.endsWith(`-${id}.jsonl`)) return full;
    }
    return undefined;
  };
  return walk(join(home, "sessions"));
}

// ---------------------------------------------------------------------------

const APPDATA_DIR =
  process.env.BYCODA_E2E_APPDATA_DIR ??
  join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "com.bycoda.desktop");
live.appdata = APPDATA_DIR;

const CLAUDE_A = process.env.BYCODA_E2E_CLAUDE_A ?? "default";
const CLAUDE_B = process.env.BYCODA_E2E_CLAUDE_B ?? "account-b8bcbf60-3c2a-4db4-92f0-a4216e981354";
const REAL_LIMIT = !!process.env.BYCODA_E2E_REAL_LIMIT;
const CLAUDE_MODEL = process.env.BYCODA_E2E_CLAUDE_MODEL ?? "claude:haiku-4.5";
/** The model the user's Codex is configured for (only the `model` line is read). */
function configuredCodexModel(): string {
  if (process.env.BYCODA_E2E_CODEX_MODEL) return process.env.BYCODA_E2E_CODEX_MODEL;
  try {
    const toml = readFileSync(join(homedir(), ".codex", "config.toml"), "utf8");
    return /^model\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? "";
  } catch {
    return "";
  }
}
const CODEX_EFFORT = process.env.BYCODA_E2E_CODEX_EFFORT ?? "low";

/** Account directory exactly like provider_account_dir / account_home in Rust. */
function accountHome(provider: "claude" | "codex", accountId: string): string {
  if (accountId !== "default") {
    return join(APPDATA_DIR, "provider-accounts", provider, accountId);
  }
  return join(homedir(), provider === "claude" ? ".claude" : ".codex");
}

const nonce = () => Math.random().toString(36).slice(2, 10).toUpperCase();

const lastAssistant = (session: Session): string => {
  for (let i = session.blocks.length - 1; i >= 0; i--) {
    const block = session.blocks[i];
    if (block.role === "assistant" && block.text.trim()) return block.text;
    if (block.role === "user") break;
  }
  return "";
};

const abbreviate = (text: string, max = 280) => text.replace(/\s+/g, " ").trim().slice(0, max);

describe.skipIf(!LIVE)("account switching, live Claude and Codex", () => {
  const root = LIVE ? realpathSync(mkdtempSync(join(tmpdir(), "bycoda-e2e-"))) : "";
  const project = join(root, "project");
  const slug = project.replace(/[^A-Za-z0-9]/g, "-");
  const sessionId = LIVE ? crypto.randomUUID() : "";
  const codexNonce = `CODEX-${nonce()}`;
  const claudeNonce = `CLAUDE-${nonce()}`;
  const transferred: string[] = [];
  const codexThreads = new Set<string>();

  let session: Session;
  const transcript: string[] = [];

  const step = (label: string, detail: string) => {
    transcript.push(`${label}: ${detail}`);
    console.log(`[live-e2e] ${label}: ${detail}`);
  };

  const fold = (event: HarnessEvent, onAfter?: (event: HarnessEvent) => void) => {
    session = applyHarnessEvent(session, event);
    onAfter?.(event);
  };

  /** The App's send path for a turn; `wrap` carries a handoff recap. */
  async function send(text: string, wrap?: { from: "codex" | "claude"; text: string }) {
    const harness = session.harness as "claude" | "codex";
    const accountId = sessionProviderAccountId(harness, session);
    const prompt = wrap ? wrapHandoffPrompt(wrap.text, wrap.from, text, [], session.harness) : text;
    await sendHarnessTurn({
      harness,
      sessionId,
      cwd: sessionWorkCwd(session),
      model: session.model,
      modelSettings: session.modelSettings,
      providerAccountId: accountId,
      runtimeMode: session.runtimeMode,
      text: prompt,
      onEvent: (event) =>
        fold(event, (e) => {
          if (
            wrap &&
            (e.type === "session.started" || e.type === "session.providerBound") &&
            isPreparingHandoff(session)
          ) {
            session = { ...completeHandoff(session, wrap.text), busy: true };
          }
        }),
    });
    if (wrap) session = consumeHandoff(session);
    session = stopStreaming({ ...session, providerAccountId: accountId });
    const errors = session.blocks.filter((b) => b.role === "system" && b.notice === "error");
    if (errors.length) {
      throw new Error(
        `provider error: ${errors.map((b) => b.text).join(" | ")} stderr=${[...live.stderr.values()].join("|")}`,
      );
    }
  }

  const deps: AccountSwitchDeps = {
    transfer: async ({ provider, fromAccountId, toAccountId, providerSessionId, cwd }) => {
      if (fromAccountId === toAccountId) return true;
      const from = accountHome(provider, fromAccountId);
      const to = accountHome(provider, toAccountId);
      if (provider === "claude") {
        const srcProject = claudeProjectDir(from, cwd);
        const srcFile = join(srcProject, `${providerSessionId}.jsonl`);
        if (!existsSync(srcFile)) return false;
        const dstProject = claudeProjectDir(to, cwd);
        copyFileIfNewer(srcFile, join(dstProject, `${providerSessionId}.jsonl`));
        const sidecar = join(srcProject, providerSessionId);
        if (existsSync(sidecar)) {
          copyDirMissingOrNewer(sidecar, join(dstProject, providerSessionId));
        }
        transferred.push(join(dstProject, `${providerSessionId}.jsonl`));
        return true;
      }
      const src = findCodexRollout(from, providerSessionId);
      if (!src) return false;
      const dst = join(to, relative(from, src));
      copyFileIfNewer(src, dst);
      transferred.push(dst);
      return true;
    },
    forget: (provider, id) => forgetHarnessSession(provider, id),
    bind: (provider, id, providerSessionId, cwd, accountId, blocks) =>
      bindHarnessSession(provider, id, providerSessionId, cwd, accountId, blocks),
    latest: () => session,
    label: providerAccountLabel,
  };

  /** Run the switch and apply its result the way App.tsx does. */
  async function pickAccount(provider: "claude" | "codex", accountId: string) {
    const result = await switchSessionAccount(sessionId, provider, accountId, deps);
    if (result.kind === "switched") session = result.update(session);
    return result;
  }

  afterAll(async () => {
    resetHarnessIdlePark();
    for (const child of live.children.values()) child.kill();
    live.children.clear();
    console.log(`[live-e2e] summary\n${transcript.join("\n")}`);
    // Only transcripts created for this temp project, nothing else.
    if (!slug.includes("bycoda-e2e-")) return;
    for (const id of new Set([CLAUDE_A, CLAUDE_B])) {
      const dir = join(accountHome("claude", id), "projects", slug);
      if (basename(dir) === slug && existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    const codexHome = accountHome("codex", "default");
    for (const thread of codexThreads) {
      const rollout = findCodexRollout(codexHome, thread);
      if (rollout) rmSync(rollout, { force: true });
    }
    await new Promise((r) => setTimeout(r, 500));
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it(
    "keeps one conversation across Codex, Claude account A and Claude account B",
    { timeout: 20 * 60_000 },
    async () => {
      ensureClaudeRegistered();
      ensureCodexRegistered();
      mkdirSync(project, { recursive: true });
      execFileSync("git", ["init", "-q"], { cwd: project, windowsHide: true });
      expect(
        existsSync(accountHome("claude", CLAUDE_B)),
        `Claude account directory for ${CLAUDE_B} must exist`,
      ).toBe(true);

      // 1. Codex does real work.
      const codex = newSession("codex", project, process.env.BYCODA_E2E_CODEX_MODEL);
      session = {
        ...codex,
        id: sessionId,
        model: configuredCodexModel(),
        runtimeMode: "full-access",
        modelSettings: { ...codex.modelSettings, reasoningEffort: CODEX_EFFORT },
      };
      const ask1 = `Create the file notes/e2e.txt (make the notes directory if needed) containing exactly ${codexNonce} and nothing else, then reply with just DONE.`;
      session = appendUser(session, ask1);
      await send(ask1);
      const written = join(project, "notes", "e2e.txt");
      expect(existsSync(written), "Codex created notes/e2e.txt").toBe(true);
      expect(readFileSync(written, "utf8").trim()).toBe(codexNonce);
      expect(session.providerSessionId, "codex provider thread").toBeTruthy();
      codexThreads.add(session.providerSessionId!);
      step(
        "1 codex",
        `file ok, thread=${session.providerSessionId}, reply="${abbreviate(lastAssistant(session))}"`,
      );

      // 2. codex -> claude, then choose accounts before sending.
      const plan = planComposerSwitch(session, "claude");
      expect(plan.kind).toBe("arm");
      if (plan.kind !== "arm") return;
      session = {
        ...withHarnessChoice(session, "claude", CLAUDE_MODEL, {}),
        runtimeMode: "full-access",
        pendingSwitch: plan.pending,
      };
      expect(session.providerSessionId).toBeUndefined();
      const spawnsBefore = live.spawns.length;

      const toB = await pickAccount("claude", CLAUDE_B);
      expect(toB.kind === "switched" && toB.mode, "pendingSwitch just sets the account").toBe(
        "account",
      );
      expect(session.providerAccountId).toBe(CLAUDE_B);
      expect(session.pendingSwitch).toBeTruthy();
      const toA = await pickAccount("claude", CLAUDE_A);
      expect(toA.kind === "switched" && toA.mode).toBe("account");
      expect(sessionProviderAccountId("claude", session)).toBe(CLAUDE_A);
      expect(session.pendingSwitch).toBeTruthy();
      expect(transferred).toEqual([]);
      expect(live.spawns.length).toBe(spawnsBefore);
      step("2 pick", `pendingSwitch: B then A set without transfer`);

      const ask2 = `A previous agent created a file in this project. What is the file's path and its exact content? Also remember the codeword ${claudeNonce}. Answer in one or two sentences.`;
      // App: seal, add the preparing divider and the user turn, then the brief.
      session = appendUser(
        appendPreparingHandoff(
          stopStreaming({ ...session, pendingSwitch: undefined }),
          "codex",
          "claude",
        ),
        ask2,
      );
      const brief = chooseHandoffBrief("", session, ask2);
      if (REAL_LIMIT) {
        await send(ask2, { from: "codex", text: brief }).catch(() => undefined);
        expect(
          session.usageLimit,
          "the real provider reported account A's usage limit",
        ).toBeTruthy();
        step(
          "2+3 claude A (really limited)",
          `usageLimit from provider, resetsAt=${session.usageLimit?.resetsAt}, thread=${session.providerSessionId ?? "none"}`,
        );
        const toB = await pickAccount("claude", CLAUDE_B);
        expect(toB.kind).toBe("switched");
        expect(session.usageLimit).toBeUndefined();
        expect(session.providerAccountId).toBe(CLAUDE_B);
        step("4 switch", `mode=${toB.kind === "switched" ? toB.mode : toB.kind}`);
        const recap = pendingHandoff(session);
        const ask4 = `${ask2} (Your previous attempt hit a usage limit; answer now.)`;
        session = appendUser(session, ask4);
        await send(
          ask4,
          recap ? { from: recap.from as "codex" | "claude", text: recap.text } : undefined,
        );
        const reply4 = lastAssistant(session);
        step("4 claude B", `reply="${abbreviate(reply4)}"`);
        expect(reply4).toContain(codexNonce);
        const spawnB = live.spawns.filter((s) => s.provider === "claude").at(-1)!;
        expect(spawnB.accountId).toBe(CLAUDE_B);
        expect(spawnB.configDir).toBe(accountHome("claude", CLAUDE_B));
        expect(session.usageLimit).toBeUndefined();
        return;
      }
      await send(ask2, { from: "codex", text: brief });
      expect(pendingHandoff(session)).toBeNull();
      const reply2 = lastAssistant(session);
      step("2 claude A", `reply="${abbreviate(reply2)}"`);
      expect(reply2).toContain(codexNonce);
      const spawnA = live.spawns.filter((s) => s.provider === "claude").at(-1)!;
      expect(spawnA.accountId).toBe(CLAUDE_A);
      if (CLAUDE_A === "default") {
        expect(spawnA.configDir).toBeUndefined();
        expect(spawnA.secureConfigDir).toBeUndefined();
      } else {
        expect(spawnA.configDir).toBe(accountHome("claude", CLAUDE_A));
      }
      expect(session.providerSessionId, "claude thread").toBeTruthy();
      const claudeThread = session.providerSessionId!;
      expect(spawnA.args).not.toContain("--resume");

      // 3. Account A hits its usage limit (real rate_limit_event format).
      const resetsAt = Math.floor(Date.now() / 1000) + 3600;
      const limited = usageLimitFromRateLimitEvent({
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", resetsAt, isUsingOverage: false },
      });
      expect(limited, "protocol recognises the rejected event").not.toBeNull();
      session = applyHarnessEvent(session, {
        type: "usage.limited",
        ...limited,
      });
      expect(session.usageLimit).toBeTruthy();
      step("3 limit", `usageLimit set (resetsAt=${session.usageLimit?.resetsAt})`);

      // 4. Switch to account B with the real transcript transfer.
      const toB2 = await pickAccount("claude", CLAUDE_B);
      expect(toB2.kind === "switched" && toB2.mode, "transcript transferred").toBe("transferred");
      expect(session.usageLimit).toBeUndefined();
      expect(session.providerSessionId).toBe(claudeThread);
      expect(session.providerAccountId).toBe(CLAUDE_B);
      expect(pendingHandoff(session)).toBeNull();
      expect(
        existsSync(
          join(claudeProjectDir(accountHome("claude", CLAUDE_B), project), `${claudeThread}.jsonl`),
        ),
      ).toBe(true);
      const ask4 =
        "What codeword did I ask you to remember, and what does notes/e2e.txt contain? Answer in one sentence.";
      session = appendUser(session, ask4);
      await send(ask4);
      const reply4 = lastAssistant(session);
      step("4 claude B", `reply="${abbreviate(reply4)}"`);
      expect(reply4).toContain(claudeNonce);
      expect(reply4).toContain(codexNonce);
      const spawnB = live.spawns.filter((s) => s.provider === "claude").at(-1)!;
      expect(spawnB.accountId).toBe(CLAUDE_B);
      expect(spawnB.configDir).toBe(accountHome("claude", CLAUDE_B));
      expect(spawnB.secureConfigDir).toBe(accountHome("claude", CLAUDE_B));
      expect(spawnB.args).toContain("--resume");
      expect(spawnB.args[spawnB.args.indexOf("--resume") + 1]).toBe(claudeThread);
      expect(session.providerSessionId).toBe(claudeThread);

      // 5. And back to A.
      const back = await pickAccount("claude", CLAUDE_A);
      expect(back.kind === "switched" && back.mode).toBe("transferred");
      const ask5 = "Once more: which codeword did I ask you to remember? Answer in one sentence.";
      session = appendUser(session, ask5);
      await send(ask5);
      const reply5 = lastAssistant(session);
      step("5 claude A again", `reply="${abbreviate(reply5)}"`);
      expect(reply5).toContain(claudeNonce);
      const spawnA2 = live.spawns.filter((s) => s.provider === "claude").at(-1)!;
      expect(spawnA2.accountId).toBe(CLAUDE_A);
      expect(spawnA2.args).toContain("--resume");
      expect(spawnA2.args[spawnA2.args.indexOf("--resume") + 1]).toBe(claudeThread);
    },
  );
});
