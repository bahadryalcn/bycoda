import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  isHarnessConstructionId,
  requireHarnessProcessReceipt,
  type HarnessProcessReceipt,
} from "../../../shared/model/harnessProcess";
import { configureGeneratedImageStorage } from "./generatedImages";
import {
  deliverNativeOutputItem,
  discardNativeOutputItems,
  invalidateNativeOutputDelivery,
  invalidateNativeOutputSession,
  invalidateNativeOutputConstruction,
  quarantineNativeOutputSession,
  observeNativeOutputBatch,
  observeNativeOutputState,
  captureNativeOutputWork,
  trackNativeOutputWork,
  type NativeOutputItem,
} from "./nativeOutputDelivery";
import { socialBridge, socialSpawnArgs } from "./socialBridge";
import { observeProviderOperation } from "./providerObservation";
import { nativeControlTurnReceipt, type ControlTurnHandle } from "./controlTurn";
import type { HostRunHandle, HostRunBinding } from "./hostRun";
import { retireProviderProcess } from "./providerRetirement";
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
  hostRun?: HostRunHandle,
): Promise<{ cwd: string; logPath: string }> {
  const originalBackend = backend;
  if (hostRun !== undefined) {
    if (!originalBackend || !isOpaqueHostCapability(hostRun))
      return Promise.reject(new Error("An original Host backend and opaque run are required"));
    return originalBackend.invoke("harness_prepare_text_workspace", { content, hostRun });
  }
  return originalBackend
    ? originalBackend.invoke("harness_prepare_text_workspace", { content })
    : tauriInvoke("harness_prepare_text_workspace", { content });
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

type LinePayload = {
  sessionId: string;
  constructionId?: unknown;
  line: string;
  nativeOutput?: unknown;
};
type LinesPayload = {
  sessionId: string;
  constructionId?: unknown;
  lines: string[];
  nativeOutput?: unknown;
};
type SseBatchPayload = { sessionId: string; data: string[]; nativeOutput?: unknown };
type ExitPayload = {
  sessionId: string;
  code: number | null;
  pid?: number;
  constructionId?: unknown;
  reason?: string;
  nativeOutputState?: unknown;
};
type SsePayload = { sessionId: string; data: string; nativeOutput?: unknown };
type SseEndPayload = { sessionId: string; error?: string | null; nativeOutputState?: unknown };

type LineHandler = (line: string) => void;
type ExitHandler = (code: number | null, reason?: string) => void;
type SseHandler = (data: string) => void;
type SseEndHandler = (error?: string) => void;

const sseHandlers = new Map<string, SseHandler>();
const sseEndHandlers = new Map<string, SseEndHandler>();
const sseBuffer = new Map<string, Buffered>();
// Output may be broadcast to every window (the backend falls back to that when
// it does not know the owner). Only ids this window spawned or opened may
// buffer while unwatched; anything else would be held until the bridge
// is torn down, since nothing here ever watches or unwatches it.
const ownedSse = new Set<string>();
declare const childProcessBrand: unique symbol;
/** A private construction, not a session-to-current-process selector or operation grant. */
export type ChildProcessHandle = Readonly<{ sessionId: string; [childProcessBrand]: true }>;
declare const childTurnWriterBrand: unique symbol;
/** An immutable operation source, distinct from a process's birth turn. */
export type ChildTurnWriter = Readonly<{ sessionId: string; [childTurnWriterBrand]: true }>;
type ChildTurnBinding = Readonly<{
  version: 1;
  bindingId: string;
  sessionId: string;
  constructionId: string;
  turnId: string;
}>;
type ChildTurnWriterState = Readonly<{
  process: ChildProcessState;
  controlTurn?: ControlTurnHandle;
  hostRun?: HostRunHandle;
  invoke: ChildBackend["invoke"];
  backend: HarnessProcessReceipt["backend"];
  receipt: HarnessProcessReceipt;
  binding?: ChildTurnBinding;
  hostBinding?: HostRunBinding;
  beforeWrites: readonly (() => void)[];
}>;
type ProcessFrame = {
  constructionId: string;
  body:
    | { kind: "stdout" | "stderr"; line: string; nativeItem?: NativeOutputItem }
    | { kind: "exit"; code: number | null; pid?: number; reason?: string };
  references: number;
  consumed: boolean;
};
type ChildProcessState = {
  handle: ChildProcessHandle;
  nativeControlTurn?: ControlTurnHandle;
  hostRun?: HostRunHandle;
  invoke: ChildBackend["invoke"];
  backend: HarnessProcessReceipt["backend"];
  ready: Promise<HarnessProcessReceipt>;
  resolve: (receipt: HarnessProcessReceipt) => void;
  reject: (error: unknown) => void;
  phase: "new" | "preparing" | "invoking" | "bound" | "failed";
  cancelled: boolean;
  retired: boolean;
  exited: boolean;
  order: number;
  receipt?: HarnessProcessReceipt;
  spawnReturned?: boolean;
  kill?: Promise<void>;
  handlers?: { line: LineHandler; exit: ExitHandler; stderr?: LineHandler };
  early: ProcessFrame[];
  earlyBytes: number;
};
const processStates = new WeakMap<ChildProcessHandle, ChildProcessState>();
const childTurnWriters = new WeakMap<ChildTurnWriter, ChildTurnWriterState>();
const processTurnBindings = new WeakMap<
  ChildProcessState,
  {
    controlled: WeakMap<ControlTurnHandle, Promise<ChildTurnWriter>>;
    hostRuns: WeakMap<HostRunHandle, Promise<ChildTurnWriter>>;
    uncontrolled?: Promise<ChildTurnWriter>;
  }
>();
const processRoutes = new Map<string, Set<ChildProcessState>>();
const currentChildren = new Map<string, ChildProcessHandle>();
const lineBuffer = new Map<ChildProcessState, Buffered>();
let spawnOrder = 0;
type GuardedSpawnAttempt = { generation: number };
type GuardedSpawnGroup = {
  latest: number;
  published: number;
  attempts: Set<GuardedSpawnAttempt>;
};
// Only restrictive in-process starts use this state. Retiring the group also
// fences work still awaiting its grant/bridges, without restoring a killed PID.
const guardedSpawns = new Map<string, GuardedSpawnGroup>();

export function createChildProcessHandle(
  sessionId: string,
  nativeControlTurn?: ControlTurnHandle,
): ChildProcessHandle {
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 512)
    throw new Error("Invalid harness process locator");
  if (nativeControlTurn) nativeControlTurnReceipt(nativeControlTurn);
  const handle = Object.freeze({ sessionId }) as ChildProcessHandle;
  let resolve!: ChildProcessState["resolve"];
  let reject!: ChildProcessState["reject"];
  const ready = new Promise<HarnessProcessReceipt>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // A cancelled/failed construction need not have a write waiter yet.
  void ready.catch(() => undefined);
  processStates.set(handle, {
    handle,
    nativeControlTurn,
    invoke: backend ? backend.invoke.bind(backend) : tauriInvoke,
    backend: backend ? "host" : "native",
    ready,
    resolve,
    reject,
    phase: "new",
    cancelled: false,
    retired: false,
    exited: false,
    order: 0,
    early: [],
    earlyBytes: 0,
  });
  return handle;
}

