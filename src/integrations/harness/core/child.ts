import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { configureGeneratedImageStorage } from "./generatedImages";
import { socialBridge, socialSpawnArgs } from "./socialBridge";
import { runtimeLogsBridge, runtimeLogsSpawnArgs } from "./runtimeLogsBridge";
import { conversationToolsBridge, conversationToolsSpawnArgs } from "./conversationToolsBridge";
import {
  runtimeProviderBinaryPath,
  type ConfigurableBinaryProvider,
} from "../../../features/providers/model/providerBinaryPaths";

/** Process I/O is supplied by the desktop or a headless host. Provider
 * protocols never need to know which process owns their children. */
export interface ChildBackend {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<UnlistenFn>;
}

let backend: ChildBackend | undefined;

export function configureChildBackend(next: ChildBackend): void {
  if (bridge || users) throw new Error("Configure the child backend before starting the bridge");
  backend = next;
  configureGeneratedImageStorage({
    save: (input) => next.invoke("harness_save_generated_image", input),
    delete: (paths) => next.invoke("harness_delete_generated_images", { paths }),
  });
}

export function hasHeadlessChildBackend(): boolean {
  return backend !== undefined;
}

/** Provider-owned transcript files are read on the machine running the child. */
export function readHarnessTextFile(path: string): Promise<string> {
  return invoke<string>(backend ? "harness_read_text_file" : "read_text_file", {
    path,
  });
}

/** Bounded task output, read by the machine that owns the provider. */
export function readHarnessTaskOutput(
  path: string,
  taskId: string,
): Promise<{ text: string; truncated: boolean }> {
  return invoke("harness_read_task_output", { path, taskId });
}

/** Private, provider-owned workspace; no project files or global agent settings. */
export function prepareHarnessTextWorkspace(
  content: string,
): Promise<{ cwd: string; logPath: string }> {
  return invoke("harness_prepare_text_workspace", { content });
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return backend ? backend.invoke<T>(command, args) : tauriInvoke<T>(command, args);
}

/** Execute a provider management command on the machine owning its processes. */
export function invokeProviderCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args);
}

let windowLabel: string | null | undefined;

/** A global `listen` registers as target `Any`, which Tauri delivers to even
 * when the backend used `emit_to` another window. Scoping the listener to this
 * window's label still receives broadcasts and targeted events for it, and
 * skips those the backend routed to other windows. */
function currentWindowLabel(): string | null {
  if (windowLabel === undefined) {
    // The same field `getCurrentWindow()` reads; avoids importing the window API.
    const internals = (
      globalThis as {
        __TAURI_INTERNALS__?: {
          metadata?: { currentWindow?: { label?: string } };
        };
      }
    ).__TAURI_INTERNALS__;
    windowLabel = internals?.metadata?.currentWindow?.label || null;
  }
  return windowLabel;
}

function listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<UnlistenFn> {
  if (backend) return backend.listen(event, handler);
  const label = currentWindowLabel();
  return label ? tauriListen(event, handler, { target: label }) : tauriListen(event, handler);
}

type LinePayload = { sessionId: string; line: string };
type LinesPayload = { sessionId: string; lines: string[] };
type SseBatchPayload = { sessionId: string; data: string[] };
type ExitPayload = {
  sessionId: string;
  code: number | null;
  pid?: number;
  reason?: string;
};
type SsePayload = { sessionId: string; data: string };
type SseEndPayload = { sessionId: string; error?: string | null };

type LineHandler = (line: string) => void;
type ExitHandler = (code: number | null, reason?: string) => void;
type SseHandler = (data: string) => void;
type SseEndHandler = (error?: string) => void;

