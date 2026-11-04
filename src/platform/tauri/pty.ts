import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { listenWindowAsync } from "./listenWindow";

type DataPayload = { id: string; data: string; flow?: { generation: number; sequence: number } };
type ExitPayload = { id: string; code: number | null };

type DataHandler = (data: Uint8Array, consumed?: () => void) => void;
type ExitHandler = (code: number | null) => void;

const dataHandlers = new Map<string, DataHandler>();
const exitHandlers = new Map<string, ExitHandler>();
const dataBuffer = new Map<string, Uint8Array[]>();
const dataBufferBytes = new Map<string, number>();
/** PTYs this window opened; ignore data for unmounted, unrelated terminals. */
const openedPtys = new Set<string>();
const flowControlled = new Set<string>();

/**
 * Replay budget for a PTY whose view is not mounted. Chunks arrive at up to
 * 32KB each, so a count-based cap let one unsubscribed terminal retain
 * megabytes; bound the bytes instead. Whole chunks are dropped oldest-first.
 */
const MAX_BUFFERED_BYTES = 256 * 1024;
const MAX_BUFFERED = 200;
let bridge: Promise<UnlistenFn[]> | null = null;
let bridgeGeneration = 0;
let users = 0;
let teardownTimer: ReturnType<typeof setTimeout> | undefined;