/** The original construction's authority observation, never a current session lookup. */
export function captureChildControlTurn(handle: ChildProcessHandle): ControlTurnHandle | undefined {
  return childState(handle).nativeControlTurn;
}

function isOpaqueHostCapability(value: unknown): value is object {
  if (!value || typeof value !== "object" || !Object.isFrozen(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return (
    (prototype === null || prototype === Object.prototype) && Reflect.ownKeys(value).length === 0
  );
}

/** Only an actual fresh construction may capture its source-issued birth run.
 * Warm operation bindings never replace that original association. */
export function associateChildHostRun(handle: ChildProcessHandle, hostRun: HostRunHandle): void {
  const state = childState(handle);
  if (state.backend !== "host" || state.nativeControlTurn)
    throw new Error("A Host run cannot target a Native control process");
  if (!isOpaqueHostCapability(hostRun)) throw new Error("An opaque Host run is required");
  if (state.hostRun === hostRun) return;
  if (state.phase !== "new" || state.hostRun)
    throw new Error("A process birth Host run cannot be replaced");
  state.hostRun = hostRun;
}

export function assertChildTurnWriter(handle: ChildProcessHandle, writer: ChildTurnWriter): void {
  const original = childTurnWriters.get(writer);
  if (!original || original.process !== childState(handle) || original.process.handle !== handle)
    throw new Error("Child turn writer belongs to a different process construction");
}

/** Add refusal checks while retaining the exact original construction and binding. */
export function guardChildTurnWriter(
  writer: ChildTurnWriter,
  beforeWrite: () => void,
): ChildTurnWriter {
  const original = childTurnWriters.get(writer);
  if (!original || typeof beforeWrite !== "function")
    throw new Error("An original child turn writer and synchronous guard are required");
  const guarded = Object.freeze({ sessionId: writer.sessionId }) as ChildTurnWriter;
  childTurnWriters.set(
    guarded,
    Object.freeze({
      ...original,
      beforeWrites: Object.freeze([...original.beforeWrites, beforeWrite]),
    }),
  );
  return guarded;
}

/** The pair is captured before waits; an unknown bind is never retried or retargeted. */
export function bindChildTurnWriter(
  handle: ChildProcessHandle,
  controlTurn?: ControlTurnHandle,
  hostRun?: HostRunHandle,
): Promise<ChildTurnWriter> {
  try {
    const process = childState(handle);
    if (hostRun !== undefined && !isOpaqueHostCapability(hostRun))
      throw new Error("An opaque Host run is required");
    if (controlTurn && hostRun) throw new Error("Native and Host turn sources cannot be combined");
    let pairs = processTurnBindings.get(process);
    if (!pairs) {
      pairs = { controlled: new WeakMap(), hostRuns: new WeakMap() };
      processTurnBindings.set(process, pairs);
    }
    const previous = hostRun
      ? pairs.hostRuns.get(hostRun)
      : controlTurn
        ? pairs.controlled.get(controlTurn)
        : pairs.uncontrolled;
    if (previous) return previous;
    const invoke = process.invoke;
    const backend = process.backend;
    const control = controlTurn ? nativeControlTurnReceipt(controlTurn) : undefined;
    const work = Promise.resolve().then(async () => {
      if (backend === "host" && control)
        throw new Error("A Native control turn cannot target a Host process");
      if (hostRun && backend !== "host")
        throw new Error("A Host run cannot target a Native process");
      if (hostRun && !isOpaqueHostCapability(hostRun))
        throw new Error("An opaque Host run is required");
      if (hostRun && !process.hostRun)
        throw new Error("Original process birth Host run is required before binding");
      if (backend === "host" && process.hostRun && !hostRun)
        throw new Error("Original Host run is required for this process writer");
      if (backend === "native" && process.nativeControlTurn && !control)
        throw new Error("Original Native control turn is required for this process writer");
      const receipt = process.receipt ?? (await process.ready);
      if (process.cancelled || process.retired || process.exited)
        throw new Error("Harness process construction retired");
      let binding: ChildTurnBinding | undefined;
      let hostBinding: HostRunBinding | undefined;
      if (backend === "host" && hostRun) {
        const raw = await invoke<unknown>("harness_bind_host_run", {
          sessionId: handle.sessionId,
          constructionId: receipt.constructionId,
          hostRun,
        });
        // This is only a closed opaque representation check. The original
        // backend's private authority recognizes the returned object on write.
        if (!isOpaqueHostCapability(raw)) throw new Error("Host run binding is unconfirmed");
        hostBinding = raw as HostRunBinding;
      }
      if (backend === "native" && control) {
        const raw = await invoke<unknown>("harness_bind_turn", {
          sessionId: handle.sessionId,
          constructionId: receipt.constructionId,
          controlTurn: control,
        });
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new Error("Native child turn binding is unconfirmed");
        const fields = Object.getOwnPropertyDescriptors(raw);
        const names = ["version", "bindingId", "sessionId", "constructionId", "turnId"];
        if (
          Reflect.ownKeys(fields).length !== names.length ||
          !names.every(
            (name) =>
              Object.prototype.hasOwnProperty.call(fields, name) &&
              Object.prototype.hasOwnProperty.call(fields[name], "value"),
          ) ||
          fields.version.value !== 1 ||
          !isHarnessConstructionId(fields.bindingId.value) ||
          fields.sessionId.value !== control.sessionId ||
          fields.constructionId.value !== receipt.constructionId ||
          fields.turnId.value !== control.turnId
        )
          throw new Error("Native child turn binding is unconfirmed");
        binding = Object.freeze({
          version: 1,
          bindingId: fields.bindingId.value as string,
          sessionId: control.sessionId,
          constructionId: receipt.constructionId,
          turnId: control.turnId,
        });
      }
      const writer = Object.freeze({ sessionId: handle.sessionId }) as ChildTurnWriter;
      childTurnWriters.set(
        writer,
        Object.freeze({
          process,
          controlTurn,
          hostRun,
          invoke,
          backend,
          receipt,
          binding,
          hostBinding,
          beforeWrites: Object.freeze([]),
        }),
      );
      return writer;
    });
    if (hostRun) pairs.hostRuns.set(hostRun, work);
    else if (controlTurn) pairs.controlled.set(controlTurn, work);
    else pairs.uncontrolled = work;
    void work.catch(() => {});
    return work;
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Fresh owner intent only. Deferred writers and finalizers retain their original handle. */
export function captureChildProcess(sessionId: string): ChildProcessHandle | undefined {
  const handle = currentChildren.get(sessionId);
  const state = handle && processStates.get(handle);
  return state && !state.cancelled && !state.retired && !state.exited ? handle : undefined;
}

function childState(handle: ChildProcessHandle): ChildProcessState {
  const state = processStates.get(handle);
  if (!state) throw new Error("An original harness process handle is required");
  return state;
}

/** Retire only this construction's Native output, never a replacement found by route. */
export function invalidateChildOutput(handle: ChildProcessHandle, reason: string): void {
  const state = childState(handle);
  if (state.backend !== "native" || state.order === 0) return;
  const invalidate = (receipt: HarnessProcessReceipt) =>
    invalidateNativeOutputConstruction(handle.sessionId, receipt.constructionId, reason);
  if (state.receipt) invalidate(state.receipt);
  else {
    // The actual invoked spawn may still return after local close/cancellation.
    // Only its own receipt can select a stream; unknown remains quarantined.
    void state.ready.then(invalidate, () =>
      quarantineNativeOutputSession(handle.sessionId, reason),
    );
  }
}

function registerProcess(state: ChildProcessState): void {
  const routes = processRoutes.get(state.handle.sessionId) ?? new Set<ChildProcessState>();
  routes.add(state);
  processRoutes.set(state.handle.sessionId, routes);
}

function releaseFrame(frame: ProcessFrame): void {
  frame.references -= 1;
  if (
    frame.references === 0 &&
    !frame.consumed &&
    frame.body.kind !== "exit" &&
    frame.body.nativeItem
  )
    discardNativeOutputItems([frame.body.nativeItem], "child-construction-unmatched");
}

function clearEarly(state: ChildProcessState): void {
  for (const frame of state.early) releaseFrame(frame);
  state.early = [];
  state.earlyBytes = 0;
}

function detachProcess(state: ChildProcessState): void {
  state.handlers = undefined;
  const buffered = lineBuffer.get(state);
  if (buffered?.nativeItems) discardNativeOutputItems(buffered.nativeItems, "child-unwatched");
  lineBuffer.delete(state);
  clearEarly(state);
  const routes = processRoutes.get(state.handle.sessionId);
  routes?.delete(state);
  if (!routes?.size) processRoutes.delete(state.handle.sessionId);
  if (currentChildren.get(state.handle.sessionId) === state.handle)
    currentChildren.delete(state.handle.sessionId);
}

function deliverProcessFrame(state: ChildProcessState, frame: ProcessFrame): void {
  if (
    frame.consumed ||
    state.cancelled ||
    state.retired ||
    state.receipt?.constructionId !== frame.constructionId
  )
    return;
  const body = frame.body;
  if (body.kind === "exit") {
    if (state.exited || !isCurrentChildExit(state.receipt.pid, body.pid)) return;
    frame.consumed = true;
    state.exited = true;
    if (currentChildren.get(state.handle.sessionId) === state.handle)
      currentChildren.delete(state.handle.sessionId);
    try {
      if (body.reason) state.handlers?.exit(body.code, body.reason);
      else state.handlers?.exit(body.code);
    } finally {
      // The process is already gone; retirement just clears the ledger record.
      void retireProviderProcess(state.handle).catch(() => {});
    }
    return;
  }
  frame.consumed = true;
  const handler = body.kind === "stdout" ? state.handlers?.line : state.handlers?.stderr;
  if (handler) deliverNativeOutputItem(body.nativeItem, () => handler(body.line));
  else if (body.kind === "stdout")
    pushBounded(
      lineBuffer,
      state,
      [body.line],
      MAX_BUFFERED_BYTES,
      body.nativeItem ? [body.nativeItem] : undefined,
    );
  else if (body.nativeItem) discardNativeOutputItems([body.nativeItem], "unwatched-stderr");
}

function routeProcessFrame(sessionId: string, frame: ProcessFrame): void {
  const routes = processRoutes.get(sessionId);
  const bound =
    routes &&
    [...routes].find(
      (state) =>
        !state.cancelled &&
        !state.retired &&
        state.receipt?.constructionId === frame.constructionId,
    );
  if (bound) {
    deliverProcessFrame(bound, frame);
  } else {
    for (const state of routes ?? []) {
      if (state.cancelled || state.retired || state.phase !== "invoking") continue;
      const bytes = frame.body.kind === "exit" ? 0 : frame.body.line.length;
      if (bytes > MAX_BUFFERED_BYTES) continue;
      frame.references += 1;
      state.early.push(frame);
      state.earlyBytes += bytes;
      while (state.early.length > MAX_BUFFERED || state.earlyBytes > MAX_BUFFERED_BYTES) {
        const dropped = state.early.shift()!;
        state.earlyBytes -= dropped.body.kind === "exit" ? 0 : dropped.body.line.length;
        releaseFrame(dropped);
      }
    }
  }
  if (!frame.references && !frame.consumed && frame.body.kind !== "exit" && frame.body.nativeItem)
    discardNativeOutputItems([frame.body.nativeItem], "child-construction-unmatched");
}

function receiveProcessLines(
  sessionId: string,
  constructionId: unknown,
  channel: "stdout" | "stderr",
  lines: readonly string[],
  metadata?: unknown,
): void {
  const nativeItems = observeNativeOutputBatch(sessionId, channel, lines, metadata);
  if (!isHarnessConstructionId(constructionId)) {
    if (nativeItems) discardNativeOutputItems(nativeItems, "child-construction-missing");
    return;
  }
  for (const [index, line] of lines.entries())
    routeProcessFrame(sessionId, {
      constructionId,
      body: { kind: channel, line, nativeItem: nativeItems?.[index] },
      references: 0,
      consumed: false,
    });
}

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
type Buffered = { items: string[]; bytes: number; nativeItems?: (NativeOutputItem | null)[] };

const MAX_BUFFERED = 1000;
// UTF-16 code units, which is close enough to bytes for a memory bound.
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
let bridge: Promise<UnlistenFn[]> | null = null;
let bridgeAttempt: symbol | null = null;
let users = 0;
let teardownTimer: ReturnType<typeof setTimeout> | undefined;

/** Drops the oldest items past either bound; the newest item always stays,
 * even when it alone exceeds the byte bound. */
export function pushBounded<Key>(
  map: Map<Key, Buffered>,
  sessionId: Key,
  items: readonly string[],
  maxBytes = MAX_BUFFERED_BYTES,
  nativeItems?: readonly NativeOutputItem[],
) {
  const queued = map.get(sessionId) ?? { items: [], bytes: 0 };
  if (nativeItems && !queued.nativeItems) queued.nativeItems = queued.items.map(() => null);
  for (const [index, item] of items.entries()) {
    queued.items.push(item);
    queued.nativeItems?.push(nativeItems?.[index] ?? null);
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
    if (queued.nativeItems)
      discardNativeOutputItems(queued.nativeItems.splice(0, drop), "buffer-dropped");
    queued.items.splice(0, drop);
    queued.bytes = kept;
  }
  map.set(sessionId, queued);
}

function deliverSse(sessionId: string, data: readonly string[], metadata?: unknown) {
  const nativeItems = observeNativeOutputBatch(sessionId, "sse", data, metadata);
  const handler = sseHandlers.get(sessionId);
  if (handler) {
    for (const [index, item] of data.entries())
      deliverNativeOutputItem(nativeItems?.[index], () => handler(item));
    return;
  }
  if (ownedSse.has(sessionId))
    pushBounded(sseBuffer, sessionId, data, MAX_BUFFERED_BYTES, nativeItems);
  else if (nativeItems) discardNativeOutputItems(nativeItems, "unowned-buffer");
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
        receiveProcessLines(
          event.payload.sessionId,
          event.payload.constructionId,
          "stdout",
          event.payload.lines,
          event.payload.nativeOutput,
        );
      }),
    ),
    register(
      listen<LinePayload>("harness-stdout", (event) => {
        receiveProcessLines(
          event.payload.sessionId,
          event.payload.constructionId,
          "stdout",
          [event.payload.line],
          event.payload.nativeOutput,
        );
      }),
    ),
    register(
      listen<LinesPayload>("harness-stderr-lines", (event) => {
        receiveProcessLines(
          event.payload.sessionId,
          event.payload.constructionId,
          "stderr",
          event.payload.lines,
          event.payload.nativeOutput,
        );
      }),
    ),
    register(
      listen<LinePayload>("harness-stderr", (event) => {
        receiveProcessLines(
          event.payload.sessionId,
          event.payload.constructionId,
          "stderr",
          [event.payload.line],
          event.payload.nativeOutput,
        );
      }),
    ),
    register(
      listen<ExitPayload>("harness-exit", (event) => {
        observeNativeOutputState(event.payload.sessionId, event.payload.nativeOutputState);
        const { sessionId, constructionId, code, pid, reason } = event.payload;
        if (!isHarnessConstructionId(constructionId)) return;
        routeProcessFrame(sessionId, {
          constructionId,
          body: { kind: "exit", code, pid, reason },
          references: 0,
          consumed: false,
        });
      }),
    ),
    register(
      listen<SseBatchPayload>("harness-sse-batch", (event) => {
        deliverSse(event.payload.sessionId, event.payload.data, event.payload.nativeOutput);
      }),
    ),
    register(
      listen<SsePayload>("harness-sse", (event) => {
        deliverSse(event.payload.sessionId, [event.payload.data], event.payload.nativeOutput);
      }),
    ),
    register(
      listen<SseEndPayload>("harness-sse-end", (event) => {
        observeNativeOutputState(event.payload.sessionId, event.payload.nativeOutputState);
        const { sessionId, error } = event.payload;
        sseEndHandlers.get(sessionId)?.(error ?? undefined);
      }),
    ),
    register(
      listen<{ sessionId: string; nativeOutputState: unknown }>("harness-output-state", (event) => {
        observeNativeOutputState(event.payload.sessionId, event.payload.nativeOutputState);
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
  invalidateNativeOutputDelivery("bridge-teardown");
  const pending = bridge;
  bridge = null;
  bridgeAttempt = null;
  for (const routes of [...processRoutes.values()])
    for (const state of [...routes]) {
      state.cancelled = true;
      if (state.phase === "new" || state.phase === "preparing")
        state.reject(new Error("Harness bridge retired"));
      detachProcess(state);
    }
  sseHandlers.clear();
  sseEndHandlers.clear();
  sseBuffer.clear();
  ownedSse.clear();
  currentChildren.clear();
  guardedSpawns.clear();
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
  handle: ChildProcessHandle,
  onLine: LineHandler,
  onExit: ExitHandler,
  onStderr?: LineHandler,
) {
  const state = childState(handle);
  if (state.cancelled || state.retired || state.phase === "failed")
    throw new Error("Harness process construction retired");
  registerProcess(state);
  const queued = lineBuffer.get(state);
  lineBuffer.delete(state);
  state.handlers = { line: onLine, exit: onExit, stderr: onStderr };
  if (queued)
    for (const [index, line] of queued.items.entries())
      deliverNativeOutputItem(queued.nativeItems?.[index] ?? undefined, () => onLine(line));
}

export function unwatchChild(handle: ChildProcessHandle) {
  const state = childState(handle);
  invalidateChildOutput(handle, "child-unwatched");
  state.cancelled = true;
  if (state.phase === "new" || state.phase === "preparing")
    state.reject(new Error("Harness process construction retired"));
  detachProcess(state);
}

export function watchSse(sessionId: string, onData: SseHandler, onEnd?: SseEndHandler) {
  const queued = sseBuffer.get(sessionId);
  sseBuffer.delete(sessionId);
  sseHandlers.set(sessionId, onData);
  if (onEnd) sseEndHandlers.set(sessionId, onEnd);
  if (queued)
    for (const [index, item] of queued.items.entries())
      deliverNativeOutputItem(queued.nativeItems?.[index] ?? undefined, () => onData(item));
}

export function unwatchSse(sessionId: string) {
  invalidateNativeOutputSession(sessionId, "sse-unwatched");
  sseHandlers.delete(sessionId);
  sseEndHandlers.delete(sessionId);
  sseBuffer.delete(sessionId);
  ownedSse.delete(sessionId);
}

export type NativeAuthorityScope = { environmentId: string; generation: number };
const nativeAuthorityArgs = (scope?: NativeAuthorityScope) =>
  scope
    ? { authorityEnvironmentId: scope.environmentId, authorityGeneration: scope.generation }
    : {};

export async function spawnChild(
  handle: ChildProcessHandle,
  command: string,
  args: string[],
  cwd: string,
  account?: { provider: "claude" | "codex"; id: string },
  binaryProvider?: ConfigurableBinaryProvider,
  genericAcpId?: string,
  authority?: NativeAuthorityScope,
  beforeSpawn?: () => Promise<void>,
  logicalSessionId?: string,
): Promise<void> {
  const state = childState(handle);
  const { sessionId } = handle;
  const authorityArgs = nativeAuthorityArgs(authority);
  const hostRun = state.hostRun;
  if (state.phase !== "new" || state.cancelled)
    throw new Error("Harness process construction is single-use or cancelled");
  state.phase = "preparing";
  registerProcess(state);
  const group = beforeSpawn
    ? (guardedSpawns.get(sessionId) ?? {
        latest: 0,
        published: 0,
        attempts: new Set<GuardedSpawnAttempt>(),
      })
    : undefined;
  const attempt: GuardedSpawnAttempt | undefined = group ? { generation: 0 } : undefined;
  const checkGuarded = () => {
    if (state.cancelled || state.retired || (group && guardedSpawns.get(sessionId) !== group))
      throw new Error("Provider startup cancelled");
  };
  if (group && attempt) {
    guardedSpawns.set(sessionId, group);
    group.attempts.add(attempt);
  } else {
    // Preserve the ordinary spawn path. Its newer start retires only pending
    // restrictive attempts, which must never overwrite its eventual PID.
    guardedSpawns.delete(sessionId);
  }
  try {
    checkGuarded();
    if (beforeSpawn && group && attempt) {
      await beforeSpawn();
      checkGuarded();
      if (!Number.isSafeInteger(group.latest + 1))
        throw new Error("Provider startup generation exhausted");
      attempt.generation = ++group.latest;
    }
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
    if (beforeSpawn && group && attempt) {
      await beforeSpawn();
      checkGuarded();
      if (group.latest !== attempt.generation) throw new Error("Provider startup cancelled");
    }
    checkGuarded();
    if (!Number.isSafeInteger(spawnOrder + 1))
      throw new Error("Provider startup generation exhausted");
    state.order = ++spawnOrder;
    state.phase = "invoking";
    const raw = await state.invoke<unknown>("harness_spawn", {
      sessionId,
      command,
      args: launchArgs,
      cwd,
      account,
      binaryProvider,
      binaryPath,
      genericAcpId,
      ...(logicalSessionId === undefined ? {} : { logicalSessionId }),
      ...(state.backend === "native" && state.nativeControlTurn
        ? { controlTurn: nativeControlTurnReceipt(state.nativeControlTurn) }
        : {}),
      ...(state.backend === "host" && hostRun ? { hostRun } : {}),
      ...authorityArgs,
      // Functions are in-process restrictions, never desktop IPC/wire arguments.
      ...(state.backend === "host" && beforeSpawn ? { beforeSpawn } : {}),
    });
    state.spawnReturned = true;
    const receipt = requireHarnessProcessReceipt(raw, sessionId, state.backend);
    state.receipt = receipt;
    state.phase = "bound";
    const previous = currentChildren.get(sessionId);
    const previousState = previous && processStates.get(previous);
    const superseded =
      state.retired ||
      (group &&
        attempt &&
        (guardedSpawns.get(sessionId) !== group || attempt.generation < group.published)) ||
      (previousState && previousState.order > state.order);
    if (!state.cancelled && !superseded) {
      if (group && attempt) group.published = attempt.generation;
      // Retain the witness on every older original, including pending replies.
      // A successor exiting before that reply arrives cannot resurrect it.
      for (const previous of [...(processRoutes.get(sessionId) ?? [])])
        if (previous !== state && previous.order > 0 && previous.order < state.order) {
          previous.retired = true;
          detachProcess(previous);
        }
      currentChildren.set(sessionId, handle);
    } else if (superseded) {
      state.retired = true;
    }
    // Resolve only this receipt. A queued kill can now target it even after cancellation.
    state.resolve(receipt);
    const early = state.early;
    state.early = [];
    state.earlyBytes = 0;
    try {
      for (const frame of early) deliverProcessFrame(state, frame);
    } finally {
      for (const frame of early) releaseFrame(frame);
    }
    if (state.cancelled || state.retired) detachProcess(state);
  } catch (error) {
    if (!state.receipt) {
      state.phase = "failed";
      state.reject(error);
      detachProcess(state);
    }
    throw error;
  } finally {
    if (group && attempt) {
      group.attempts.delete(attempt);
      if (!group.attempts.size && guardedSpawns.get(sessionId) === group)
        guardedSpawns.delete(sessionId);
    }
  }
}

export function writeChild(
  handle: ChildProcessHandle | ChildTurnWriter,
  line: string,
  authority?: NativeAuthorityScope,
): Promise<void> {
  const work = captureNativeOutputWork();
  const authorityArgs = nativeAuthorityArgs(authority);
  try {
    const writer = childTurnWriters.get(handle as ChildTurnWriter);
    if (writer) {
      const original = writer.process;
      if (original.cancelled || original.retired || original.exited)
        throw new Error("Harness process construction retired");
      // Protocol preparation (including ACP bridges) may have awaited before
      // reaching this receipt-ready closure. No check at view creation replaces
      // the original operation's final refusal check here.
      for (const beforeWrite of writer.beforeWrites) {
        const result: unknown = beforeWrite();
        if (
          result !== null &&
          (typeof result === "object" || typeof result === "function") &&
          typeof (result as { then?: unknown }).then === "function"
        ) {
          void Promise.resolve(result).catch(() => {});
          throw new Error("Child turn writer guards must be synchronous");
        }
      }
      // A synchronous guard may reenter teardown. It cannot restore a retired
      // construction merely by returning normally.
      if (original.cancelled || original.retired || original.exited)
        throw new Error("Harness process construction retired");
      return trackNativeOutputWork(
        writer.invoke<void>(
          writer.hostBinding
            ? "harness_write_host_run"
            : writer.binding
              ? "harness_write_controlled"
              : "harness_write",
          {
            sessionId: original.handle.sessionId,
            constructionId: writer.receipt.constructionId,
            line,
            ...(writer.hostBinding
              ? { binding: writer.hostBinding }
              : writer.binding
                ? { binding: writer.binding }
                : {}),
            ...authorityArgs,
          },
        ),
        work,
      );
    }
    const state = childState(handle as ChildProcessHandle);
    const write = (receipt: HarnessProcessReceipt) => {
      if (state.cancelled || state.retired || state.exited)
        throw new Error("Harness process construction retired");
      return state.invoke<void>("harness_write", {
        sessionId: handle.sessionId,
        constructionId: receipt.constructionId,
        line,
        ...authorityArgs,
      });
    };
    return trackNativeOutputWork(
      state.receipt ? write(state.receipt) : state.ready.then(write),
      work,
    );
  } catch (error) {
    work?.fail("child-write-rejected");
    return Promise.reject(error);
  }
}

export function killChild(handle: ChildProcessHandle): Promise<void> {
  const state = childState(handle);
  if (state.kill) return state.kill;
  const beforeInvoke = state.phase === "new" || state.phase === "preparing";
  unwatchChild(handle);
  // Nothing to kill when the spawn failed or the process already exited.
  if (beforeInvoke || (state.phase === "failed" && !state.spawnReturned) || state.exited)
    return (state.kill = Promise.resolve());
  const kill = (receipt: HarnessProcessReceipt) =>
    state.invoke<void>("harness_kill", {
      sessionId: handle.sessionId,
      constructionId: receipt.constructionId,
    });
  const run: Promise<void> = (
    state.receipt
      ? kill(state.receipt)
      : state.ready.then(kill, (error: unknown) => {
          if (state.spawnReturned) {
            // Native accepted the spawn but returned an invalid receipt. Ask it
            // to stop the original session instead of treating validation as exit.
            return state.invoke<void>("harness_kill", { sessionId: handle.sessionId });
          }
          console.warn("[child] kill skipped, spawn invoke rejected", error);
        })
  ).catch((error: unknown) => {
    // Do not cache a rejection; unknown/exited constructions are already gone.
    if (state.kill === run) state.kill = undefined;
    if (state.exited || /^NATIVE_PROCESS_CONSTRUCTION_STALE$/.test(error instanceof Error ? error.message : String(error))) {
      console.warn("[child] kill target already gone", error);
      return;
    }
    throw error;
  });
  state.kill = run;
  return run;
}

export function killAllChildren(): Promise<void> {
  // A naturally ended child can still have undelivered buffered output here.
  // Native kill_all cannot cancel that already-removed lifetime for us.
  invalidateNativeOutputDelivery("children-reset");
  for (const routes of [...processRoutes.values()])
    for (const state of [...routes]) {
      state.cancelled = true;
      if (state.phase === "new" || state.phase === "preparing")
        state.reject(new Error("Harness children reset"));
      detachProcess(state);
    }
  sseHandlers.clear();
  sseEndHandlers.clear();
  sseBuffer.clear();
  ownedSse.clear();
  currentChildren.clear();
  guardedSpawns.clear();
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

export type HarnessHttpInput = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Native authority provenance; URLs never select a different app session. */
  sessionId?: string;
  authorityEnvironmentId?: string;
  authorityGeneration?: number;
};
export type HostHarnessHttpSource = Readonly<{
  baseUrl: string;
  directory: string;
  providerSessionId?: string;
}>;

/** Capture one in-process Host dispatcher and target demand. Actual origin and
 * session provenance are checked by the backend's private authority on effect. */
export function captureHostHarnessHttp(
  hostRun: HostRunHandle,
  httpSource: HostHarnessHttpSource,
): (input: HarnessHttpInput) => Promise<{ status: number; body: string }> {
  const originalBackend = backend;
  if (!originalBackend || !isOpaqueHostCapability(hostRun))
    throw new Error("An original Host backend and opaque run are required");
  const originalInvoke = originalBackend.invoke.bind(originalBackend);
  const source = Object.freeze({ ...httpSource });
  let binding: Promise<HostRunBinding>;
  try {
    // The Host captures its actual original origin synchronously on entry,
    // before authority checks may await. Requests never select a latest URL.
    binding = Promise.resolve(
      originalInvoke<unknown>("harness_bind_http_host_run", {
        hostRun,
        httpSource: source,
      }),
    ).then((value) => {
      if (!isOpaqueHostCapability(value)) throw new Error("Host HTTP binding is unconfirmed");
      return value as HostRunBinding;
    });
  } catch (error) {
    binding = Promise.reject(error);
  }
  void binding.catch(() => {});
  return (input) => {
    const originalInput = { ...input, ...(input.headers ? { headers: { ...input.headers } } : {}) };
    const work = captureNativeOutputWork({ additionalInput: true });
    try {
      return trackNativeOutputWork(
        binding.then((originalBinding) =>
          originalInvoke<{ status: number; body: string }>("harness_http_host_run", {
            ...originalInput,
            hostRun,
            binding: originalBinding,
            httpSource: source,
          }),
        ),
        work,
      );
    } catch (error) {
      work?.fail("child-http-rejected");
      throw error;
    }
  };
}

export function harnessHttp(input: HarnessHttpInput): Promise<{ status: number; body: string }> {
  const work = captureNativeOutputWork({ additionalInput: true });
  try {
    return trackNativeOutputWork(
      invoke<{ status: number; body: string }>("harness_http", input),
      work,
    );
  } catch (error) {
    work?.fail("child-http-rejected");
    throw error;
  }
}

export function openHarnessSse(
  sessionId: string,
  url: string,
  headers?: Record<string, string>,
  authority?: NativeAuthorityScope,
  logicalSessionId?: string,
): Promise<void> {
  ownedSse.add(sessionId);
  return invoke("harness_sse_open", {
    sessionId,
    url,
    headers,
    ...nativeAuthorityArgs(authority),
    ...(logicalSessionId === undefined ? {} : { logicalSessionId }),
  });
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
  const work = captureNativeOutputWork();
  let actual: Promise<string>;
  try {
    actual = trackNativeOutputWork(
      invoke<string>("harness_exec", {
        command,
        args: [...args],
        cwd,
        binaryProvider,
        binaryPath,
      }),
      work,
    );
  } catch (error) {
    work?.fail("cli-probe-invoke-threw");
    throw error;
  }
  // Read-only probe deadline only. Native/Host keeps the original physical job
  // until its output and process settle; updates use their separate actual path.
  return observeProviderOperation(actual, 20_000, "CLI probe");
}
