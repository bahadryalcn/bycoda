import { SocialBrowserLaunch, launchArgs } from "./social-browser-launch";
import type { BrowserVisibility } from "./browser-layers/types";
import type { ScreencastPort } from "./browser-layers/live-view";
import { existsSync, watch } from "node:fs";
import { waitForProfileUnlock } from "../security/profile-unlock";
import { lstat, open, readFile, rm } from "node:fs/promises";
import { join, win32 } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { SocialPlatformError } from "../../src/integrations/social/adapter";

const BROWSER_RESPONSE_ORIGINS = [
  "https://x.com",
  "https://api.x.com",
  "https://www.instagram.com",
  "https://www.facebook.com",
  "https://www.linkedin.com",
  "https://www.youtube.com",
  "https://studio.youtube.com",
  "https://www.tiktok.com",
  "https://web.snapchat.com",
  "https://www.snapchat.com",
  "https://profile.snapchat.com",
  "https://my.snapchat.com",
  "https://web.whatsapp.com",
  "https://web.telegram.org",
];

/** Minimal page surface used by the X browser-session flows; mocked in tests. */
export interface BrowserPage {
  goto(url: string): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  click(selector: string): Promise<void>;
  insertText(text: string): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  setFiles(selector: string, files: string[]): Promise<void>;
  /** Starts capturing the first response whose URL path matches before the action that causes it. */
  watchResponse(
    path: RegExp,
    acceptBody?: (body: string) => boolean,
  ): {
    body(timeoutMs: number): Promise<string | undefined>;
    stop(): void;
  };
  cookies(urls?: readonly string[]): Promise<{ name: string; value: string }[]>;
  screenshot?(): Promise<Uint8Array>;
}
export interface BrowserSession {
  page: BrowserPage;
  closed: Promise<void>;
  close(): Promise<void>;
  /** After close, resolves only once the persistent profile is available again. */
  profileReleased?(): Promise<void>;
  screencast?: ScreencastPort;
}
/** Hidden background execution uses Chrome's current headless engine without a desktop window. */
export type BrowserLauncher = (
  profile: string,
  background: boolean,
  visibility?: BrowserVisibility,
) => Promise<BrowserSession>;

/**
 * A plain, non-automated browser window for the owner's login. Google and X block or
 * flag sign-in in debugger-controlled browsers, so login never uses CDP.
 */
export type PlainBrowserLauncher = (
  profile: string,
  url: string,
) => Promise<{ closed: Promise<void>; close(): Promise<void> }>;

export function findBrowser(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  if (env.BYCODA_SOCIAL_BROWSER)
    return exists(env.BYCODA_SOCIAL_BROWSER) ? env.BYCODA_SOCIAL_BROWSER : undefined;
  const programs = env.ProgramFiles ?? "C:\\Program Files";
  const programs86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const candidates =
    platform === "win32"
      ? [
          win32.join(programs, "Google\\Chrome\\Application\\chrome.exe"),
          win32.join(programs86, "Google\\Chrome\\Application\\chrome.exe"),
          ...(env.LOCALAPPDATA
            ? [win32.join(env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe")]
            : []),
          win32.join(programs86, "Microsoft\\Edge\\Application\\msedge.exe"),
          win32.join(programs, "Microsoft\\Edge\\Application\\msedge.exe"),
        ]
      : platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
          ];
  return candidates.find((candidate) => exists(candidate));
}

type CdpListener = (method: string, params: any, sessionId?: string) => void;
/** Chrome DevTools Protocol over Node's built-in WebSocket; no browser download or driver package. */
export class Cdp {
  private next = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Set<CdpListener>();
  readonly closed: Promise<void>;
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) {
        for (const listener of this.listeners)
          listener(message.method, message.params, message.sessionId);
        return;
      }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result ?? {});
    });
    this.closed = new Promise((resolve) =>
      socket.addEventListener("close", () => {
        for (const waiter of this.pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error("Browser closed."));
        }
        this.pending.clear();
        resolve();
      }),
    );
  }
  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {}
        reject(new Error("Browser debugging connection timed out."));
      }, 10_000);
      timer.unref();
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Browser debugging connection failed."));
        },
        { once: true },
      );
    });
    return new Cdp(socket);
  }
  send<T = any>(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<T> {
    const id = ++this.next;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Browser command timed out."));
      }, 30_000);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params, sessionId }));
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("Browser command could not be sent."));
      }
    });
  }
  on(listener: CdpListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close() {
    this.socket.close();
  }
}

/** Whether a browser still holds the profile (it outlives launchers that hand off). */
async function profileInUse(profile: string): Promise<boolean> {
  if (process.platform === "win32") {
    try {
      // Chromium keeps `lockfile` open without sharing while the profile is in use.
      await (await open(join(profile, "lockfile"), "r+")).close();
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== "ENOENT";
    }
  }
  return lstat(join(profile, "SingletonLock")).then(
    () => true,
    (error: NodeJS.ErrnoException) => error.code !== "ENOENT",
  );
}