/** Portable path: atob plus a byte loop. Exported so tests can compare it with the native one. */
export function decodeBase64Loop(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

type NativeBase64 = { fromBase64?: (data: string) => Uint8Array };

/** Native decode where the WebView has it (recent Chromium); throws on malformed input like atob. */
export function decodeBase64(data: string): Uint8Array {
  const native = (Uint8Array as unknown as NativeBase64).fromBase64;
  return native ? native.call(Uint8Array, data) : decodeBase64Loop(data);
}

/**
 * Same as decodeBase64, but a payload the backend never actually sends
 * malformed should not throw inside the pty-data listener and lose the
 * chunk (and whatever else was queued behind it). Returns null instead.
 */
export function decodePtyChunk(data: string): Uint8Array | null {
  try {
    return decodeBase64(data);
  } catch {
    return null;
  }
}

/**
 * Leading chunks to drop to bring a replay buffer back within budget, and the
 * byte total that remains. Never drops the newest chunk, even when that chunk
 * alone exceeds the budget — replaying something beats replaying nothing.
 */
export function trimReplay(sizes: number[], bytes: number): { drop: number; bytes: number } {
  let drop = 0;
  let left = bytes;
  while (
    drop < sizes.length - 1 &&
    (left > MAX_BUFFERED_BYTES || sizes.length - drop > MAX_BUFFERED)
  ) {
    left -= sizes[drop];
    drop += 1;
  }
  return { drop, bytes: left };
}

function pushBuffered(id: string, chunk: Uint8Array) {
  const queued = dataBuffer.get(id) ?? [];
  queued.push(chunk);
  const trimmed = trimReplay(
    queued.map((entry) => entry.byteLength),
    (dataBufferBytes.get(id) ?? 0) + chunk.byteLength,
  );
  if (trimmed.drop > 0) queued.splice(0, trimmed.drop);
  dataBuffer.set(id, queued);
  dataBufferBytes.set(id, trimmed.bytes);
}

function clearBuffered(id: string) {
  dataBuffer.delete(id);
  dataBufferBytes.delete(id);
}

type AckSlot = {
  generation: number;
  chunks: { sequence: number; consumed: boolean }[];
  sequence?: number;
  count: number;
  timer?: ReturnType<typeof setTimeout>;
};
const ackSlots = new Map<string, AckSlot>();

function flushAck(id: string, slot: AckSlot) {
  clearTimeout(slot.timer);
  slot.timer = undefined;
  const sequence = slot.sequence;
  slot.sequence = undefined;
  slot.count = 0;
  if (slot.chunks.length === 0 && ackSlots.get(id) === slot) ackSlots.delete(id);
  if (sequence !== undefined) {
    void invoke("pty_output_ack", { id, generation: slot.generation, sequence }).catch(() => {});
  }
}

function pendingAck(id: string, flow: DataPayload["flow"]): () => void {
  if (!flow) return () => {};
  let slot = ackSlots.get(id);
  if (!slot || slot.generation !== flow.generation) {
    if (slot) flushAck(id, slot);
    slot = { generation: flow.generation, chunks: [], count: 0 };
    ackSlots.set(id, slot);
  }
  const current = slot;
  const chunk = { sequence: flow.sequence, consumed: false };
  current.chunks.push(chunk);
  return () => {
    if (chunk.consumed || ackSlots.get(id) !== current) return;
    chunk.consumed = true;
    // Acknowledge the highest consumed sequence: the backend drains everything up to it, so one
    // chunk whose callback never runs cannot hold back every later acknowledgement.
    const highest = Math.max(
      ...current.chunks.filter((entry) => entry.consumed).map((entry) => entry.sequence),
    );
    while (current.chunks[0] && current.chunks[0].sequence <= highest) {
      const settled = current.chunks.shift()!;
      settled.consumed = true;
      current.count += 1;
    }
    if (current.sequence === undefined || highest > current.sequence) current.sequence = highest;
    if (current.sequence === undefined) return;
    if (current.count >= 16) flushAck(id, current);
    else current.timer ??= setTimeout(() => flushAck(id, current), 32);
  };
}

function flushAcks() {
  for (const [id, slot] of ackSlots) flushAck(id, slot);
}

function ensureBridge() {
  if (bridge) return bridge;
  const generation = ++bridgeGeneration;
  const pending = Promise.allSettled([
    listenWindowAsync<DataPayload>("pty-data", (event) => {
      if (bridgeGeneration !== generation) return;
      const { id, data, flow } = event.payload;
      const acknowledge = pendingAck(id, flow);
      const handler = dataHandlers.get(id);
      if (!handler && !openedPtys.has(id)) {
        acknowledge();
        return;
      }
      const chunk = decodePtyChunk(data);
      if (!chunk) {
        acknowledge();
        return;
      }
      if (handler && flowControlled.has(id)) handler(chunk, acknowledge);
      else {
        if (handler) handler(chunk);
        else pushBuffered(id, chunk);
        acknowledge();
      }
    }),
    listenWindowAsync<ExitPayload>("pty-exit", (event) => {
      if (bridgeGeneration !== generation) return;
      const { id, code } = event.payload;
      const slot = ackSlots.get(id);
      if (slot) flushAck(id, slot);
      // The process is gone: nothing more arrives for this id, so stop tracking it
      // and drop any unmounted replay. A mounted view keeps its handlers and gets
      // the exit callback below.
      openedPtys.delete(id);
      clearBuffered(id);
      exitHandlers.get(id)?.(code);
    }),
  ]).then((results) => {
    const listeners = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failure = results.find((result) => result.status === "rejected");
    if (!failure) return listeners;
    if (bridgeGeneration === generation) bridgeGeneration++;
    // A partly registered bridge must not leak its successful listener or cache
    // a rejected promise forever. A subsequent terminal subscription can retry.
    for (const unlisten of listeners) {
      try {
        unlisten();
      } catch (error) {
        console.warn("PTY listener cleanup failed", error);
      }
    }
    if (bridge === pending) bridge = null;
    throw new Error("Terminal event listeners could not start. Reopen the terminal to retry.");
  });
  bridge = pending;
  // Subscriptions are synchronous; spawn/readiness callers observe the failure.
  void pending.catch(() => undefined);
  return pending;
}

/** Every PTY producer (including SSH/key generation) must await both listeners. */
export async function readyPtyBridge(): Promise<void> {
  await ensureBridge();
}

function retain() {
  users += 1;
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = undefined;
  }
  ensureBridge();
}