const lineHandlers = new Map<string, LineHandler>();
const exitHandlers = new Map<string, ExitHandler>();
const lineBuffer = new Map<string, Buffered>();
const stderrHandlers = new Map<string, LineHandler>();
const sseHandlers = new Map<string, SseHandler>();
const sseEndHandlers = new Map<string, SseEndHandler>();
const sseBuffer = new Map<string, Buffered>();
// Output may be broadcast to every window (the backend falls back to that when
// it does not know the owner). Only ids this window spawned or opened may
// buffer while unwatched; anything else would be held until the bridge
// is torn down, since nothing here ever watches or unwatches it.
const ownedChildren = new Set<string>();
const ownedSse = new Set<string>();
const livePid = new Map<string, number>();
const pendingExit = new Map<string, Array<{ code: number | null; pid: number; reason?: string }>>();

/** True when this exit belongs to the child we currently have spawned. */
export function isCurrentChildExit(
  expectedPid: number | undefined,
  exitedPid: number | undefined,
): boolean {
  if (expectedPid == null || expectedPid <= 0) return false;
  if (exitedPid == null || exitedPid <= 0) return false;
  return exitedPid === expectedPid;
}

/** Output held for a child nobody watches yet. The byte bound is the real
 * limit; the item bound only keeps many tiny lines from piling up. */
type Buffered = { items: string[]; bytes: number };

const MAX_BUFFERED = 1000;
// UTF-16 code units, which is close enough to bytes for a memory bound.
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
let bridge: Promise<UnlistenFn[]> | null = null;
let bridgeAttempt: symbol | null = null;
let users = 0;
let teardownTimer: ReturnType<typeof setTimeout> | undefined;

/** Drops the oldest items past either bound; the newest item always stays,
 * even when it alone exceeds the byte bound. */
export function pushBounded(
  map: Map<string, Buffered>,
  sessionId: string,
  items: readonly string[],
  maxBytes = MAX_BUFFERED_BYTES,
) {
  const queued = map.get(sessionId) ?? { items: [], bytes: 0 };
  for (const item of items) {
    queued.items.push(item);
    queued.bytes += item.length;
  }
  let drop = Math.max(0, queued.items.length - MAX_BUFFERED);
  let kept = queued.bytes;
  for (let i = 0; i < drop; i += 1) kept -= queued.items[i].length;
  while (kept > maxBytes && drop < queued.items.length - 1) {
    kept -= queued.items[drop].length;
    drop += 1;
  }
  if (drop > 0) {
    queued.items.splice(0, drop);
    queued.bytes = kept;
  }
  map.set(sessionId, queued);
}

// The desktop emits batches; a headless host still emits one line per event.
function deliverStdout(sessionId: string, lines: readonly string[]) {
  const handler = lineHandlers.get(sessionId);
  if (handler) {
    for (const line of lines) handler(line);
    return;
  }
  if (ownedChildren.has(sessionId)) pushBounded(lineBuffer, sessionId, lines);
}

function deliverStderr(sessionId: string, lines: readonly string[]) {
  const handler = stderrHandlers.get(sessionId);
  if (handler) for (const line of lines) handler(line);
}

function deliverSse(sessionId: string, data: readonly string[]) {
  const handler = sseHandlers.get(sessionId);
  if (handler) {
    for (const item of data) handler(item);
    return;
  }
  if (ownedSse.has(sessionId)) pushBounded(sseBuffer, sessionId, data);
}

