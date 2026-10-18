import { createHash, randomUUID } from "node:crypto";
import { inspectBrowserElement, type ElementInspection } from "./browser-annotation";
import type { BrowserAnnotationCapture } from "../src/shared/lib/browserAnnotation";
import { browserShadowMasks, type BrowserDomNode } from "./browser-shadow-masks";
import type { RuntimeLogSource, RuntimeLogLevel } from "../src/features/host-tools/runtimeLogTypes";
import { runtimeLogDetails, runtimeLogPreview, type RuntimeLogsService } from "./runtime-logs";

type ConsoleMessage = {
  text(): string;
  type(): string;
  args?(): {
    jsonValue(): Promise<unknown>;
    evaluate?(callback: (value: unknown) => unknown): Promise<unknown>;
  }[];
  location?(): { url: string; lineNumber: number; columnNumber: number };
};
type BrowserRequest = {
  url(): string;
  method?(): string;
  resourceType?(): string;
  failure?(): { errorText: string } | null;
};
type BrowserResponse = { url(): string; status(): number; statusText?(): string };
type PageEvents = {
  framenavigated: { parentFrame(): unknown };
  console: ConsoleMessage;
  pageerror: Error;
  requestfailed: BrowserRequest;
  response: BrowserResponse;
  close: undefined;
};

type Page = {
  goto(url: string, options: { timeout: number }): Promise<unknown>;
  url(): string;
  screenshot(options: {
    type: "jpeg";
    quality: number;
    timeout: number;
    mask?: unknown[];
    maskColor?: string;
    style?: string;
  }): Promise<Buffer>;
  context?: () => {
    newCDPSession(page: Page): Promise<{
      send(
        method: "DOM.getDocument",
        params: { depth: number; pierce: boolean },
      ): Promise<{ root: BrowserDomNode }>;
      detach(): Promise<void>;
    }>;
  };
  evaluate?: <T, A>(callback: (arg: A) => T, arg: A) => Promise<T>;
  locator?: (selector: string) => unknown;
  on?: <K extends keyof PageEvents>(event: K, callback: (value: PageEvents[K]) => void) => unknown;
  off?: <K extends keyof PageEvents>(event: K, callback: (value: PageEvents[K]) => void) => unknown;
  mouse: { click(x: number, y: number): Promise<void>; wheel(x: number, y: number): Promise<void> };
  keyboard: { type(text: string): Promise<void>; press(key: string): Promise<void> };
};
type Browser = {
  newContext(options: {
    viewport: { width: number; height: number };
    acceptDownloads: boolean;
  }): Promise<{ newPage(): Promise<Page> }>;
  close(): Promise<void>;
};
export type BrowserLoader = () => Promise<{
  chromium: { launch(options: { headless: boolean }): Promise<Browser> };
}>;
export type SharedBrowserOptions = {
  runtimeLogs?: RuntimeLogsService;
  logLabel?: string;
  keepAlive?: boolean;
};
const fingerprint = (credential: string) => createHash("sha256").update(credential).digest("hex");

// This self-contained function executes on a console argument handle in Chromium.
// Bound the returned value before Playwright serializes/transfers it to the host.
const browserArgumentValue = runtimeLogPreview;

export function sharedBrowserUrl(input: unknown) {
  if (typeof input !== "string" || input.length > 4096) throw new Error("Invalid browser URL");
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("Use an HTTP(S) URL without credentials");
  return url.href;
}

/** One host-owned ephemeral browser. No user profile, extension, download or
 * stored token is exposed. Viewing is shared; mutations require a short lease. */
