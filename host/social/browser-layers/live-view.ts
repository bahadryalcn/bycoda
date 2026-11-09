import { hasControlCharacters } from "../../../src/shared/lib/controlCharacters";
import { sanitizeSocialError } from "../core/social-helpers";

/** The CDP session of one account's browser window, as the browser launcher exposes it. */
export type ScreencastPort = {
  sessionId: string;
  send<T = any>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(listener: (method: string, params: any, sessionId?: string) => void): () => void;
};

export type LiveViewFrame = { jpegBase64: string; width: number; height: number };

export type LiveViewOptions = {
  /** Accepted frames per second. */
  maxFps?: number;
  /** Largest accepted JPEG, in bytes. */
  maxFrameBytes?: number;
  /** The screencast stops after this long without a frame or input request. */
  idleStopMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

const MAX_TEXT = 1000;
const MAX_SCROLL = 2000;
const KEY_CODES: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Backspace: 8,
  Escape: 27,
  Delete: 46,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
};

type Watch = {
  port: ScreencastPort;
  running: boolean;
  frame?: LiveViewFrame;
  lastAcceptedAt: number;
  lastRequestAt: number;
  off: () => void;
  idleTimer?: unknown;
};

type Command = { method: string; params: Record<string, unknown> };

/**
 * Live view of one browser window: CDP screencast for display, and owner-driven pointer, text and key
 * events. Closing the view only stops the screencast; the browser keeps running. Input is accepted from
 * the owner RPC only and never from recipes or AI tools.
 */