function ensureBridge() {
  if (bridge) return;
  let failed = false;
  const installed: UnlistenFn[] = [];
  const register = (pending: Promise<UnlistenFn>) =>
    pending.then((unlisten) => {
      if (failed) {
        unlisten();
        return () => undefined;
      }
      installed.push(unlisten);
      return unlisten;
    });
  const attempt = Symbol("bridge-installation");
  bridgeAttempt = attempt;
  const installation = Promise.all([
    register(
      listen<LinesPayload>("harness-stdout-lines", (event) => {
        deliverStdout(event.payload.sessionId, event.payload.lines);
      }),
    ),
    register(
      listen<LinePayload>("harness-stdout", (event) => {
        deliverStdout(event.payload.sessionId, [event.payload.line]);
      }),
    ),
    register(
      listen<LinesPayload>("harness-stderr-lines", (event) => {
        deliverStderr(event.payload.sessionId, event.payload.lines);
      }),
    ),
    register(
      listen<LinePayload>("harness-stderr", (event) => {
        deliverStderr(event.payload.sessionId, [event.payload.line]);
      }),
    ),
    register(
      listen<ExitPayload>("harness-exit", (event) => {
        const { sessionId, code, pid, reason } = event.payload;
        const handler = exitHandlers.get(sessionId);
        if (!handler || pid == null || pid <= 0) return;
        const currentPid = livePid.get(sessionId);
        if (isCurrentChildExit(currentPid, pid)) {
          livePid.delete(sessionId);
          if (reason) handler(code, reason);
          else handler(code);
          return;
        }
        if (currentPid != null) return;
        const exits = pendingExit.get(sessionId) ?? [];
        exits.push({ code, pid, reason });
        if (exits.length > 8) exits.splice(0, exits.length - 8);
        pendingExit.set(sessionId, exits);
      }),
    ),
    register(
      listen<SseBatchPayload>("harness-sse-batch", (event) => {
        deliverSse(event.payload.sessionId, event.payload.data);
      }),
    ),
    register(
      listen<SsePayload>("harness-sse", (event) => {
        deliverSse(event.payload.sessionId, [event.payload.data]);
      }),
    ),
    register(
      listen<SseEndPayload>("harness-sse-end", (event) => {
        const { sessionId, error } = event.payload;
        sseEndHandlers.get(sessionId)?.(error ?? undefined);
      }),
    ),
  ]).catch((error: unknown) => {
    failed = true;
    installed.splice(0).forEach((unlisten) => unlisten());
    if (bridgeAttempt === attempt) {
      bridge = null;
      bridgeAttempt = null;
    }
    throw error;
  });
  void installation.catch(() => undefined);
  bridge = installation;
}

function teardownBridge() {
  const pending = bridge;
  bridge = null;
  bridgeAttempt = null;
  lineHandlers.clear();
  exitHandlers.clear();
  lineBuffer.clear();
  stderrHandlers.clear();
  sseHandlers.clear();
  sseEndHandlers.clear();
  sseBuffer.clear();
  ownedChildren.clear();
  ownedSse.clear();
  livePid.clear();
  pendingExit.clear();
  void pending?.then((fns) => fns.forEach((fn) => fn())).catch(() => undefined);
}

export function startHarnessBridge(): () => void {
  users += 1;
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = undefined;
  }
  ensureBridge();
  return () => {
    users -= 1;
    if (users > 0) return;
    users = 0;
    teardownTimer = setTimeout(() => {
      teardownTimer = undefined;
      if (users === 0) teardownBridge();
    }, 0);
  };
}

export async function acquireHarnessBridge(): Promise<() => void> {
  const release = startHarnessBridge();
  const installation = bridge;
  try {
    await installation;
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    users = 0;
    if (teardownTimer) {
      clearTimeout(teardownTimer);
      teardownTimer = undefined;
    }
    teardownBridge();
  });
}

export function watchChild(
  sessionId: string,
  onLine: LineHandler,
  onExit: ExitHandler,
  onStderr?: LineHandler,
) {
  const queued = lineBuffer.get(sessionId);
  lineBuffer.delete(sessionId);
  lineHandlers.set(sessionId, onLine);
  exitHandlers.set(sessionId, onExit);
  if (onStderr) stderrHandlers.set(sessionId, onStderr);
  if (queued) for (const line of queued.items) onLine(line);
}

export function unwatchChild(sessionId: string) {
  lineHandlers.delete(sessionId);
  exitHandlers.delete(sessionId);
  lineBuffer.delete(sessionId);
  ownedChildren.delete(sessionId);
  stderrHandlers.delete(sessionId);
  pendingExit.delete(sessionId);
}

export function watchSse(sessionId: string, onData: SseHandler, onEnd?: SseEndHandler) {
  const queued = sseBuffer.get(sessionId);
  sseBuffer.delete(sessionId);
  sseHandlers.set(sessionId, onData);
  if (onEnd) sseEndHandlers.set(sessionId, onEnd);
  if (queued) for (const item of queued.items) onData(item);
}