function profileUnlock(profile: string, exited: Promise<void>) {
  return waitForProfileUnlock(
    {
      inUse: () => profileInUse(profile),
      observe: (changed, failed) => {
        const original = watch(profile, { persistent: false }, (_type, name) => {
          if (!name || ["SingletonLock", "lockfile"].includes(name.toString())) changed();
        });
        original.on("error", failed);
        return () => original.close();
      },
    },
    exited,
  );
}

export function systemPlainLauncher(executable = findBrowser()): PlainBrowserLauncher | undefined {
  if (!executable) return undefined;
  return async (profile, url) => {
    const original = await SocialBrowserLaunch.reserve(profile, { inUse: profileInUse });
    try {
      await original.start(executable, [
        `--user-data-dir=${original.profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--new-window",
        url,
      ]);
      original.markEstablished();
      const closed = (async () => {
        await sleep(2000);
        await original.exit;
        await original.releaseProfile(() => profileUnlock(original.profile, original.exit));
      })().catch(() => new Promise<void>(() => {})); // Unknown retirement is not a closed window.
      return {
        closed,
        async close() {
          await original.stop();
          await Promise.race([closed, sleep(5000)]);
        },
      };
    } catch (error) {
      await original.startupFailed(() => profileUnlock(original.profile, original.exit));
      throw error;
    }
  };
}

/** Launches system Chrome/Edge on a dedicated profile owned by this host. */
export function systemBrowserLauncher(executable = findBrowser()): BrowserLauncher | undefined {
  if (!executable) return undefined;
  return async (profile, background, visibility = "hidden") => {
    const hidden = background && visibility === "hidden";
    const original = await SocialBrowserLaunch.reserve(profile, { inUse: profileInUse });
    const portFile = join(original.profile, "DevToolsActivePort");
    let cdp: Cdp | undefined;
    let released: Promise<void> | undefined;
    const releaseProfile = () =>
      (released ??= original.releaseProfile(() => profileUnlock(original.profile, original.exit)));
    try {
      await rm(portFile, { force: true });
      await original.start(executable, [
        `--user-data-dir=${original.profile}`,
        "--remote-debugging-port=0",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--disable-blink-features=AutomationControlled",
        "--window-size=1100,860",
        ...launchArgs(background ? visibility : "visible"),
        "about:blank",
      ]);
      let endpoint: string | undefined;
      for (let attempt = 0; attempt < 100 && !endpoint && !original.failed; attempt++) {
        const [port, path] = (await readFile(portFile, "utf8").catch(() => ""))
          .split(/\r?\n/)
          .map((line) => line.trim());
        if (
          /^\d+$/.test(port ?? "") &&
          Number(port) > 0 &&
          Number(port) <= 65535 &&
          /^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(path ?? "")
        )
          endpoint = `ws://127.0.0.1:${port}${path}`;
        if (!endpoint) await sleep(200);
      }
      if (!endpoint) throw new Error("The original browser did not expose its debugging endpoint.");
      cdp = await Cdp.connect(endpoint);
      const connected = cdp;
      const close = async () => {
        await Promise.race([connected.send("Browser.close").catch(() => undefined), sleep(3000)]);
        // Preserve graceful cookie flushing before requesting exact owned retirement.
        await Promise.race([
          original.exit,
          connected.closed.then(() => sleep(2000)),
          sleep(15_000),
        ]);
        connected.close();
        try {
          await original.stop();
        } finally {
          void releaseProfile().catch(() => {});
        }
      };
      const { targetInfos } = await connected.send<{
        targetInfos: { targetId: string; type: string }[];
      }>("Target.getTargets");
      const target =
        targetInfos.find((info) => info.type === "page")?.targetId ??
        (await connected.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" }))
          .targetId;
      const { sessionId } = await connected.send<{ sessionId: string }>("Target.attachToTarget", {
        targetId: target,
        flatten: true,
      });
      const send = <T = any>(method: string, params?: Record<string, unknown>) =>
        connected.send<T>(method, params, sessionId);
      await send("Page.enable");
      await send("Network.enable");
      if (hidden)
        await send("Emulation.setDeviceMetricsOverride", {
          width: 1100,
          height: 860,
          deviceScaleFactor: 1,
          mobile: false,
        });
      // Closing the window may leave the browser running in the background, so
      // the page target going away also counts as closed.
      const closed = new Promise<void>((resolve) => {
        void connected.closed.then(resolve);
        connected.on((method, params) => {
          if (
            (method === "Target.detachedFromTarget" && params.sessionId === sessionId) ||
            (method === "Target.targetDestroyed" && params.targetId === target)
          )
            resolve();
        });
      });
      await connected.send("Target.setDiscoverTargets", { discover: true });
      original.markEstablished();
      return {
        page: cdpPage(connected, sessionId, send),
        screencast: { sessionId, send, on: (listener) => connected.on(listener) },
        closed,
        close,
        profileReleased() {
          return releaseProfile();
        },
      };
    } catch (error) {
      cdp?.close();
      try {
        await original.startupFailed(() => profileUnlock(original.profile, original.exit));
      } catch (cleanup) {
        throw new Error(
          "Browser startup cleanup is unconfirmed; its original profile remains reserved.",
          { cause: cleanup },
        );
      }
      throw error;
    }
  };
}

export function cdpPage(
  cdp: Cdp,
  sessionId: string,
  send: <T = any>(method: string, params?: Record<string, unknown>) => Promise<T>,
): BrowserPage {
  const evaluate = async <T>(expression: string): Promise<T> => {
    const result = await send<{
      result: { value?: T };
      exceptionDetails?: unknown;
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error("Page script failed.");
    return result.result.value as T;
  };
  return {
    async goto(url) {
      await send("Page.navigate", { url });
    },
    evaluate,
    screenshot: async () =>
      Buffer.from(
        (await send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 60 }))
          .data,
        "base64",
      ),
    async click(selector) {
      const point = await evaluate<{ x: number; y: number } | null>(
        `(() => { const matches = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden"); if (matches.length !== 1) return null; const element = matches[0]; if (element.disabled || element.getAttribute("aria-disabled") === "true") return null; element.scrollIntoView({ block: "center" }); const box = element.getBoundingClientRect(); const x = box.x + box.width / 2, y = box.y + box.height / 2; const hit = document.elementFromPoint(x, y); return hit && element.contains(hit) ? { x, y } : null; })()`,
      );
      if (!point) throw new Error("Page element is missing.");
      // Trusted input events; X ignores many synthetic DOM clicks.
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await send("Input.dispatchMouseEvent", {
          type,
          x: point.x,
          y: point.y,
          button: "left",
          clickCount: 1,
        });
    },
    async insertText(text) {
      await send("Input.insertText", { text });
    },
    async fill(selector, text) {
      await this.click(selector);
      const modifiers = process.platform === "darwin" ? 4 : 2;
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        modifiers,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        modifiers,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8,
      });
      await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Backspace",
        code: "Backspace",
        windowsVirtualKeyCode: 8,
      });
      if (text) await send("Input.insertText", { text });
    },
    async setFiles(selector, files) {
      const { root } = await send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 0 });
      const { nodeId } = await send<{ nodeId: number }>("DOM.querySelector", {
        nodeId: root.nodeId,
        selector,
      });
      if (!nodeId) throw new Error("File input is missing.");
      await send("DOM.setFileInputFiles", { nodeId, files });
    },
    watchResponse(path, acceptBody) {
      const requests = new Set<string>();
      let settled = false;
      let resolve!: (body: string | undefined) => void;
      const result = new Promise<string | undefined>((done) => {
        resolve = done;
      });
      const finish = (body: string | undefined) => {
        if (settled) return;
        settled = true;
        resolve(body);
      };
      const unsubscribe = cdp.on((method, params, source) => {
        if (source !== sessionId || settled) return;
        if (method === "Network.responseReceived" && requests.size < 16) {
          let url: URL;
          try {
            url = new URL(params.response.url);
          } catch {
            return;
          }
          path.lastIndex = 0;
          if (BROWSER_RESPONSE_ORIGINS.includes(url.origin) && path.test(url.pathname))
            requests.add(params.requestId);
        }
        if (method === "Network.loadingFinished" && requests.delete(params.requestId)) {
          if (params.encodedDataLength > 8 * 1024 * 1024) return;
          void send<{ body: string; base64Encoded: boolean }>("Network.getResponseBody", {
            requestId: params.requestId,
          }).then(
            (value) => {
              if (settled || value.body.length > 12 * 1024 * 1024) return;
              const body = value.base64Encoded
                ? Buffer.from(value.body, "base64").toString("utf8")
                : value.body;
              try {
                if (!acceptBody || acceptBody(body)) finish(body);
              } catch {
                /* Unknown envelope: continue waiting. */
              }
            },
            () => {
              if (!acceptBody) finish(undefined);
            },
          );
        }
        if (method === "Network.loadingFailed" && requests.delete(params.requestId) && !acceptBody)
          finish(undefined);
      });
      const stop = () => {
        unsubscribe();
        requests.clear();
        finish(undefined);
      };
      void cdp.closed.then(stop);
      return {
        async body(timeoutMs) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              result,
              new Promise<undefined>((done) => {
                timer = setTimeout(() => done(undefined), timeoutMs);
              }),
            ]);
          } finally {
            clearTimeout(timer);
            stop();
          }
        },
        stop,
      };
    },
    async cookies(urls = ["https://x.com"]) {
      if (!urls.length || urls.some((url) => !BROWSER_RESPONSE_ORIGINS.includes(url)))
        throw new SocialPlatformError("denied");
      const { cookies } = await send<{
        cookies: { name: string; value: string }[];
      }>("Network.getCookies", { urls: [...urls] });
      return cookies;
    },
  };
}

// The X session class lives in social-browser-x.ts; re-exported for existing importers.
export { XBrowserSessions } from "./social-browser-x";
