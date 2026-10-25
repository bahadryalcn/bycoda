import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { join, win32 } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type {
  SocialAccount,
  SocialJob,
  SocialMonitorChannel,
} from "../src/features/social/model/social";
import {
  SocialPlatformError,
  type SocialAdapter,
  type SocialSendResult,
} from "../src/integrations/social/adapter";
import {
  parseXBrowserInbox,
  parseXBrowserMentions,
  parseXBrowserMessageSent,
} from "./social-browser-inbound";
import { X_BROWSER_SCOPES } from "../src/integrations/social/capabilities";
import { xMediaFormat, xMediaIssue } from "../src/integrations/social/xMedia";
import type { SocialPrincipal, SocialService } from "./social";
import { SocialBrowserWorkflows } from "./social-browser-workflows";
import type { SocialBrowserIntent } from "../src/features/social/model/socialBrowser";
import { XProfileActions, parseXProfilePatch } from "./social-browser-profile";

/** Minimal page surface used by the X browser-session flows; mocked in tests. */
export interface BrowserPage {
  goto(url: string): Promise<void>;
  evaluate<T>(expression: string): Promise<T>;
  click(selector: string): Promise<void>;
  insertText(text: string): Promise<void>;
  fill(selector: string, text: string): Promise<void>;
  setFiles(selector: string, files: string[]): Promise<void>;
  /** Starts capturing the first response whose URL path matches before the action that causes it. */
  watchResponse(path: RegExp): {
    body(timeoutMs: number): Promise<string | undefined>;
    stop(): void;
  };
  cookies(): Promise<{ name: string; value: string }[]>;
}
export interface BrowserSession {
  page: BrowserPage;
  closed: Promise<void>;
  close(): Promise<void>;
}
/** `background` starts a real, minimized window: headless mode is easier for X to flag. */
export type BrowserLauncher = (profile: string, background: boolean) => Promise<BrowserSession>;

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
    () => false,
  );
}

export function systemPlainLauncher(executable = findBrowser()): PlainBrowserLauncher | undefined {
  if (!executable) return undefined;
  return async (profile, url) => {
    await mkdir(profile, { recursive: true });
    const child = spawn(
      executable,
      [
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        "--new-window",
        url,
      ],
      { stdio: "ignore", windowsHide: false, shell: false },
    );
    let exited = false;
    child.once("exit", () => {
      exited = true;
    });
    child.once("error", () => {
      exited = true;
    });
    const closed = (async () => {
      await sleep(2000);
      while (!exited || (await profileInUse(profile))) await sleep(1000);
    })();
    return {
      closed,
      async close() {
        if (!exited) child.kill();
        await Promise.race([closed, sleep(5000)]);
      },
    };
  };
}