export function unwatchSse(sessionId: string) {
  sseHandlers.delete(sessionId);
  sseEndHandlers.delete(sessionId);
  sseBuffer.delete(sessionId);
  ownedSse.delete(sessionId);
}

export async function spawnChild(
  sessionId: string,
  command: string,
  args: string[],
  cwd: string,
  account?: { provider: "claude" | "codex"; id: string },
  binaryProvider?: ConfigurableBinaryProvider,
  genericAcpId?: string,
): Promise<void> {
  livePid.delete(sessionId);
  pendingExit.delete(sessionId);
  ownedChildren.add(sessionId);
  const binaryPath = binaryProvider ? runtimeProviderBinaryPath(binaryProvider) : undefined;
  let launchArgs = args;
  if (binaryProvider === "claude" || binaryProvider === "codex") {
    const [social, logs, conversation] = await Promise.all([
      socialBridge(sessionId),
      runtimeLogsBridge(sessionId),
      conversationToolsBridge(sessionId),
    ]);
    launchArgs = runtimeLogsSpawnArgs(
      binaryProvider,
      socialSpawnArgs(binaryProvider, args, social),
      logs,
    );
    launchArgs = conversationToolsSpawnArgs(binaryProvider, launchArgs, conversation);
  }
  const pid = await invoke<number>("harness_spawn", {
    sessionId,
    command,
    args: launchArgs,
    cwd,
    account,
    binaryProvider,
    binaryPath,
    genericAcpId,
  });
  if (typeof pid !== "number" || pid <= 0) return;
  livePid.set(sessionId, pid);
  const exits = pendingExit.get(sessionId);
  pendingExit.delete(sessionId);
  const exited = exits?.find((event) => event.pid === pid);
  if (!exited) return;
  livePid.delete(sessionId);
  const handler = exitHandlers.get(sessionId);
  if (exited.reason) handler?.(exited.code, exited.reason);
  else handler?.(exited.code);
}

export function writeChild(sessionId: string, line: string): Promise<void> {
  return invoke("harness_write", { sessionId, line });
}

export function killChild(sessionId: string): Promise<void> {
  livePid.delete(sessionId);
  pendingExit.delete(sessionId);
  unwatchChild(sessionId);
  return invoke("harness_kill", { sessionId });
}

export function killAllChildren(): Promise<void> {
  lineHandlers.clear();
  exitHandlers.clear();
  lineBuffer.clear();
  stderrHandlers.clear();
  sseHandlers.clear();
  sseEndHandlers.clear();
  sseBuffer.clear();
  ownedChildren.clear();
  ownedSse.clear();
  livePid.clear();
  pendingExit.clear();
  return invoke("harness_kill_all");
}

export type AntigravityTransport = "acp" | "stream-json";

type ResolvedHarnessBinary = {
  path: string;
  args?: string[];
  transport?: AntigravityTransport;
};

async function resolveHarnessBinary(
  provider: ConfigurableBinaryProvider,
  binaryPath?: string | null,
): Promise<ResolvedHarnessBinary> {
  const configuredPath =
    binaryPath === undefined ? runtimeProviderBinaryPath(provider) : binaryPath?.trim();
  if (configuredPath) {
    return invoke("harness_resolve_configured", {
      provider,
      binaryPath: configuredPath,
    });
  }
  if (provider === "acp")
    throw new Error("Select a configured ACP agent instead of resolving a provider binary");
  const command: Record<Exclude<ConfigurableBinaryProvider, "acp">, string> = {
    claude: "harness_resolve_claude",
    codex: "harness_resolve_codex",
    cursor: "harness_resolve_cursor",
    grok: "harness_resolve_grok",
    opencode: "harness_resolve_opencode",
    pi: "harness_resolve_pi",
    omp: "harness_resolve_omp",
    fx: "harness_resolve_fx",
    hermes: "harness_resolve_hermes",
    antigravity: "harness_resolve_antigravity",
  };
  return invoke(command[provider]);
}

export function resolveCursorBinary(binaryPath?: string | null): Promise<{ path: string }> {
  return resolveHarnessBinary("cursor", binaryPath);
}