function release() {
  users = Math.max(0, users - 1);
  if (users > 0 || !bridge) return;
  const pending = bridge;
  teardownTimer = setTimeout(() => {
    teardownTimer = undefined;
    if (users > 0) return;
    flushAcks();
    bridgeGeneration++;
    bridge = null;
    void pending.then((fns) => fns.forEach((fn) => fn())).catch(() => undefined);
  }, 500);
}

/** `profile` is a terminal profile id; without one the system default shell starts. */
export async function spawnPty(
  id: string,
  cwd: string,
  cols: number,
  rows: number,
  profile?: string,
): Promise<void> {
  await readyPtyBridge();
  await invoke("pty_spawn", { id, cwd, cols, rows, profile: profile ?? null });
}

export async function writePty(id: string, data: string): Promise<void> {
  await invoke("pty_write", { id, data });
}

/** Prefix-matched local shell history and commands. No history is sent to agents or persisted here. */
export function getPtySuggestions(id: string, prefix: string): Promise<string[]> {
  return invoke<string[]>("pty_suggestions", { id, prefix });
}

type ResizeSlot = { cols: number; rows: number; running: Promise<void> };
const resizeSlots = new Map<string, ResizeSlot>();

/**
 * Resizes run off the main thread and may finish out of order, so one runs at
 * a time per PTY and a burst collapses to its latest size.
 */
export function resizePty(id: string, cols: number, rows: number): Promise<void> {
  const slot = resizeSlots.get(id);
  if (slot) {
    slot.cols = cols;
    slot.rows = rows;
    return slot.running;
  }
  const next: ResizeSlot = { cols, rows, running: Promise.resolve() };
  resizeSlots.set(id, next);
  next.running = (async () => {
    try {
      let sent: [number, number] | null = null;
      while (!sent || sent[0] !== next.cols || sent[1] !== next.rows) {
        sent = [next.cols, next.rows];
        await invoke("pty_resize", { id, cols: sent[0], rows: sent[1] });
      }
    } finally {
      resizeSlots.delete(id);
    }
  })();
  return next.running;
}

/** Whether the terminal is on screen. Hidden output is held natively and
 * released in order when it is shown, instead of streaming events nobody sees. */
export async function setPtyVisible(id: string, visible: boolean): Promise<void> {
  if (flowControlled.has(id)) await invoke("pty_output_flow", { id, enabled: true });
  await invoke("pty_set_visible", { id, visible });
}

export async function getPtyStatus(
  id: string,
): Promise<{ foreground: string | null; supported?: boolean }> {
  return invoke<{ foreground: string | null; supported?: boolean }>("pty_status", { id });
}

export async function killPty(id: string): Promise<void> {
  dataHandlers.delete(id);
  exitHandlers.delete(id);
  openedPtys.delete(id);
  flowControlled.delete(id);
  clearBuffered(id);
  const slot = ackSlots.get(id);
  if (slot) flushAck(id, slot);
  ackSlots.delete(id);
  await invoke("pty_kill", { id }).catch(() => undefined);
}

export async function killAllPtys(): Promise<void> {
  dataHandlers.clear();
  exitHandlers.clear();
  openedPtys.clear();
  flowControlled.clear();
  dataBuffer.clear();
  dataBufferBytes.clear();
  flushAcks();
  ackSlots.clear();
  await invoke("pty_kill_all").catch(() => undefined);
}

export function subscribePty(
  id: string,
  onData: DataHandler,
  onExit: ExitHandler,
  controlled = false,
): () => void {
  retain();
  openedPtys.add(id);
  if (controlled) flowControlled.add(id);
  else flowControlled.delete(id);
  dataHandlers.set(id, onData);
  exitHandlers.set(id, onExit);
  const queued = dataBuffer.get(id);
  if (queued) {
    clearBuffered(id);
    for (const chunk of queued) onData(chunk);
  }
  return () => {
    const current = dataHandlers.get(id) === onData;
    if (current) dataHandlers.delete(id);
    if (exitHandlers.get(id) === onExit) exitHandlers.delete(id);
    if (controlled && current) {
      flowControlled.delete(id);
      void invoke("pty_output_flow", { id, enabled: false }).catch(() => {});
    }
    release();
  };
}