export class SharedBrowser {
  private browser?: Browser;
  private page?: Page;
  private lease?: { owner: string; id: string; expiresAt: number };
  private busy = false;
  private lastUse = 0;
  private idleTimer?: ReturnType<typeof setInterval>;
  private navigationId = randomUUID();
  private pageGeneration = 0;
  private captureGeneration = 0;
  private logSource?: RuntimeLogSource;
  private detachPageListeners?: () => void;
  private detachLogListeners?: () => void;
  private pendingConsoleCaptures = 0;
  private annotation?: {
    id: string;
    owner: string;
    leaseId: string;
    projectId: string;
    sessionId: string;
    navigationId: string;
    selection?: BrowserAnnotationCapture;
    point?: { x: number; y: number };
    inspection?: ElementInspection;
  };
  constructor(
    private readonly loader: BrowserLoader = async () => {
      // Keep optional runtime dependency out of the host bundle. Explicit setup:
      // install playwright in the host runtime, then `playwright install chromium`.
      const moduleName = "playwright";
      try {
        return (await import(/* @vite-ignore */ moduleName)) as Awaited<ReturnType<BrowserLoader>>;
      } catch {
        throw new Error(
          "Shared browser requires Playwright on this host. Install playwright in the host runtime and run playwright install chromium, then retry. No automatic download was attempted.",
        );
      }
    },
    private readonly now = Date.now,
    private readonly options: SharedBrowserOptions = {},
  ) {}

  async dispatchForSession(method: string, params: Record<string, unknown>, credential: string) {
    const matches =
      this.logSource?.projectId === params.projectId &&
      this.logSource?.sessionId === params.sessionId;
    if (["browser.frame", "browser.input", "browser.close"].includes(method)) {
      if (!matches) throw new Error("Open a browser for this session before using it.");
      if (!this.lease || this.lease.expiresAt <= this.now())
        throw new Error("Claim browser control before using it.");
      this.requireLease(fingerprint(credential), params);
    }
    const value = await this.dispatch(method, params, credential);
    if (method === "browser.status" || method === "browser.claim" || method === "browser.release") {
      return matches
        ? value
        : {
            ...value,
            url: null,
            logSourceId: undefined,
            navigationId: undefined,
            annotationId: undefined,
          };
    }
    return value;
  }