export function resolveCodexBinary(binaryPath?: string | null): Promise<{ path: string }> {
  return resolveHarnessBinary("codex", binaryPath);
}

export function resolveOpenCodeBinary(binaryPath?: string | null): Promise<{ path: string }> {
  return resolveHarnessBinary("opencode", binaryPath);
}

export function resolveClaudeBinary(binaryPath?: string | null): Promise<{ path: string }> {
  return resolveHarnessBinary("claude", binaryPath);
}

export function resolvePiBinary(binaryPath?: string | null): Promise<{ path: string }> {
  return resolveHarnessBinary("pi", binaryPath);
}

export function resolveOmpBinary(binaryPath?: string | null): Promise<{ path: string }> {
  return resolveHarnessBinary("omp", binaryPath);
}

export function resolveFxBinary(binaryPath?: string | null): Promise<{ path: string }> {
  return resolveHarnessBinary("fx", binaryPath);
}

export function resolveGrokBinary(binaryPath?: string | null): Promise<{ path: string }> {
  return resolveHarnessBinary("grok", binaryPath);
}

export function resolveHermesBinary(binaryPath?: string | null): Promise<{ path: string }> {
  return resolveHarnessBinary("hermes", binaryPath);
}

export function resolveAntigravityBinary(binaryPath?: string | null): Promise<{
  path: string;
  args: string[];
  /** Absent means ACP: older hosts never reported it. */
  transport?: AntigravityTransport;
}> {
  return resolveHarnessBinary("antigravity", binaryPath) as Promise<{
    path: string;
    args: string[];
    transport?: AntigravityTransport;
  }>;
}

export function freeHarnessPort(): Promise<number> {
  return invoke("harness_free_port");
}

export function harnessHttp(input: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}): Promise<{ status: number; body: string }> {
  return invoke("harness_http", input);
}

export function openHarnessSse(
  sessionId: string,
  url: string,
  headers?: Record<string, string>,
): Promise<void> {
  ownedSse.add(sessionId);
  return invoke("harness_sse_open", { sessionId, url, headers });
}

export function closeHarnessSse(sessionId: string): Promise<void> {
  unwatchSse(sessionId);
  return invoke("harness_sse_close", { sessionId });
}

export type HarnessBinaryInspection = {
  path: string;
  version?: string;
  error?: string;
};

export function inspectHarnessBinary(
  provider: ConfigurableBinaryProvider,
  binaryPath?: string | null,
): Promise<HarnessBinaryInspection> {
  return resolveHarnessBinary(provider, binaryPath).then(async (resolved) => {
    if (provider === "antigravity") {
      return {
        path: resolved.path,
        version: resolved.transport === "stream-json" ? "agy CLI (stream-json)" : "ACP server",
      };
    }
    try {
      const version = (
        await execChild(resolved.path, ["--version"], undefined, provider, binaryPath)
      ).trim();
      return /\d+\.\d+\.\d+/.test(version)
        ? { path: resolved.path, version }
        : { path: resolved.path, error: "CLI returned no valid version." };
    } catch (error) {
      return {
        path: resolved.path,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/** Runs the CLI's own self-update against the binary Bycoda uses. */
export async function updateHarnessCli(
  provider: ConfigurableBinaryProvider,
  targetVersion?: string,
): Promise<void> {
  const resolved = await resolveHarnessBinary(provider);
  await invoke("harness_update", {
    command: resolved.path,
    binaryProvider: provider,
    binaryPath: runtimeProviderBinaryPath(provider),
    targetVersion,
  });
}

export function execChild(
  command: string,
  args: string[],
  cwd?: string,
  binaryProvider?: ConfigurableBinaryProvider,
  binaryPathOverride?: string | null,
): Promise<string> {
  const binaryPath =
    binaryPathOverride === undefined && binaryProvider
      ? runtimeProviderBinaryPath(binaryProvider)
      : binaryPathOverride;
  return invoke("harness_exec", {
    command,
    args,
    cwd,
    binaryProvider,
    binaryPath,
  });
}
