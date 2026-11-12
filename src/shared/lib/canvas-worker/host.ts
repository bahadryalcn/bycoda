import { CANVAS_PROTOCOL, type CanvasReply, type CanvasRequest, type CanvasSize } from "./types";

const enabled = new Set<string>();
const listeners = new Set<() => void>();
let generation = 0;
const transferred = new WeakSet<HTMLCanvasElement>();
/** Explicit developer/test hook; no persisted preference and no render-time storage reads. */
export function setCanvasWorkerEnabled(rendererId: string, value: boolean): void {
  if (value) enabled.add(rendererId);
  else enabled.delete(rendererId);
  for (const listener of listeners) listener();
}
export function subscribeCanvasWorkerEnabled(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function canvasWorkerEnabled(rendererId: string): boolean {
  return enabled.has(rendererId);
}

type Pending = {
  timer: ReturnType<typeof setTimeout>;
  complete: (reply: CanvasReply | null) => void;
};
/** One host owns one fresh transferable element. Scheduling remains with its caller. */
export function createCanvasWorkerHost<Frame>(options: {
  canvas: HTMLCanvasElement;
  size: CanvasSize;
  createWorker: () => Worker;
  onReady: () => void;
  onDrawn?: (sequence: number) => void;
  onFailure: (reason: string) => void;
  deadlineMs?: number;
  assets?: unknown;
  prepareFrame?: (frame: Frame) => { frame: Frame; transfer: Transferable[]; release?: () => void };
}) {
  const id = ++generation;
  const deadline = options.deadlineMs ?? 2000;
  let state: "probing" | "initializing" | "ready" | "failed" | "disposing" | "disposed" = "probing";
  let worker: Worker | undefined;
  let size = options.size;
  let sequence = 0;
  let stageTimer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<number, Pending>();
  const clearPending = () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.complete(null);
    }
    pending.clear();
  };
  const terminate = () => {
    clearTimeout(stageTimer);
    clearPending();
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = undefined;
    }
  };
  const fail = (reason: string) => {
    if (state === "failed" || state === "disposed" || state === "disposing") return;
    state = "failed";
    terminate();
    options.onFailure(reason);
  };
  const send = (message: CanvasRequest<Frame>, transfer: Transferable[] = []) => {
    try {
      worker?.postMessage(message, transfer);
      return true;
    } catch {
      fail("postMessage failed");
      return false;
    }
  };
  const envelope = { version: CANVAS_PROTOCOL, generation: id } as const;
  const receive = (event: MessageEvent<CanvasReply>) => {
    const reply = event.data;
    if (reply.version !== CANVAS_PROTOCOL || reply.generation !== id) return;
    if (state === "disposing") {
      if (reply.type === "disposed") {
        state = "disposed";
        terminate();
      }
      return;
    }
    if (state === "failed" || state === "disposed") return;
    if (reply.type === "error") {
      fail(reply.reason);
      return;
    }
    if (reply.type === "capabilities" && state === "probing") {
      state = "initializing";
      try {
        if (transferred.has(options.canvas)) throw new Error("Canvas already transferred");
        transferred.add(options.canvas);
        const canvas = options.canvas.transferControlToOffscreen();
        send(
          {
            ...envelope,
            type: "init",
            canvas,
            size,
            ...(options.assets === undefined ? {} : { assets: options.assets }),
          },
          [canvas],
        );
      } catch {
        fail("Canvas transfer failed");
      }
    } else if (reply.type === "ready" && state === "initializing") {
      clearTimeout(stageTimer);
      state = "ready";
      options.onReady();
    } else if (state === "ready" && (reply.type === "drawn" || reply.type === "captured")) {
      const item = pending.get(reply.sequence);
      if (!item) return;
      pending.delete(reply.sequence);
      clearTimeout(item.timer);
      item.complete(reply);
      if (reply.type === "drawn") options.onDrawn?.(reply.sequence);
    }
  };
  const request = (
    type: "draw" | "capture",
    frame: Frame | undefined,
    complete: Pending["complete"],
  ) => {
    if (state !== "ready") {
      complete(null);
      return 0;
    }
    if (pending.size >= 32) {
      fail("Canvas queue overflow");
      complete(null);
      return 0;
    }
    const next = ++sequence;
    const timer = setTimeout(() => fail("Canvas paint timeout"), deadline);
    pending.set(next, { timer, complete });
    if (type === "draw") {
      try {
        const prepared = options.prepareFrame?.(frame!);
        if (
          !send(
            { ...envelope, type, sequence: next, frame: prepared?.frame ?? frame! },
            prepared?.transfer,
          )
        )
          prepared?.release?.();
      } catch {
        fail("Frame preparation failed");
      }
    } else send({ ...envelope, type, sequence: next });
    return next;
  };
  const api = {
    abort(reason: string) {
      fail(reason);
    },
    start() {
      if (worker || state !== "probing") return;
      if (typeof OffscreenCanvas === "undefined" || !options.canvas.transferControlToOffscreen) {
        fail("OffscreenCanvas unavailable");
        return;
      }
      try {
        worker = options.createWorker();
        worker.onmessage = receive;
        worker.onerror = () => fail("Worker error");
        worker.onmessageerror = () => fail("Worker message error");
        stageTimer = setTimeout(() => fail("Canvas init timeout"), deadline);
        send({ ...envelope, type: "probe" });
      } catch {
        fail("Worker constructor failed");
      }
    },
    resize(next: CanvasSize) {
      size = next;
      if (state === "ready" || state === "initializing")
        send({ ...envelope, type: "resize", size });
    },
    draw(frame: Frame, complete: Pending["complete"] = () => {}) {
      return request("draw", frame, complete);
    },
    capture(complete: Pending["complete"]) {
      return request("capture", undefined, complete);
    },
    dispose() {
      if (state === "disposed" || state === "disposing") return;
      if (!worker) {
        state = "disposed";
        terminate();
        return;
      }
      state = "disposing";
      clearTimeout(stageTimer);
      clearPending();
      stageTimer = setTimeout(() => {
        state = "disposed";
        terminate();
      }, 100);
      try {
        worker.postMessage({ ...envelope, type: "dispose" });
      } catch {
        state = "disposed";
        terminate();
      }
    },
  };
  return api;
}