/** Launches system Chrome/Edge on a dedicated profile owned by this host. */
export function systemBrowserLauncher(executable = findBrowser()): BrowserLauncher | undefined {
  if (!executable) return undefined;
  return async (profile, background) => {
    await mkdir(profile, { recursive: true });
    const portFile = join(profile, "DevToolsActivePort");
    await rm(portFile, { force: true });
    const child = spawn(
      executable,
      [
        `--user-data-dir=${profile}`,
        "--remote-debugging-port=0",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-sync",
        // Remote debugging otherwise exposes navigator.webdriver to every page.
        "--disable-blink-features=AutomationControlled",
        "--window-size=1100,860",
        ...(background
          ? [
              "--start-minimized",
              "--disable-renderer-backgrounding",
              "--disable-backgrounding-occluded-windows",
            ]
          : []),
        "about:blank",
      ],
      { stdio: "ignore", windowsHide: false, shell: false },
    );
    // Edge/Chrome launchers may exit at once and hand off to a browser process;
    // only a spawn error proves the browser never started.
    let exited = false;
    let failed = false;
    const exit = new Promise<void>((resolve) =>
      child.once("exit", () => {
        exited = true;
        resolve();
      }),
    );
    child.once("error", () => {
      failed = true;
    });
    let endpoint: string | undefined;
    for (let attempt = 0; attempt < 100 && !endpoint && !failed; attempt++) {
      await sleep(200);
      const [port, path] = (await readFile(portFile, "utf8").catch(() => ""))
        .split(/\r?\n/)
        .map((line) => line.trim());
      if (port && path) endpoint = `ws://127.0.0.1:${port}${path}`;
    }
    if (!endpoint) {
      child.kill();
      throw new Error(
        "The browser did not start. Close any window still using the bycoda X profile and try again.",
      );
    }
    let cdp: Cdp;
    try {
      cdp = await Cdp.connect(endpoint);
    } catch (error) {
      child.kill();
      throw error;
    }
    const close = async () => {
      // An already-exited browser never answers; never let close block the profile lock.
      await Promise.race([cdp.send("Browser.close").catch(() => undefined), sleep(3000)]);
      // Chrome writes new cookies (the X login) to disk during a graceful shutdown;
      // killing it early loses them. Wait for the browser to exit by itself first.
      await Promise.race([exit, cdp.closed.then(() => sleep(2000)), sleep(15_000)]);
      cdp.close();
      if (!exited) child.kill();
    };
    try {
      const { targetInfos } = await cdp.send<{
        targetInfos: { targetId: string; type: string }[];
      }>("Target.getTargets");
      const target =
        targetInfos.find((info) => info.type === "page")?.targetId ??
        (
          await cdp.send<{ targetId: string }>("Target.createTarget", {
            url: "about:blank",
          })
        ).targetId;
      const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
        targetId: target,
        flatten: true,
      });
      const send = <T = any>(method: string, params?: Record<string, unknown>) =>
        cdp.send<T>(method, params, sessionId);
      await send("Page.enable");
      await send("Network.enable");
      // Closing the window may leave the browser running in the background, so
      // the page target going away also counts as closed.
      const closed = new Promise<void>((resolve) => {
        void cdp.closed.then(resolve);
        cdp.on((method, params) => {
          if (
            (method === "Target.detachedFromTarget" && params.sessionId === sessionId) ||
            (method === "Target.targetDestroyed" && params.targetId === target)
          )
            resolve();
        });
      });
      await cdp.send("Target.setDiscoverTargets", { discover: true });
      return { page: cdpPage(cdp, sessionId, send), closed, close };
    } catch (error) {
      await close();
      throw error;
    }
  };
}

function cdpPage(
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
    watchResponse(path) {
      let requestId: string | undefined;
      let resolve!: (body: string | undefined) => void;
      const result = new Promise<string | undefined>((done) => {
        resolve = done;
      });
      const stop = cdp.on((method, params, source) => {
        if (source !== sessionId) return;
        if (
          method === "Network.responseReceived" &&
          !requestId &&
          ["https://x.com", "https://api.x.com"].includes(new URL(params.response.url).origin) &&
          path.test(new URL(params.response.url).pathname)
        )
          requestId = params.requestId;
        if (method === "Network.loadingFinished" && params.requestId === requestId)
          void send<{ body: string; base64Encoded: boolean }>("Network.getResponseBody", {
            requestId,
          }).then(
            (value) =>
              resolve(
                value.base64Encoded
                  ? Buffer.from(value.body, "base64").toString("utf8")
                  : value.body,
              ),
            () => resolve(undefined),
          );
        if (method === "Network.loadingFailed" && params.requestId === requestId)
          resolve(undefined);
      });
      void cdp.closed.then(() => resolve(undefined));
      return {
        async body(timeoutMs) {
          const timer = sleep(timeoutMs).then(() => undefined);
          try {
            return await Promise.race([result, timer]);
          } finally {
            stop();
          }
        },
        stop,
      };
    },
    async cookies() {
      const { cookies } = await send<{
        cookies: { name: string; value: string }[];
      }>("Network.getCookies", { urls: ["https://x.com"] });
      return cookies;
    },
  };
}