export class LiveViewRegistry {
  private readonly watches = new Map<string, Watch>();
  private readonly maxFps: number;
  private readonly maxFrameBytes: number;
  private readonly idleStopMs: number;
  private readonly clock: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(options: LiveViewOptions = {}) {
    this.maxFps = options.maxFps ?? 2;
    this.maxFrameBytes = options.maxFrameBytes ?? 1024 * 1024;
    this.idleStopMs = options.idleStopMs ?? 10_000;
    this.clock = options.now ?? Date.now;
    this.setTimer =
      options.setTimer ??
      ((callback, ms) => {
        const handle = setTimeout(callback, ms);
        handle.unref?.();
        return handle;
      });
    this.clearTimer =
      options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** Called when a browser window is launched for the account. Returns a detach for when it closes. */
  attach(accountId: string, port: ScreencastPort): () => void {
    this.detachCurrent(accountId);
    const watch: Watch = {
      port,
      running: false,
      lastAcceptedAt: 0,
      lastRequestAt: this.clock(),
      off: () => undefined,
    };
    watch.off = port.on((method, params, sessionId) =>
      this.onEvent(watch, method, params, sessionId),
    );
    this.watches.set(accountId, watch);
    return () => this.detachWatch(accountId, watch);
  }

  /** One frame for the panel. Starts the screencast on first use and returns null until a frame arrives. */
  async frame(accountId: string): Promise<LiveViewFrame | null> {
    const watch = this.require(accountId);
    watch.lastRequestAt = this.clock();
    if (!watch.running) {
      await watch.port.send("Page.startScreencast", {
        format: "jpeg",
        quality: 60,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 1,
      });
      watch.running = true;
    }
    this.armIdle(accountId, watch);
    return watch.frame ?? null;
  }

  /** Owner input. Coordinates are frame pixels, checked against the last frame. */
  async input(accountId: string, event: unknown): Promise<void> {
    const watch = this.require(accountId);
    watch.lastRequestAt = this.clock();
    const commands = commandsFor(event, watch.frame);
    for (const command of commands) await watch.port.send(command.method, command.params);
  }

  /** Stops the screencast for an account, keeping the browser session. */
  async stop(accountId: string): Promise<void> {
    const watch = this.watches.get(accountId);
    if (!watch) return;
    this.clearIdle(watch);
    watch.frame = undefined;
    if (!watch.running) return;
    watch.running = false;
    await watch.port.send("Page.stopScreencast").catch(() => undefined);
  }

  private require(accountId: string): Watch {
    const watch = this.watches.get(accountId);
    if (!watch) throw new Error("No browser window is open for this account.");
    return watch;
  }

  private detachCurrent(accountId: string) {
    const current = this.watches.get(accountId);
    if (current) this.detachWatch(accountId, current);
  }

  private detachWatch(accountId: string, watch: Watch) {
    if (this.watches.get(accountId) !== watch) return;
    this.clearIdle(watch);
    watch.off();
    watch.frame = undefined;
    watch.running = false;
    this.watches.delete(accountId);
  }

  private clearIdle(watch: Watch) {
    if (watch.idleTimer !== undefined) this.clearTimer(watch.idleTimer);
    watch.idleTimer = undefined;
  }

  private armIdle(accountId: string, watch: Watch) {
    this.clearIdle(watch);
    watch.idleTimer = this.setTimer(() => {
      watch.idleTimer = undefined;
      if (this.clock() - watch.lastRequestAt >= this.idleStopMs)
        void this.stop(accountId).catch((error) =>
          console.error("Social live view idle stop failed:", sanitizeSocialError(error)),
        );
    }, this.idleStopMs);
  }

  private onEvent(watch: Watch, method: string, params: any, sessionId: string | undefined) {
    if (method !== "Page.screencastFrame") return;
    if (sessionId !== undefined && sessionId !== watch.port.sessionId) return;
    // Every frame is acknowledged, even dropped ones, or the browser stops sending them.
    void watch.port
      .send("Page.screencastFrameAck", { sessionId: params?.sessionId })
      .catch(() => undefined);
    if (!watch.running) return;
    const now = this.clock();
    if (now - watch.lastAcceptedAt < 1000 / this.maxFps) return;
    const data = params?.data;
    if (typeof data !== "string" || Math.floor((data.length * 3) / 4) > this.maxFrameBytes) return;
    const width = Number(params?.metadata?.deviceWidth);
    const height = Number(params?.metadata?.deviceHeight);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return;
    if (width > 10_000 || height > 10_000) return;
    watch.frame = { jpegBase64: data, width, height };
    watch.lastAcceptedAt = now;
  }
}

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Validates owner input and maps it to CDP commands. Anything outside these shapes is refused. */
export function commandsFor(event: unknown, frame: LiveViewFrame | undefined): Command[] {
  if (!event || typeof event !== "object") throw new Error("Live view input is invalid.");
  const value = event as Record<string, unknown>;
  if (value.type === "click") {
    if (!frame) throw new Error("Live view has no frame yet.");
    const { x, y } = value;
    if (!finite(x) || !finite(y) || x < 0 || y < 0 || x > frame.width || y > frame.height)
      throw new Error("Live view click is outside the page.");
    const button = value.button === "right" || value.button === "middle" ? value.button : "left";
    const point = { x, y, button, clickCount: 1 };
    return [
      { method: "Input.dispatchMouseEvent", params: { type: "mouseMoved", x, y, button: "none" } },
      { method: "Input.dispatchMouseEvent", params: { type: "mousePressed", ...point } },
      { method: "Input.dispatchMouseEvent", params: { type: "mouseReleased", ...point } },
    ];
  }
  if (value.type === "type") {
    const text = value.text;
    if (
      typeof text !== "string" ||
      text.length < 1 ||
      text.length > MAX_TEXT ||
      hasControlCharacters(text)
    )
      throw new Error("Live view text is invalid.");
    return [{ method: "Input.insertText", params: { text } }];
  }
  if (value.type === "key") {
    const key = value.key;
    if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(KEY_CODES, key))
      throw new Error("Live view key is not allowed.");
    const code = KEY_CODES[key]!;
    const text = key === "Enter" ? "\r" : undefined;
    return [
      {
        method: "Input.dispatchKeyEvent",
        params: {
          type: "keyDown",
          key,
          code: key,
          windowsVirtualKeyCode: code,
          ...(text ? { text } : {}),
        },
      },
      {
        method: "Input.dispatchKeyEvent",
        params: { type: "keyUp", key, code: key, windowsVirtualKeyCode: code },
      },
    ];
  }
  if (value.type === "scroll") {
    if (!frame) throw new Error("Live view has no frame yet.");
    const deltaY = value.deltaY;
    if (!finite(deltaY) || Math.abs(deltaY) > MAX_SCROLL)
      throw new Error("Live view scroll is invalid.");
    return [
      {
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseWheel", x: frame.width / 2, y: frame.height / 2, deltaX: 0, deltaY },
      },
    ];
  }
  throw new Error("Live view input type is not supported.");
}

/** Process-wide registry used by the browser launcher and the Social transport. */
export const liveViews = new LiveViewRegistry();

export async function liveViewFrame(accountId: string): Promise<LiveViewFrame | null> {
  return liveViews.frame(accountId);
}

export async function liveViewInput(accountId: string, event: unknown): Promise<void> {
  return liveViews.input(accountId, event);
}