  async dispatch(
    method: string,
    params: Record<string, unknown>,
    credential: string,
    options: { takeover?: boolean } = {},
  ) {
    if (this.busy) throw new Error("Shared browser is busy; retry after the current request");
    this.busy = true;
    try {
      const at = this.now();
      this.lastUse = at;
      if (this.lease && this.lease.expiresAt <= at) {
        this.lease = undefined;
        this.annotation = undefined;
      }
      const owner = fingerprint(credential);
      if (method === "browser.status") return this.status(owner);
      if (method === "browser.claim") {
        if (this.lease && this.lease.owner !== owner) {
          if (!options.takeover)
            throw new Error(
              "Another client controls this browser. Use Claim control to take over.",
            );
          this.lease = undefined;
          this.annotation = undefined;
        }
        this.lease = { owner, id: this.lease?.id ?? randomUUID(), expiresAt: at + 30_000 };
        return this.status(owner);
      }
      if (method === "browser.release") {
        this.requireLease(owner, params);
        this.lease = undefined;
        this.annotation = undefined;
        return this.status(owner);
      }
      if (method === "browser.open") {
        this.requireLease(owner, params);
        const url = sharedBrowserUrl(params.url);
        const projectId = this.logContext(params.projectId);
        const sessionId = this.logContext(params.sessionId);
        if (
          this.page &&
          (this.logSource?.projectId !== projectId || this.logSource?.sessionId !== sessionId)
        ) {
          // A new context prevents old-document network/console events from being
          // attributed to a different conversation while navigation is pending.
          await this.disposePage();
        }
        this.invalidateSelection();
        const source: RuntimeLogSource = {
          id: `browser:${randomUUID()}`,
          kind: "browser",
          label: this.options.logLabel ?? "Shared browser",
          projectId,
          sessionId,
          url,
          available: true,
        };
        try {
          await this.ensurePage();
        } catch (error) {
          this.options.runtimeLogs?.setSource({
            ...source,
            available: false,
            reason: error instanceof Error ? error.message : "Browser capture is unavailable.",
          });
          throw error;
        }
        this.captureLogs(this.page!, source);
        await this.page!.goto(url, { timeout: 15_000 });
        return this.status(owner);
      }
      if (method === "browser.frame") {
        if (!this.page) throw new Error("Open a shared browser first");
        const frame = await this.page.screenshot({ type: "jpeg", quality: 65, timeout: 5_000 });
        if (frame.byteLength > 2 * 1024 * 1024)
          throw new Error("Browser frame exceeds transfer budget");
        return {
          ...this.status(owner),
          mimeType: "image/jpeg",
          data: frame.toString("base64"),
          width: 1280,
          height: 720,
        };
      }
      if (method === "browser.close") {
        this.requireLease(owner, params);
        await this.close();
        return this.status(owner);
      }
      if (method === "browser.input") {
        this.requireLease(owner, params);
        if (this.annotation)
          throw new Error("Cancel element selection before interacting with the page");
        if (!this.page) throw new Error("Open a shared browser first");
        if (params.kind === "click") {
          const x = Number(params.x),
            y = Number(params.y);
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1280 || y < 0 || y > 720)
            throw new Error("Invalid click position");
          await this.page.mouse.click(x, y);
        } else if (params.kind === "scroll") {
          const y = Number(params.y);
          if (!Number.isFinite(y) || Math.abs(y) > 2000) throw new Error("Invalid scroll distance");
          await this.page.mouse.wheel(0, y);
        } else if (params.kind === "text") {
          if (
            typeof params.text !== "string" ||
            params.text.length > 4096 ||
            params.text.includes("\0")
          )
            throw new Error("Invalid browser text");
          await this.page.keyboard.type(params.text);
        } else if (params.kind === "key") {
          if (
            ![
              "Enter",
              "Tab",
              "Escape",
              "Backspace",
              "ArrowUp",
              "ArrowDown",
              "ArrowLeft",
              "ArrowRight",
            ].includes(String(params.key))
          )
            throw new Error("Unsupported browser key");
          await this.page.keyboard.press(String(params.key));
        } else throw new Error("Unsupported browser input");
        this.invalidateSelection();
        return this.status(owner);
      }
      if (method.startsWith("browser.annotation."))
        return await this.annotate(method, params, owner);
      throw new Error("Unsupported browser method");
    } finally {
      this.busy = false;
    }
  }
  private status(owner: string) {
    return {
      open: !!this.page,
      logSourceId: this.logSource?.id,
      url: this.page?.url() ?? null,
      controlling: this.lease?.owner === owner,
      leaseId: this.lease?.owner === owner ? this.lease.id : undefined,
      leaseExpiresAt: this.lease?.expiresAt,
      setup: "Install playwright in the host runtime and run playwright install chromium",
      viewport: { width: 1280, height: 720 },
      navigationId: this.navigationId,
      annotationId: this.annotation?.owner === owner ? this.annotation.id : undefined,
    };
  }
  private requireLease(owner: string, params: Record<string, unknown>) {
    if (!this.lease || this.lease.owner !== owner || this.lease.id !== params.leaseId)
      throw new Error("Claim browser control before changing it");
    this.lease.expiresAt = this.now() + 30_000;
  }
  private invalidateSelection() {
    this.navigationId = randomUUID();
    this.annotation = undefined;
  }
  private annotationScope(params: Record<string, unknown>, owner: string) {
    const annotation = this.annotation;
    if (
      !annotation ||
      annotation.owner !== owner ||
      annotation.id !== params.annotationId ||
      annotation.projectId !== params.projectId ||
      annotation.sessionId !== params.sessionId ||
      annotation.navigationId !== this.navigationId ||
      params.navigationId !== this.navigationId ||
      this.lease?.id !== annotation.leaseId ||
      this.lease.owner !== owner ||
      this.lease.expiresAt <= this.now()
    )
      throw new Error("Element selection expired. Select the element again.");
    return annotation;
  }
  private async shadowMasks(page: Page) {
    if (!page.context)
      throw new Error("Safe shadow DOM inspection is unavailable on this host browser");
    const session = await page.context().newCDPSession(page);
    try {
      const document = await session.send("DOM.getDocument", { depth: -1, pierce: true });
      return browserShadowMasks(document.root);
    } finally {
      await session.detach();
    }
  }
  private async annotate(method: string, params: Record<string, unknown>, owner: string) {
    if (method === "browser.annotation.cancel") {
      if (
        this.annotation?.owner === owner &&
        this.annotation.id === params.annotationId &&
        this.annotation.projectId === params.projectId &&
        this.annotation.sessionId === params.sessionId
      )
        this.annotation = undefined;
      return this.status(owner);
    }
    this.requireLease(owner, params);
    const page = this.page;
    if (!page?.evaluate || !page.locator)
      throw new Error("Element inspection is unavailable on this host browser");
    if (method === "browser.annotation.start") {
      if (
        typeof params.projectId !== "string" ||
        !params.projectId ||
        typeof params.sessionId !== "string" ||
        !params.sessionId
      )
        throw new Error("Choose a project and conversation before selecting an element");
      if (params.navigationId !== this.navigationId)
        throw new Error("Page changed. Refresh the frame before selecting.");
      this.annotation = {
        id: randomUUID(),
        owner,
        leaseId: this.lease!.id,
        projectId: params.projectId,
        sessionId: params.sessionId,
        navigationId: this.navigationId,
      };
      return this.status(owner);
    }
    const annotation = this.annotationScope(params, owner);
    if (method === "browser.annotation.clear") {
      annotation.selection = undefined;
      annotation.inspection = undefined;
      annotation.point = undefined;
      return this.status(owner);
    }
    if (method === "browser.annotation.read") {
      if (!annotation.selection || !annotation.point || !annotation.inspection)
        throw new Error("Select an element first");
      const current = await page.evaluate(inspectBrowserElement, {
        ...annotation.point,
        full: true,
        opaqueHosts: await this.shadowMasks(page),
      });
      this.annotationScope(params, owner);
      if (JSON.stringify(current) !== JSON.stringify(annotation.inspection)) {
        annotation.selection = undefined;
        throw new Error("Page changed. Select the element again.");
      }
      return { ...this.status(owner), selection: annotation.selection };
    }
    if (!["browser.annotation.hover", "browser.annotation.select"].includes(method))
      throw new Error("Unsupported annotation method");
    const x = Number(params.x),
      y = Number(params.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x >= 1280 || y < 0 || y >= 720)
      throw new Error("Invalid selection position");
    const full = method === "browser.annotation.select";
    if (full) annotation.selection = undefined;
    const inspection = await page.evaluate(inspectBrowserElement, {
      x,
      y,
      full,
      opaqueHosts: await this.shadowMasks(page),
    });
    this.annotationScope(params, owner);
    if (!inspection.element || !full)
      return {
        ...this.status(owner),
        hover: inspection.element,
        limitation: inspection.limitation,
      };
    const frame = await page.screenshot({
      type: "jpeg",
      quality: 65,
      timeout: 5_000,
      mask: inspection.masks.map((selector) => page.locator!(selector)),
      maskColor: "#333333",
      // Also hide content overflowing private/closed shadow hosts. Playwright
      // restores this screenshot-only stylesheet after capture.
      style: inspection.masks.length
        ? `${inspection.masks.join(",")} { opacity: 0 !important; }`
        : undefined,
    });
    this.annotationScope(params, owner);
    if (frame.byteLength > 2 * 1024 * 1024)
      throw new Error("Browser frame exceeds transfer budget");
    const current = await page.evaluate(inspectBrowserElement, {
      x,
      y,
      full: true,
      opaqueHosts: await this.shadowMasks(page),
    });
    this.annotationScope(params, owner);
    if (JSON.stringify(current) !== JSON.stringify(inspection))
      throw new Error("Page changed. Select the element again.");
    annotation.point = { x, y };
    annotation.inspection = inspection;
    annotation.selection = {
      id: randomUUID(),
      projectId: annotation.projectId,
      sessionId: annotation.sessionId,
      navigationId: this.navigationId,
      capturedAt: new Date(this.now()).toISOString(),
      pageUrl: inspection.pageUrl,
      viewport: inspection.viewport,
      devicePixelRatio: inspection.devicePixelRatio,
      element: inspection.element,
      trust: "untrusted-page-data",
      limitations: [
        "Form values and sensitive content are omitted; iframes and shadow DOM are masked.",
      ],
      screenshot: {
        mimeType: "image/jpeg",
        data: frame.toString("base64"),
        width: 1280,
        height: 720,
      },
    };
    return { ...this.status(owner), selection: annotation.selection };
  }
  private async ensurePage() {
    if (this.page) return;
    const generation = this.pageGeneration;
    const { chromium } = await this.loader();
    if (generation !== this.pageGeneration) throw new Error("Browser was closed during startup");
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        acceptDownloads: false,
      });
      const page = await context.newPage();
      if (generation !== this.pageGeneration) throw new Error("Browser was closed during startup");
      this.page = page;
      const navigated = (frame: PageEvents["framenavigated"]) => {
        if (this.page === page && generation === this.pageGeneration && !frame.parentFrame())
          this.invalidateSelection();
      };
      page.on?.("framenavigated", navigated);
      this.detachPageListeners = () => page.off?.("framenavigated", navigated);
      this.browser = browser;
      this.idleTimer = setInterval(() => {
        if (!this.options.keepAlive && !this.busy && this.now() - this.lastUse > 5 * 60_000)
          void this.close().catch(() => {});
      }, 30_000);
      this.idleTimer.unref();
    } catch (error) {
      await browser.close();
      throw error;
    }
  }
  revoke(credential: string) {
    if (this.lease?.owner === fingerprint(credential)) {
      this.lease = undefined;
      this.annotation = undefined;
    }
  }

  private logContext(value: unknown) {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value || value.length > 256 || value.includes("\0"))
      throw new Error("Invalid browser log context");
    return value;
  }

  private captureLogs(page: Page, source: RuntimeLogSource) {
    this.stopCapture("Capture moved to another navigation.");
    this.logSource = source;
    const logs = this.options.runtimeLogs;
    if (!logs) return;
    logs.setSource(source);
    const generation = this.captureGeneration;
    const active = () => this.page === page && this.captureGeneration === generation;
    const currentSource = () => ({ ...source, url: page.url() || source.url });
    const console = (message: ConsoleMessage) => {
      if (!active()) return;
      const timestamp = this.now();
      const text = message.text();
      const type = message.type();
      const location = message.location?.();
      const level: RuntimeLogLevel =
        type === "error" || type === "assert"
          ? "error"
          : type === "warning" || type === "warn"
            ? "warn"
            : type === "debug" || type === "trace"
              ? "debug"
              : "info";
      const emit = (values?: unknown[]) => {
        if (!active()) return;
        const details = values?.length ? runtimeLogDetails(values) : undefined;
        const stack = values?.find(
          (value): value is { stack: string } =>
            !!value &&
            typeof value === "object" &&
            "stack" in value &&
            typeof value.stack === "string",
        )?.stack;
        logs.add(currentSource(), {
          timestamp,
          level,
          message: text,
          ...(details !== undefined ? { details } : {}),
          ...(stack ? { stack } : {}),
          ...(location?.url
            ? {
                location: {
                  file: location.url,
                  line: location.lineNumber + 1,
                  column: location.columnNumber + 1,
                },
              }
            : {}),
        });
      };
      const args = message.args?.().slice(0, 8) ?? [];
      if (!args.length || this.pendingConsoleCaptures >= 16) {
        emit();
        return;
      }
      this.pendingConsoleCaptures++;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const values = Promise.all(
        args.map(async (arg) => {
          try {
            return arg.evaluate
              ? await arg.evaluate(browserArgumentValue)
              : "[bounded capture unavailable]";
          } catch {
            return "[unavailable]";
          }
        }),
      );
      // Keep the actual argument requests bounded even if they outlive the display
      // timeout. Further console events still retain their text immediately.
      void values
        .finally(() => {
          this.pendingConsoleCaptures--;
        })
        .catch(() => {});
      void Promise.race([
        values,
        new Promise<unknown[]>((resolve) => {
          timer = setTimeout(() => resolve(["[argument capture timed out]"]), 750);
          timer.unref?.();
        }),
      ])
        .then(emit)
        .catch(() => {})
        .finally(() => {
          if (timer) clearTimeout(timer);
        });
    };
    const pageerror = (error: Error) => {
      if (!active()) return;
      const frame =
        /(?:\(|\s)((?:[A-Za-z]:[\\/]|\/|file:\/\/|https?:\/\/)[^\s()]+):(\d+):(\d+)\)?/.exec(
          error.stack ?? "",
        );
      logs.add(currentSource(), {
        timestamp: this.now(),
        level: "error",
        message: error.message,
        stack: error.stack,
        ...(frame
          ? { location: { file: frame[1], line: Number(frame[2]), column: Number(frame[3]) } }
          : {}),
        details: { event: "pageerror", name: error.name },
      });
    };
    const requestfailed = (request: BrowserRequest) => {
      if (!active()) return;
      const failure = request.failure?.()?.errorText ?? "Request failed";
      // Aborted navigation requests are informational, rather than application errors.
      logs.add(currentSource(), {
        timestamp: this.now(),
        level: /(?:ERR_ABORTED|NS_BINDING_ABORTED|cancell?ed)/i.test(failure) ? "info" : "error",
        message: `${request.method?.() ?? "GET"} ${request.url()} — ${failure}`,
        details: {
          event: "requestfailed",
          method: request.method?.(),
          resourceType: request.resourceType?.(),
          failure,
        },
        location: { file: request.url() },
      });
    };
    const response = (result: BrowserResponse) => {
      if (!active() || result.status() < 400) return;
      logs.add(currentSource(), {
        timestamp: this.now(),
        level: "error",
        message: `HTTP ${result.status()} ${result.statusText?.() ?? ""} ${result.url()}`.trim(),
        details: { event: "response", status: result.status() },
        location: { file: result.url() },
      });
    };
    const close = () => {
      if (active()) void this.disposePage().catch(() => {});
    };
    page.on?.("console", console);
    page.on?.("pageerror", pageerror);
    page.on?.("requestfailed", requestfailed);
    page.on?.("response", response);
    page.on?.("close", close);
    this.detachLogListeners = () => {
      page.off?.("console", console);
      page.off?.("pageerror", pageerror);
      page.off?.("requestfailed", requestfailed);
      page.off?.("response", response);
      page.off?.("close", close);
    };
  }

  private stopCapture(reason: string) {
    this.captureGeneration++;
    this.detachLogListeners?.();
    this.detachLogListeners = undefined;
    if (this.logSource)
      this.options.runtimeLogs?.setSource({ ...this.logSource, available: false, reason });
    this.logSource = undefined;
  }

  private async disposePage() {
    this.pageGeneration++;
    this.stopCapture("The browser has closed. Retained logs remain available.");
    this.detachPageListeners?.();
    this.detachPageListeners = undefined;
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = undefined;
    const browser = this.browser;
    this.page = undefined;
    this.browser = undefined;
    this.invalidateSelection();
    await browser?.close();
  }

  async close() {
    this.lease = undefined;
    await this.disposePage();
  }
}