export function xUserId(cookies: { name: string; value: string }[]): string | undefined {
  if (!cookies.some((cookie) => cookie.name === "auth_token" && cookie.value)) return undefined;
  const twid = cookies.find((cookie) => cookie.name === "twid")?.value;
  if (!twid) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(twid).replaceAll('"', "");
  } catch {
    return undefined;
  }
  return /^u=(\d{1,25})$/.exec(decoded)?.[1];
}

/** Parses X web CreateTweet/CreateNoteTweet responses. Only an explicit error body proves no post was made. */
export function parseCreateTweet(raw: string, now = Date.now()): SocialSendResult {
  let value: any;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new SocialPlatformError("unknown");
  }
  const id = (value?.data?.create_tweet ?? value?.data?.notetweet_create)?.tweet_results?.result
    ?.rest_id;
  if (typeof id === "string" && /^\d{1,25}$/.test(id))
    return { platformId: id, url: `https://x.com/i/status/${id}` };
  const codes: number[] = Array.isArray(value?.errors)
    ? value.errors.map((error: { code?: unknown }) => Number(error?.code))
    : [];
  if (codes.includes(88) || codes.includes(185) || codes.includes(344))
    throw new SocialPlatformError("rate_limit", now + 60 * 60_000);
  if ([32, 64, 89, 326].some((code) => codes.includes(code)))
    throw new SocialPlatformError("denied");
  if (codes.length) throw new SocialPlatformError("rejected");
  throw new SocialPlatformError("unknown");
}

const EDITOR = '[data-testid="tweetTextarea_0"]';
const FILE_INPUT = 'input[data-testid="fileInput"]';
const LOGIN_PATH = /^\/(login|logout|i\/flow\/login|i\/flow\/signup)/;
const MIN_SEND_GAP = 30_000;
const LOGIN_TIMEOUT = 10 * 60_000;
type LoginFlow = {
  status: "waiting" | "connected" | "failed";
  error?: string;
  expiresAt: number;
  cancelled?: boolean;
  session?: { close(): Promise<void> };
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * X connection through the owner's own logged-in web session instead of the paid API.
 * The persistent profile is the credential: it stays in the host data directory and never
 * reaches the renderer, session tools or logs. Every operation on a profile is serialized.
 */
export class XBrowserSessions {
  readonly workflows: SocialBrowserWorkflows;
  private locks = new Map<string, Promise<unknown>>();
  private logins = new Map<string, LoginFlow>();
  private lastSend = new Map<string, number>();
  constructor(
    private readonly directory: string,
    private readonly launcher: BrowserLauncher | undefined = systemBrowserLauncher(),
    private readonly now = Date.now,
    private readonly wait: (ms: number) => Promise<unknown> = sleep,
    private readonly background = process.env.BYCODA_SOCIAL_BROWSER_HEADED !== "1",
    private readonly plain: PlainBrowserLauncher | undefined = systemPlainLauncher(),
  ) {
    this.workflows = new SocialBrowserWorkflows(
      plain,
      (account) =>
        account.platform === "x"
          ? this.profile(account.id)
          : this.profile(account.id, "browser-profiles"),
      (id, action) => this.exclusive(id, action),
      now,
      wait,
    );
  }
  async workflowBegin(
    service: SocialService,
    p: SocialPrincipal,
    accountId: string,
    intent: SocialBrowserIntent,
    targetUrl: unknown,
    acknowledgeRisk: unknown,
  ) {
    if (this.logins.get(accountId)?.status === "waiting")
      throw new Error("Finish or cancel the account's current login first.");
    return await this.workflows.begin(service, p, {
      accountId,
      intent,
      targetUrl,
      acknowledgeRisk,
    });
  }
  availability() {
    return this.launcher
      ? { available: true, reason: "Google Chrome or Microsoft Edge found." }
      : {
          available: false,
          reason:
            "Install Microsoft Edge or Google Chrome on this host, or set BYCODA_SOCIAL_BROWSER.",
        };
  }
  async profileAction(
    service: SocialService,
    p: SocialPrincipal,
    accountId: string,
    action: "read" | "update" | "follow",
    input: Record<string, unknown>,
  ) {
    const account = await service.accountForBrowserManagement(p, accountId, action !== "read");
    const check = async () => {
      const current = await service.accountForBrowserManagement(p, accountId, action !== "read");
      if (
        current.platform !== "x" ||
        current.connection !== "browser" ||
        !current.connected ||
        current.paused ||
        current.platformId !== account.platformId ||
        current.executorId !== service.store.environmentId
      )
        throw new SocialPlatformError("denied");
      if (this.workflows.hasActive(accountId) || this.logins.get(accountId)?.status === "waiting")
        throw new Error("Finish the account's active browser operation first.");
    };
    await check();
    if (!this.launcher) throw new SocialPlatformError("unsupported");
    if (
      action !== "read" &&
      input.confirm !== (action === "follow" ? "FOLLOW_X_ACCOUNT" : "UPDATE_X_PROFILE")
    )
      throw new Error("Explicit profile action confirmation required.");
    const patch = action === "update" ? parseXProfilePatch(input.patch) : undefined;
    if (
      action === "follow" &&
      (typeof input.handle !== "string" || !/^[A-Za-z0-9_]{1,15}$/.test(input.handle))
    )
      throw new Error("Enter an exact X username.");
    return this.exclusive(accountId, async () => {
      await check();
      const staging = join(this.directory, "x-profile-uploads", randomUUID());
      let session: BrowserSession | undefined;
      try {
        const files: { avatar?: string; banner?: string } = {};
        for (const kind of ["avatar", "banner"] as const) {
          const id = patch?.[kind === "avatar" ? "avatarUploadId" : "bannerUploadId"];
          if (!id) continue;
          const bytes = await service.readOwnerMedia(p, id);
          const format = xMediaFormat(bytes);
          if (format === "mp4") throw new SocialPlatformError("rejected");
          await mkdir(staging, { recursive: true, mode: 0o700 });
          files[kind] = join(staging, `${kind}.${format}`);
          await writeFile(files[kind]!, bytes, { mode: 0o600, flag: "wx" });
        }
        session = await this.launcher!(this.profile(accountId), this.background);
        const page = session.page;
        const actions = new XProfileActions(
          page,
          async () => {
            await check();
            await this.identity(page, account);
          },
          async (expression, timeout) => await this.until(page, expression, timeout),
        );
        return action === "read"
          ? await actions.read()
          : action === "update"
            ? await actions.update(patch!, files)
            : await actions.follow(input.handle as string);
      } finally {
        await session?.close().catch(() => undefined);
        await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }
  private profile(accountId: string, folder = "x-browser") {
    if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new Error("Invalid social account.");
    return join(this.directory, folder, accountId);
  }
  private exclusive<T>(accountId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(accountId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    const settled = next.catch(() => undefined);
    this.locks.set(accountId, settled);
    void settled.then(() => {
      if (this.locks.get(accountId) === settled) this.locks.delete(accountId);
    });
    return next;
  }
  async begin(
    service: SocialService,
    p: SocialPrincipal,
    accountId: string,
    acknowledgeRisk: unknown,
  ): Promise<{ status: LoginFlow["status"]; expiresAt: number }> {
    if (acknowledgeRisk !== true)
      throw new Error(
        "Confirm that browser-session mode is unofficial and can restrict the X account.",
      );
    const account = await service.accountForOAuth(p, accountId);
    if (this.workflows.hasActive(accountId))
      throw new Error(
        "Close or cancel the account's browser workflow before verifying its connection.",
      );
    if (account.platform !== "x")
      throw new Error("Browser-session connection is only available for X.");
    // The profile must live on the host that executes this account's sends.
    if (account.executorId !== service.store.environmentId)
      throw new Error(
        "Log in on the account's executor host; its browser profile is used for sending.",
      );
    const launcher = this.launcher;
    if (!launcher) throw new Error(this.availability().reason);
    const current = this.logins.get(accountId);
    if (current?.status === "waiting")
      return { status: current.status, expiresAt: current.expiresAt };
    const flow: LoginFlow = {
      status: "waiting",
      expiresAt: this.now() + LOGIN_TIMEOUT,
    };
    this.logins.set(accountId, flow);
    void this.exclusive(
      accountId,
      async () => await this.login(service, launcher, account, flow),
    ).catch((error) => {
      flow.status = "failed";
      flow.error = message(error);
    });
    return { status: flow.status, expiresAt: flow.expiresAt };
  }
  async status(service: SocialService, p: SocialPrincipal, accountId: string) {
    await service.accountForOAuth(p, accountId);
    const flow = this.logins.get(accountId);
    return flow ? { status: flow.status, error: flow.error } : { status: "idle" as const };
  }
  private async login(
    service: SocialService,
    launcher: BrowserLauncher,
    account: SocialAccount,
    flow: LoginFlow,
  ) {
    if (flow.cancelled) throw new Error("X login was cancelled.");
    if (!this.plain) throw new Error(this.availability().reason);
    const profile = this.profile(account.id);
    const window = await this.plain(profile, "https://x.com/login");
    flow.session = window;
    let closed = false;
    void window.closed.then(() => {
      closed = true;
    });
    try {
      while (!closed) {
        if (flow.cancelled) throw new Error("X login was cancelled.");
        if (this.now() > flow.expiresAt) throw new Error("X login timed out. Try again.");
        await this.wait(1000);
      }
    } finally {
      delete flow.session;
      if (!closed) await window.close().catch(() => undefined);
    }
    if (flow.cancelled) throw new Error("X login was cancelled.");
    // The owner closed the window; verify the saved session without showing a window.
    const session = await launcher(profile, true);
    try {
      const id = xUserId(await session.page.cookies().catch(() => []));
      if (!id)
        throw new Error("X login was not completed. Log in to X in the window, then close it.");
      if (account.platformId && account.platformId !== id)
        throw new Error(
          "A different X account is logged in. Log in with the account connected earlier.",
        );
      await session.page.goto("https://x.com/home");
      const href = await this.until(
        session.page,
        `document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href") ?? ""`,
        30_000,
      );
      const handle = /^\/(\w{1,15})$/.exec(String(href ?? ""))?.[1];
      if (flow.cancelled) throw new Error("X login was cancelled.");
      await service.connectAccount(
        account.id,
        {
          platformId: id,
          name: handle ? `@${handle}` : `X ${id}`,
          scopes: X_BROWSER_SCOPES,
          accessApproved: true,
          connection: "browser",
        },
        { accessToken: "browser-session" },
      );
      flow.status = "connected";
    } finally {
      await session.close().catch(() => undefined);
    }
  }
  /** Cancels an open login and removes the logged-in profile, which logs this host out of X. */
  async forget(accountId: string): Promise<void> {
    const flow = this.logins.get(accountId);
    this.logins.delete(accountId);
    if (flow) {
      flow.cancelled = true;
      await flow.session?.close().catch(() => undefined);
    }
    // Browser helper processes can hold profile files briefly after closing.
    return this.exclusive(accountId, async () => {
      for (const folder of ["x-browser", "browser-profiles"])
        await rm(this.profile(accountId, folder), {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
    });
  }
  private async until<T>(
    page: BrowserPage,
    expression: string,
    timeoutMs: number,
  ): Promise<T | undefined> {
    const deadline = this.now() + timeoutMs;
    for (;;) {
      const value = await page.evaluate<T>(expression).catch(() => undefined);
      if (value) return value;
      if (this.now() >= deadline) return undefined;
      await this.wait(250);
    }
  }
  adapter(): SocialAdapter {
    return {
      send: (account, job, _token, media) =>
        this.exclusive(account.id, async () => await this.publish(account, job, media)),
      poll: (account, _token, posts, cursor) =>
        this.exclusive(account.id, async () => await this.poll(account, posts, cursor)),
    };
  }
  private async identity(page: BrowserPage, account: SocialAccount) {
    const id = xUserId(await page.cookies());
    if (!id) throw new SocialPlatformError("expired");
    if (account.platform !== "x" || id !== account.platformId)
      throw new SocialPlatformError("denied");
  }
  private async poll(account: SocialAccount, posts: string[], cursor?: string) {
    if (!this.launcher) throw new SocialPlatformError("unsupported");
    const session = await this.launcher(this.profile(account.id), this.background);
    const events: import("../src/integrations/social/adapter").SocialInbound[] = [];
    const coverage: SocialMonitorChannel[] = [];
    try {
      await this.identity(session.page, account);
      const channels = [
        {
          scope: "tweet.read",
          name: "mentions" as const,
          url: "https://x.com/notifications/mentions",
          path: /\/(NotificationsTimeline(?:Mentions)?|MentionsTimeline|mentions\.json)$/,
          parse: (body: string) =>
            parseXBrowserMentions(body, account.platformId, posts, this.now()),
        },
        {
          scope: "dm.read",
          name: "messages" as const,
          url: "https://x.com/messages",
          path: /\/(inbox_initial_state|inbox_timeline|inbox_updates)\.json$/,
          parse: (body: string) => parseXBrowserInbox(body, account.platformId, this.now()),
        },
      ];
      let supported = 0;
      for (const channel of channels) {
        if (!account.scopes.includes(channel.scope)) continue;
        const result: SocialMonitorChannel = {
          channel: channel.name,
          status: "unavailable",
          reason: "response_unavailable",
        };
        coverage.push(result);
        const capture = session.page.watchResponse(channel.path);
        try {
          await session.page.goto(channel.url);
          if (channel.name === "messages") {
            const path = await session.page.evaluate<string>("location.pathname");
            if (path === "/i/chat" || path.startsWith("/i/chat/")) {
              await this.identity(session.page, account);
              result.reason = path.startsWith("/i/chat/pin/")
                ? "chat_setup_required"
                : "encrypted_chat_unsupported";
              continue;
            }
          }
          const body = await capture.body(20_000);
          await this.identity(session.page, account);
          if (!body) {
            // Positive, route-specific empty-state evidence; absence of a response alone is not success.
            if (
              channel.name === "mentions" &&
              (await session.page.evaluate<boolean>(`(() => {
              return location.origin === "https://x.com" &&
                location.pathname === "/notifications/mentions" &&
                !!document.querySelector('a[role="tab"][aria-selected="true"][href="/notifications/mentions"]') &&
                document.querySelector('[data-testid="emptyState"] [data-testid="empty_state_header_text"]')?.textContent?.trim() === "Nothing to see here — yet" &&
                document.querySelector('[data-testid="emptyState"] [data-testid="empty_state_body_text"]')?.textContent?.trim() === "When someone mentions you, you’ll find it here." &&
                !document.querySelector('article[data-testid="tweet"]');
            })()`))
            ) {
              supported++;
              result.status = "read";
              delete result.reason;
            }
            continue;
          }
          try {
            events.push(...channel.parse(body));
            supported++;
            result.status = "read";
            delete result.reason;
          } catch (error) {
            if (!(error instanceof SocialPlatformError) || error.code !== "unsupported")
              throw error;
          }
        } finally {
          capture.stop();
        }
      }
      const targets = [...new Set(posts.filter((id) => /^\d{1,25}$/.test(id)))];
      let nextCursor: string | undefined;
      if (targets.length && account.scopes.includes("tweet.read")) {
        const start = /^\d{1,9}$/.test(cursor ?? "") ? Number(cursor) % targets.length : 0;
        const count = Math.min(2, targets.length);
        const comments: SocialMonitorChannel = { channel: "comments", status: "read" };
        coverage.push(comments);
        // Rotate saved posts across ticks. Never walk an unbounded number of threads in one poll.
        for (let index = 0; index < count; index++) {
          const post = targets[(start + index) % targets.length];
          const capture = session.page.watchResponse(/\/TweetDetail$/);
          try {
            await session.page.goto(`https://x.com/i/status/${post}`);
            const body = await capture.body(15_000);
            await this.identity(session.page, account);
            if (!body) {
              comments.status = "unavailable";
              comments.reason = "response_unavailable";
              continue;
            }
            try {
              events.push(...parseXBrowserMentions(body, account.platformId, [post], this.now()));
              supported++;
            } catch (error) {
              if (!(error instanceof SocialPlatformError) || error.code !== "unsupported")
                throw error;
              comments.status = "unavailable";
              comments.reason = "response_unavailable";
            }
          } finally {
            capture.stop();
          }
        }
        nextCursor = String((start + count) % targets.length);
      }
      if (!supported) throw new SocialPlatformError("unsupported");
      return {
        events: [...new Map(events.map((event) => [event.eventId, event])).values()],
        coverage,
        ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
      };
    } finally {
      await session.close().catch(() => undefined);
    }
  }
  private async sendMessage(
    page: BrowserPage,
    account: SocialAccount,
    job: SocialJob,
  ): Promise<SocialSendResult> {
    const recipient = job.payload.recipientId;
    if (
      !recipient ||
      !/^\d{1,25}$/.test(recipient) ||
      recipient === account.platformId ||
      job.payload.media.length ||
      job.payload.postId ||
      !account.scopes.includes("dm.write")
    )
      throw new SocialPlatformError("unsupported");
    const text = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
    if (!text.trim()) throw new SocialPlatformError("rejected");
    await this.identity(page, account);
    await page.goto(`https://x.com/messages/compose?recipient_id=${recipient}`);
    const editor = '[data-testid="dmComposerTextInput"]';
    const ready = await this.until<string>(
      page,
      `${LOGIN_PATH}.test(location.pathname) ? "login" : document.querySelector(${JSON.stringify(editor)}) ? "ready" : ""`,
      30_000,
    );
    if (ready === "login") throw new SocialPlatformError("expired");
    if (ready !== "ready") throw new SocialPlatformError("unsupported");
    await this.identity(page, account);
    // A composer alone is insufficient: pin the actual numeric conversation participants.
    const conversation = await page.evaluate<string>("location.pathname");
    const ids = /^\/messages\/(\d{1,25})-(\d{1,25})\/?$/.exec(conversation);
    if (!ids || !ids.slice(1).includes(recipient) || !ids.slice(1).includes(account.platformId))
      throw new SocialPlatformError("denied");
    await page.click(editor);
    await page.insertText(text);
    const button = '[data-testid="dmComposerSendButton"]';
    const enabled = await this.until<boolean>(
      page,
      `!!document.querySelector(${JSON.stringify(`${button}:not([disabled]):not([aria-disabled="true"])`)})`,
      10_000,
    );
    if (!enabled) throw new SocialPlatformError("rejected");
    await this.identity(page, account);
    const capture = page.watchResponse(/\/dm\/new2?\.json$/);
    this.lastSend.set(account.id, this.now());
    try {
      try {
        await page.click(button);
      } catch {
        throw new SocialPlatformError("unknown");
      }
      const body = await capture.body(30_000);
      if (!body) throw new SocialPlatformError("unknown");
      return parseXBrowserMessageSent(body, account.platformId, recipient, text, this.now());
    } finally {
      capture.stop();
    }
  }
  private async publish(
    account: SocialAccount,
    job: SocialJob,
    media: (id: string) => Promise<Uint8Array>,
  ): Promise<SocialSendResult> {
    const postId = job.payload.postId;
    const message = job.kind === "message" || (job.kind === "reply" && !postId);
    if (
      message &&
      (!job.payload.recipientId ||
        !/^\d{1,25}$/.test(job.payload.recipientId) ||
        job.payload.media.length ||
        !account.scopes.includes("dm.write"))
    )
      throw new SocialPlatformError("unsupported");
    if (postId && !/^\d{1,25}$/.test(postId)) throw new SocialPlatformError("rejected");
    if (!this.launcher) throw new SocialPlatformError("unsupported");
    const last = this.lastSend.get(account.id) ?? 0;
    if (this.now() - last < MIN_SEND_GAP)
      throw new SocialPlatformError("rate_limit", last + MIN_SEND_GAP);
    const text = [job.payload.text, job.payload.link].filter(Boolean).join("\n");
    if (xMediaIssue(job.payload.media, message)) throw new SocialPlatformError("unsupported");
    const staging = join(this.directory, "x-browser-uploads", randomUUID());
    try {
      const files: string[] = [];
      for (const [index, item] of job.payload.media.entries()) {
        const bytes = await media(item.uploadId!);
        const format = xMediaFormat(bytes);
        if ((item.kind === "video") !== (format === "mp4"))
          throw new SocialPlatformError("rejected");
        await mkdir(staging, { recursive: true });
        const file = join(staging, `${index}.${format}`);
        await writeFile(file, bytes);
        files.push(file);
      }
      const session = await this.launcher(this.profile(account.id), this.background);
      try {
        if (message) return await this.sendMessage(session.page, account, job);
        return await this.compose(session.page, account, postId, text, files);
      } finally {
        await session.close().catch(() => undefined);
      }
    } finally {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }
  private async compose(
    page: BrowserPage,
    account: SocialAccount,
    postId: string | undefined,
    text: string,
    files: string[],
  ): Promise<SocialSendResult> {
    const button = postId ? '[data-testid="tweetButtonInline"]' : '[data-testid="tweetButton"]';
    await page.goto(postId ? `https://x.com/i/status/${postId}` : "https://x.com/compose/post");
    const state = await this.until<string>(
      page,
      `${LOGIN_PATH}.test(location.pathname) ? "login" : document.querySelector(${JSON.stringify(EDITOR)}) ? "ready" : ""`,
      45_000,
    );
    if (state === "login") throw new SocialPlatformError("expired");
    if (state !== "ready") throw new SocialPlatformError("rejected");
    const id = xUserId(await page.cookies());
    if (!id) throw new SocialPlatformError("expired");
    // Never post from whichever account happens to be logged in to the profile.
    if (id !== account.platformId) throw new SocialPlatformError("denied");
    await page.click(EDITOR);
    if (text) await page.insertText(text);
    if (files.length) {
      await page.setFiles(FILE_INPUT, files);
      const attached = await this.until<boolean>(
        page,
        files[0].endsWith(".mp4")
          ? `!!document.querySelector('[data-testid="attachments"] video, [data-testid="attachments"] [data-testid="videoPlayer"]') && !document.querySelector('[data-testid="attachments"] [role="progressbar"]')`
          : `document.querySelectorAll('[data-testid="attachments"] img').length >= ${files.length}`,
        120_000,
      );
      if (!attached) throw new SocialPlatformError("rejected");
    }
    const enabled = await this.until<boolean>(
      page,
      `!!document.querySelector(${JSON.stringify(`${button}:not([aria-disabled="true"]):not(:disabled)`)})`,
      20_000,
    );
    if (!enabled) throw new SocialPlatformError("rejected");
    await this.identity(page, account);
    const response = page.watchResponse(/\/(CreateTweet|CreateNoteTweet)$/);
    this.lastSend.set(account.id, this.now());
    try {
      await page.click(button);
    } catch {
      response.stop();
      throw new SocialPlatformError("unknown");
    }
    const body = await response.body(45_000);
    if (body === undefined) throw new SocialPlatformError("unknown");
    return parseCreateTweet(body, this.now());
  }
}
