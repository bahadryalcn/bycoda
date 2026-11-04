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

type BrowserCdpSession = {
  send(
    method: "DOM.getDocument",
    params: { depth: number; pierce: boolean },
  ): Promise<{ root: BrowserDomNode }>;
  send(method: "DOM.getNodeForLocation", params: { x: number; y: number; includeUserAgentShadowDOM: boolean; ignorePointerEventsNone: boolean }): Promise<{ backendNodeId: number }>;
  send(method: "DOM.resolveNode", params: { backendNodeId: number; objectGroup: string }): Promise<{ object: { objectId?: string } }>;
  send(method: "Runtime.callFunctionOn", params: { objectId: string; functionDeclaration: string; arguments: { value: number }[]; objectGroup: string; silent: boolean }): Promise<{ result: { objectId?: string }; exceptionDetails?: unknown }>;
  send(method: "Runtime.getProperties", params: { objectId: string; ownProperties: boolean; generatePreview: boolean }): Promise<{ result: { name: string; value?: { objectId?: string; value?: unknown } }[] }>;
  send(method: "DOM.describeNode", params: { objectId: string; depth: number; pierce: boolean }): Promise<{ node: BrowserDomNode & { backendNodeId?: number } }>;
  send(method: "Runtime.releaseObjectGroup", params: { objectGroup: string }): Promise<unknown>;
  send(method: "DOM.enable"): Promise<unknown>;
  on?(event: string, listener: (payload: any) => void): unknown;
  detach(): Promise<void>;
};

type Page = {
  goto(url: string, options: { timeout: number }): Promise<unknown>;
  setViewportSize?(viewport: { width: number; height: number }): Promise<void>;
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
    newCDPSession(page: Page): Promise<BrowserCdpSession>;
  };
  evaluate?: <T, A>(callback: (arg: A) => T, arg: A) => Promise<T>;
  locator?: (selector: string) => unknown;
  on?: <K extends keyof PageEvents>(event: K, callback: (value: PageEvents[K]) => void) => unknown;
  off?: <K extends keyof PageEvents>(event: K, callback: (value: PageEvents[K]) => void) => unknown;
  mouse: {
    click(x: number, y: number): Promise<void>;
    wheel(x: number, y: number): Promise<void>;
    move?(x: number, y: number): Promise<void>;
    down?(options: { button: "left" | "middle" | "right" }): Promise<void>;
    up?(options: { button: "left" | "middle" | "right" }): Promise<void>;
  };
  keyboard: {
    type(text: string): Promise<void>;
    insertText?(text: string): Promise<void>;
    press(key: string): Promise<void>;
  };
};
type Browser = {
  newContext(options: {
    viewport: { width: number; height: number };
    acceptDownloads: boolean;
  }): Promise<{ newPage(): Promise<Page>; close?(): Promise<void> }>;
  close(): Promise<void>;
};
export type BrowserLoader = () => Promise<{
  chromium: { launch(options: { headless: boolean }): Promise<Browser> };
}>;
export type SharedBrowserOptions = {
  runtimeLogs?: RuntimeLogsService;
  logLabel?: string;
  keepAlive?: boolean;
  onIdleClosed?: () => void;
};
const fingerprint = (credential: string) => createHash("sha256").update(credential).digest("hex");
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

/** Bound screenshot memory and coordinate work before touching Chromium. */
export function sharedBrowserViewport(width: unknown, height: unknown) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    Number(width) < 240 ||
    Number(width) > 2560 ||
    Number(height) < 240 ||
    Number(height) > 2160
  )
    throw new Error("Browser viewport must be integer dimensions between 240x240 and 2560x2160.");
  return { width: Number(width), height: Number(height) };
}

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
  private maskSession?: BrowserCdpSession;
  private maskCache?: string[];
  private maskRevision = 0;
  private documentRoots = new Set<number>();
  private maskEvents = false;
  private screenshotMutations?: {
    marker: string;
    nodes: Set<number>;
    styleParents: Set<number>;
    glass: boolean;
    glassExpected: boolean;
  };
  private lease?: { owner: string; id: string; expiresAt: number };
  private busy = false;
  private readonly inputReceipts = new Map<
    string,
    { payload: string; result: ReturnType<SharedBrowser["status"]> }
  >();
  private lastUse = 0;
  private idleTimer?: ReturnType<typeof setInterval>;
  private navigationId = randomUUID();
  private documentId = randomUUID();
  private hoverObjects?: { session: BrowserCdpSession; group: string };
  private pageGeneration = 0;
  private captureGeneration = 0;
  private viewport = { ...DEFAULT_VIEWPORT };
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
    depth?: number;
    traversal?: ("parent" | "child" | "previousSibling" | "nextSibling")[];
    nodeId?: string;
    maskRevision?: number;
    captures: Map<
      string,
      {
        selection: BrowserAnnotationCapture;
        point: { x: number; y: number };
        depth: number;
        traversal?: ("parent" | "child" | "previousSibling" | "nextSibling")[];
        inspection: ElementInspection;
        revision?: number;
      }
    >;
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

  async dispatchForSession(method: string, params: Record<string, unknown>, credential: string, options: { takeover?: boolean } = {}) {
    const matches =
      this.logSource?.projectId === params.projectId &&
      this.logSource?.sessionId === params.sessionId &&
      this.logSource?.assistantThreadId === params.threadId;
    if (
      ["browser.frame", "browser.input", "browser.close", "browser.resize"].includes(method) ||
      method.startsWith("browser.annotation.")
    ) {
      if (!matches) throw new Error("Open a browser for this session before using it.");
      if (!this.lease || this.lease.expiresAt <= this.now())
        throw new Error("Claim browser control before using it.");
      this.requireLease(fingerprint(credential), params);
    }
    const value = await this.dispatch(method, params, credential, options);
    if (method === "browser.status" || method === "browser.claim" || method === "browser.release") {
      return matches
        ? value
        : {
            ...value,
            url: null,
            logSourceId: undefined,
            navigationId: undefined,
            documentId: undefined,
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
    const receiptOwner = fingerprint(credential);
    let receiptKey: string | undefined;
    let receiptPayload: string | undefined;
    if (method === "browser.input" && params.requestId !== undefined) {
      if (
        typeof params.requestId !== "string" ||
        !params.requestId ||
        params.requestId.length > 128
      )
        throw new Error("Invalid browser input request ID");
      receiptKey = JSON.stringify([receiptOwner, params.requestId]);
      receiptPayload = JSON.stringify(params);
      const receipt = this.inputReceipts.get(receiptKey);
      if (receipt) {
        if (!this.lease || this.lease.expiresAt <= this.now())
          throw new Error("Claim browser control before changing it");
        this.requireLease(receiptOwner, params);
        if (receipt.payload !== receiptPayload)
          throw new Error("Browser input request ID was reused with different input");
        return receipt.result;
      }
    }
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
        const assistantThreadId = this.logContext(params.threadId);
        if (
          this.page &&
          (this.logSource?.projectId !== projectId || this.logSource?.sessionId !== sessionId || this.logSource?.assistantThreadId !== assistantThreadId)
        ) {
          // A new context prevents old-document network/console events from being
          // attributed to a different conversation while navigation is pending.
          await this.disposePage();
        }
        this.documentId = randomUUID();
        this.invalidateSelection();
        const source: RuntimeLogSource = {
          id: `browser:${randomUUID()}`,
          kind: "browser",
          label: this.options.logLabel ?? "Shared browser",
          projectId,
          sessionId,
          ...(assistantThreadId ? { assistantThreadId } : {}),
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
        const page = this.page, documentId = this.documentId, navigationId = this.navigationId;
        const viewport = { ...this.viewport };
        const frame = await page.screenshot({ type: "jpeg", quality: 65, timeout: 5_000 });
        if (page !== this.page || documentId !== this.documentId || navigationId !== this.navigationId)
          throw new Error("Browser document changed during capture. Refresh the frame.");
        if (frame.byteLength > 2 * 1024 * 1024)
          throw new Error("Browser frame exceeds transfer budget");
        return {
          ...this.status(owner),
          mimeType: "image/jpeg",
          data: frame.toString("base64"),
          width: viewport.width,
          height: viewport.height,
        };
      }
      if (method === "browser.resize") {
        this.requireLease(owner, params);
        if (!this.page) throw new Error("Open a shared browser first");
        const viewport = sharedBrowserViewport(params.width, params.height);
        const page = this.page;
        if (!page.setViewportSize)
          throw new Error("Viewport resizing is unavailable on this host browser.");
        await page.setViewportSize(viewport);
        if (this.page !== page) throw new Error("Browser changed during viewport resize.");
        this.viewport = viewport;
        this.documentId = randomUUID();
        this.invalidateSelection();
        return this.status(owner);
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
        if (params.documentId !== undefined && params.documentId !== this.documentId)
          throw new Error("Browser document changed. Refresh before interacting.");
        if (params.navigationId !== undefined && params.navigationId !== this.navigationId)
          throw new Error("Browser view changed. Refresh before interacting.");
        if (params.kind === "click") {
          const x = Number(params.x),
            y = Number(params.y);
          if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            x < 0 ||
            x >= this.viewport.width ||
            y < 0 ||
            y >= this.viewport.height
          )
            throw new Error("Invalid click position");
          await this.page.mouse.click(x, y);
        } else if (params.kind === "pointer") {
          const x = Number(params.x),
            y = Number(params.y);
          if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            x < 0 ||
            y < 0 ||
            x >= this.viewport.width ||
            y >= this.viewport.height
          )
            throw new Error("Invalid pointer position");
          const button = params.button ?? "left";
          if (button !== "left" && button !== "middle" && button !== "right")
            throw new Error("Invalid pointer button");
          if (!["move", "down", "up"].includes(String(params.action)))
            throw new Error("Unsupported pointer action");
          if (
            !this.page.mouse.move ||
            (params.action === "down" && !this.page.mouse.down) ||
            (params.action === "up" && !this.page.mouse.up)
          )
            throw new Error("Pointer input is unavailable on this host browser");
          await this.page.mouse.move(x, y);
          if (params.action === "down" && this.page.mouse.down)
            await this.page.mouse.down({ button });
          else if (params.action === "up" && this.page.mouse.up)
            await this.page.mouse.up({ button });
          else if (params.action !== "move") throw new Error("Unsupported pointer action");
        } else if (params.kind === "scroll") {
          const y = Number(params.y);
          const x = params.x === undefined ? 0 : Number(params.x);
          if (
            !Number.isFinite(x) ||
            Math.abs(x) > 2000 ||
            !Number.isFinite(y) ||
            Math.abs(y) > 2000
          )
            throw new Error("Invalid scroll distance");
          await this.page.mouse.wheel(x, y);
        } else if (params.kind === "text") {
          if (
            typeof params.text !== "string" ||
            params.text.length > 4096 ||
            params.text.includes("\0")
          )
            throw new Error("Invalid browser text");
          if (this.page.keyboard.insertText) await this.page.keyboard.insertText(params.text);
          else await this.page.keyboard.type(params.text);
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
              "Delete",
              "Home",
              "End",
              "PageUp",
              "PageDown",
              "A",
              "C",
              "X",
            ].includes(String(params.key))
          )
            throw new Error("Unsupported browser key");
          const modifiers = params.modifiers ?? [];
          if (
            !Array.isArray(modifiers) ||
            modifiers.length > 4 ||
            new Set(modifiers).size !== modifiers.length ||
            modifiers.some((value) => !["Control", "Alt", "Shift", "Meta"].includes(value))
          )
            throw new Error("Unsupported browser key modifiers");
          await this.page.keyboard.press([...modifiers, String(params.key)].join("+"));
        } else throw new Error("Unsupported browser input");
        this.invalidateSelection();
        const result = this.status(owner);
        if (receiptKey && receiptPayload) {
          this.inputReceipts.set(receiptKey, { payload: receiptPayload, result });
          if (this.inputReceipts.size > 256)
            this.inputReceipts.delete(this.inputReceipts.keys().next().value!);
        }
        return result;
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
      viewport: { ...this.viewport },
      navigationId: this.navigationId,
      documentId: this.documentId,
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
  private async ensureMaskSession(page: Page) {
    if (!page.context)
      throw new Error("Safe shadow DOM inspection is unavailable on this host browser");
    if (!this.maskSession) {
      const session = await page.context().newCDPSession(page);
      if (page !== this.page) {
        await session.detach();
        throw new Error("Browser changed during inspection.");
      }
      this.maskSession = session;
      if (session.on) {
        const events = [
          "DOM.documentUpdated",
          "DOM.childNodeInserted",
          "DOM.childNodeRemoved",
          "DOM.attributeModified",
          "DOM.attributeRemoved",
          "DOM.shadowRootPushed",
          "DOM.shadowRootPopped",
          "DOM.characterDataModified",
        ];
        for (const event of events)
          session.on(event, (payload: any) => {
            const capture = this.screenshotMutations;
            let own = false;
            if (
              capture &&
              event === "DOM.childNodeInserted" &&
              payload?.node &&
              Number.isInteger(payload.parentNodeId)
            ) {
              const node = payload.node;
              const text = node.children?.map((child: any) => child.nodeValue ?? "").join("") ?? "";
              if (
                node.localName === "style" &&
                text.includes(capture.marker) &&
                this.documentRoots.has(payload.parentNodeId) &&
                !capture.styleParents.has(payload.parentNodeId)
              ) {
                capture.styleParents.add(payload.parentNodeId);
                capture.nodes.add(node.nodeId);
                own = true;
              } else if (
                node.localName === "x-pw-glass" &&
                capture.glassExpected &&
                node.attributes?.includes("popover") &&
                node.attributes?.includes("manual") &&
                node.shadowRoots?.some((root: any) => root.shadowRootType === "closed") &&
                !capture.glass &&
                capture.styleParents.has(payload.parentNodeId)
              ) {
                capture.glass = true;
                capture.nodes.add(node.nodeId);
                own = true;
              }
            } else if (
              capture &&
              event === "DOM.childNodeRemoved" &&
              capture.nodes.has(payload?.nodeId)
            ) {
              capture.nodes.delete(payload.nodeId);
              own = true;
            }
            if (!own) this.maskRevision++;
            this.maskCache = undefined;
          });
        try {
          await session.send("DOM.enable");
          this.maskEvents = true;
        } catch {
          this.maskEvents = false;
        }
      }
    }
    return this.maskSession;
  }
  private async shadowMasks(page: Page, fresh = false) {
    const session = await this.ensureMaskSession(page);
    if (!fresh && this.maskEvents && this.maskCache) return this.maskCache;
    for (let attempt = 0; attempt < 2; attempt++) {
      const revision = this.maskRevision;
      const document = await session.send("DOM.getDocument", { depth: -1, pierce: true });
      const roots = new Set<number>();
      const collectRoots = (node: BrowserDomNode) => {
        if (node.nodeType === 9)
          for (const child of node.children ?? [])
            if (child.localName === "html" && Number.isInteger(child.nodeId))
              roots.add(child.nodeId!);
        for (const child of node.children ?? []) collectRoots(child);
        if (node.contentDocument) collectRoots(node.contentDocument);
      };
      collectRoots(document.root);
      const masks = browserShadowMasks(document.root);
      if (page !== this.page) throw new Error("Browser changed during inspection.");
      if (revision !== this.maskRevision) continue;
      this.documentRoots = roots;
      if (this.maskEvents) this.maskCache = masks;
      return masks;
    }
    throw new Error("Page changed during inspection. Try again.");
  }
  /** Inspect a bounded hit ancestry only; never enumerate the document for hover. */
  private async hoverBoundary(page: Page, x: number, y: number): Promise<string | undefined> {
    const session = await this.ensureMaskSession(page);
    if (this.hoverObjects) {
      const held = this.hoverObjects;
      await held.session.send("Runtime.releaseObjectGroup", { objectGroup: held.group });
      if (this.hoverObjects === held) this.hoverObjects = undefined;
    }
    const held = { session, group: `bycoda-hover-${randomUUID()}` };
    this.hoverObjects = held;
    try {
      const hit = await session.send("DOM.getNodeForLocation", {
        x: Math.floor(x), y: Math.floor(y), includeUserAgentShadowDOM: false, ignorePointerEventsNone: false,
      });
      const object = await session.send("DOM.resolveNode", { backendNodeId: hit.backendNodeId, objectGroup: held.group });
      if (!object.object.objectId) return;
      const ancestry = await session.send("Runtime.callFunctionOn", {
        objectId: object.object.objectId, objectGroup: held.group, silent: true,
        arguments: [{ value: x }, { value: y }],
        functionDeclaration: `function(x,y) {
          if (window !== window.top || this !== document.elementFromPoint(x,y)) return null;
          const nodes = [];
          for (let node = this; node; node = node.parentElement) {
            if (nodes.length >= 64) return null;
            nodes[nodes.length] = node;
          }
          return nodes;
        }`,
      });
      if (ancestry.exceptionDetails || !ancestry.result.objectId) return;
      const properties = await session.send("Runtime.getProperties", {
        objectId: ancestry.result.objectId, ownProperties: true, generatePreview: false,
      });
      const count = properties.result.find((item) => item.name === "length")?.value?.value;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 64) return;
      const nodes: number[] = [];
      for (let index = 0; index < count; index++) {
        const objectId = properties.result.find((item) => item.name === String(index))?.value?.objectId;
        if (!objectId) return;
        const { node } = await session.send("DOM.describeNode", { objectId, depth: 0, pierce: false });
        if (!Number.isSafeInteger(node.backendNodeId) || node.nodeType !== 1 ||
            node.shadowRoots?.some((root) => root.shadowRootType !== "user-agent")) return;
        nodes.push(node.backendNodeId!);
      }
      if (page !== this.page || session !== this.maskSession) throw new Error("Browser changed during inspection.");
      return JSON.stringify(nodes);
    } finally {
      // A failed release retains one exact group; retry it before allocating more.
      await session.send("Runtime.releaseObjectGroup", { objectGroup: held.group });
      if (this.hoverObjects === held) this.hoverObjects = undefined;
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
        captures: new Map(),
      };
      return this.status(owner);
    }
    const annotation = this.annotationScope(params, owner);
    if (method === "browser.annotation.clear") {
      if (params.captureId !== undefined) {
        if (typeof params.captureId !== "string" || !annotation.captures.has(params.captureId))
          throw new Error("Browser capture was not found in this annotation scope.");
        annotation.captures.delete(params.captureId);
        if (annotation.selection?.id !== params.captureId) return this.status(owner);
      }
      annotation.selection = undefined;
      annotation.inspection = undefined;
      annotation.point = undefined;
      return this.status(owner);
    }
    if (method === "browser.annotation.read") {
      const captureId =
        params.captureId === undefined ? annotation.selection?.id : params.captureId;
      if (typeof captureId !== "string") throw new Error("Select an element first");
      const capture = annotation.captures.get(captureId);
      if (!capture) throw new Error("Browser capture was not found in this annotation scope.");
      if (capture.revision !== undefined && capture.revision !== this.maskRevision)
        throw new Error("Page changed. Select the element again.");
      const revision = this.maskRevision;
      const current = await page.evaluate(inspectBrowserElement, {
        ...capture.point,
        ancestorDepth: capture.depth,
        traversal: capture.traversal,
        full: true,
        opaqueHosts: await this.shadowMasks(page, true),
      });
      this.annotationScope(params, owner);
      if (
        (this.maskEvents && revision !== this.maskRevision) ||
        JSON.stringify(current) !== JSON.stringify(capture.inspection)
      ) {
        annotation.captures.delete(captureId);
        throw new Error("Page changed. Select the element again.");
      }
      return { ...this.status(owner), selection: capture.selection };
    }
    const traverse =
      method === "browser.annotation.parent" || method === "browser.annotation.traverse";
    if (
      traverse &&
      (!this.maskEvents ||
        !annotation.point ||
        !annotation.selection ||
        !annotation.nodeId ||
        params.nodeId !== annotation.nodeId ||
        annotation.maskRevision !== this.maskRevision)
    )
      throw new Error("Element identity is stale or traversal is unavailable. Select again.");
    if (
      ![
        "browser.annotation.hover",
        "browser.annotation.select",
        "browser.annotation.parent",
        "browser.annotation.traverse",
      ].includes(method)
    )
      throw new Error("Unsupported annotation method");
    const x = traverse ? annotation.point!.x : Number(params.x),
      y = traverse ? annotation.point!.y : Number(params.y);
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x >= this.viewport.width ||
      y < 0 ||
      y >= this.viewport.height
    )
      throw new Error("Invalid selection position");
    const full = method !== "browser.annotation.hover";
    const depth = 0;
    const traversal = traverse ? [...(annotation.traversal ?? [])] : [];
    if (traverse) {
      const direction = method === "browser.annotation.parent" ? "parent" : params.direction;
      if (direction === "ancestor") {
        if (
          !Number.isInteger(params.ancestorIndex) ||
          Number(params.ancestorIndex) < 0 ||
          Number(params.ancestorIndex) > 63
        )
          throw new Error("Invalid ancestor index");
        traversal.push(...(Array(Number(params.ancestorIndex) + 1).fill("parent") as "parent"[]));
      } else if (
        direction === "parent" ||
        direction === "child" ||
        direction === "previousSibling" ||
        direction === "nextSibling"
      )
        traversal.push(direction);
      else throw new Error("Invalid browser traversal direction");
      if (traversal.length > 64) throw new Error("Element traversal exceeds inspection budget");
    }
    const replaceCaptureId = full ? params.replaceCaptureId : undefined;
    if (
      replaceCaptureId !== undefined &&
      (typeof replaceCaptureId !== "string" ||
        replaceCaptureId !== annotation.selection?.id ||
        !annotation.captures.has(replaceCaptureId))
    )
      throw new Error("Browser capture to replace is stale.");
    if (full && annotation.captures.size >= 8 && replaceCaptureId === undefined)
      throw new Error(
        "Browser annotation capture limit reached. Start a new selection to continue.",
      );
    if (full && !traverse && replaceCaptureId === undefined) annotation.selection = undefined;
    const boundary = full ? undefined : await this.hoverBoundary(page, x, y);
    this.annotationScope(params, owner);
    if (!full && !boundary) return {
      ...this.status(owner), hover: undefined,
      limitation: "Hover target is opaque or cannot be safely verified. Select an accessible main-page element.",
    };
    const inspection = await page.evaluate(inspectBrowserElement, {
      x,
      y,
      ancestorDepth: depth,
      traversal,
      full,
      opaqueHosts: full ? await this.shadowMasks(page, true) : [],
    });
    this.annotationScope(params, owner);
    if (!full && boundary !== await this.hoverBoundary(page, x, y))
      throw new Error("Hover target changed during inspection. Try again.");
    this.annotationScope(params, owner);
    if (!inspection.element || !full)
      return {
        ...this.status(owner),
        hover: inspection.element,
        limitation: inspection.limitation,
      };
    if (!this.maskEvents)
      throw new Error("Safe capture requires browser DOM mutation observation.");
    const inspectedRevision = this.maskRevision;
    const marker = `bycoda-capture-${randomUUID()}`;
    this.screenshotMutations = {
      marker,
      nodes: new Set(),
      styleParents: new Set(),
      glass: false,
      glassExpected: inspection.masks.length > 0,
    };
    let frame: Buffer;
    try {
      frame = await page.screenshot({
        type: "jpeg",
        quality: 65,
        timeout: 5_000,
        mask: inspection.masks.map((selector) => page.locator!(selector)),
        maskColor: "#333333",
        // Also hide content overflowing private/closed shadow hosts. Playwright
        // restores this screenshot-only stylesheet after capture.
        style: `/* ${marker} */ ${inspection.masks.length ? `${inspection.masks.join(",")} { opacity: 0 !important; }` : ""}`,
      });
      // Drain CDP events before judging Playwright screenshot cleanup.
      await this.maskSession!.send("DOM.getDocument", { depth: 0, pierce: true });
      const observed = this.screenshotMutations;
      if (
        !observed ||
        observed.styleParents.size === 0 ||
        observed.nodes.size !== 0 ||
        (observed.glassExpected && !observed.glass)
      )
        this.maskRevision++;
    } finally {
      this.screenshotMutations = undefined;
      this.maskCache = undefined;
    }
    this.annotationScope(params, owner);
    if (frame.byteLength > 2 * 1024 * 1024)
      throw new Error("Browser frame exceeds transfer budget");
    const current = await page.evaluate(inspectBrowserElement, {
      x,
      y,
      ancestorDepth: depth,
      traversal,
      full: true,
      opaqueHosts: await this.shadowMasks(page, true),
    });
    this.annotationScope(params, owner);
    if (
      (this.maskEvents && inspectedRevision !== this.maskRevision) ||
      JSON.stringify(current) !== JSON.stringify(inspection)
    )
      throw new Error("Page changed. Select the element again.");
    annotation.point = { x, y };
    annotation.depth = depth;
    annotation.traversal = traversal;
    annotation.nodeId = randomUUID();
    annotation.maskRevision = this.maskRevision;
    inspection.element.nodeId = annotation.nodeId;
    if (inspection.element.parentSelector && this.maskEvents)
      inspection.element.parentNodeId = annotation.nodeId;
    annotation.inspection = {
      ...inspection,
      element: { ...inspection.element, nodeId: undefined, parentNodeId: undefined },
    };
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
        width: this.viewport.width,
        height: this.viewport.height,
      },
    };
    if (typeof replaceCaptureId === "string") annotation.captures.delete(replaceCaptureId);
    annotation.captures.set(annotation.selection.id, {
      selection: annotation.selection,
      point: { x, y },
      depth,
      traversal,
      inspection: annotation.inspection,
      revision: this.maskEvents ? this.maskRevision : undefined,
    });
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
        viewport: { ...this.viewport },
        acceptDownloads: false,
      });
      const page = await context.newPage();
      if (generation !== this.pageGeneration) throw new Error("Browser was closed during startup");
      this.page = page;
      const navigated = (frame: PageEvents["framenavigated"]) => {
        if (this.page === page && generation === this.pageGeneration && !frame.parentFrame()) {
          this.documentId = randomUUID();
          this.invalidateSelection();
        }
      };
      page.on?.("framenavigated", navigated);
      this.detachPageListeners = () => page.off?.("framenavigated", navigated);
      this.browser = browser;
      this.idleTimer = setInterval(() => {
        if (
          !this.options.keepAlive &&
          !this.busy &&
          !this.annotation &&
          (!this.lease || this.lease.expiresAt <= this.now()) &&
          this.now() - this.lastUse > 5 * 60_000
        ) {
          this.busy = true;
          void this.close()
            .then(() => this.options.onIdleClosed?.())
            .catch(() => {})
            .finally(() => {
              this.busy = false;
            });
        }
      }, 30_000);
      this.idleTimer.unref();
    } catch (error) {
      await browser.close();
      throw error;
    }
  }
  reclaimable(at: number) {
    return (
      !this.busy &&
      !this.page &&
      !this.annotation &&
      (!this.lease || this.lease.expiresAt <= at) &&
      at - this.lastUse > 5 * 60_000
    );
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
    const maskSession = this.maskSession;
    this.maskSession = undefined;
    this.maskCache = undefined;
    this.documentRoots.clear();
    this.maskEvents = false;
    this.maskRevision++;
    try {
      await maskSession?.detach();
    } catch {
      /* page already closed */
    }
    this.stopCapture("The browser has closed. Retained logs remain available.");
    this.detachPageListeners?.();
    this.detachPageListeners = undefined;
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.idleTimer = undefined;
    const browser = this.browser;
    this.page = undefined;
    this.browser = undefined;
    this.viewport = { ...DEFAULT_VIEWPORT };
    this.documentId = randomUUID();
    this.invalidateSelection();
    if (browser) {
      await browser.close();
      this.hoverObjects = undefined;
    }
  }

  async close() {
    this.lease = undefined;
    await this.disposePage();
  }
}

/** Isolated per-conversation browser state; legacy owner-wide mode remains separate. */
export class SessionBrowserRegistry {
  private readonly browsers = new Map<string, SharedBrowser>();
  private readonly shared: SharedBrowser;
  private process?: Promise<Browser>;
  private readonly pooledLoader: BrowserLoader;
  constructor(
    private readonly loader: BrowserLoader,
    private readonly now = Date.now,
    private readonly options: SharedBrowserOptions = {},
  ) {
    this.pooledLoader = async () => ({
      chromium: {
        launch: async () => {
          if (!this.process)
            this.process = this.loader()
              .then((runtime) => runtime.chromium.launch({ headless: true }))
              .catch((error) => {
                this.process = undefined;
                throw error;
              });
          const process = await this.process;
          let context: Awaited<ReturnType<Browser["newContext"]>> | undefined;
          return {
            newContext: async (options) => {
              context = await process.newContext(options);
              return context;
            },
            close: async () => {
              await context?.close?.();
            },
          };
        },
      },
    });
    this.shared = new SharedBrowser(this.pooledLoader, now, options);
  }
  private browser(params: Record<string, unknown>, credential: string) {
    if (params.threadId !== undefined) {
      if (params.sessionId !== undefined || params.ownerPresentationScope !== undefined ||
        [params.environmentId, params.projectId, params.threadId].some(value => typeof value !== "string" || !value || value.length > 256 || value.includes("\0")) || typeof params.roomProjectCwd !== "string" || !params.roomProjectCwd || params.roomProjectCwd.length > 4096 || params.roomProjectCwd.includes("\0"))
        throw new Error("A real Room, Host and project are required for scoped browser access.");
      return this.browserForKey(JSON.stringify(["assistant-thread", params.environmentId, params.projectId, params.roomProjectCwd, params.threadId]));
    }
    if (params.ownerPresentationScope !== undefined) {
      if (
        typeof params.ownerPresentationScope !== "string" ||
        !params.ownerPresentationScope ||
        params.ownerPresentationScope.length > 512 ||
        params.ownerPresentationScope.includes("\0")
      )
        throw new Error("Invalid owner browser presentation scope");
      return this.browserForKey(
        JSON.stringify(["owner", fingerprint(credential), params.ownerPresentationScope]),
      );
    }
    if (params.sessionId === undefined) return this.shared;
    if (
      typeof params.sessionId !== "string" ||
      !params.sessionId ||
      typeof params.projectId !== "string" ||
      !params.projectId
    )
      throw new Error(
        "A validated project and conversation are required for scoped browser access.",
      );
    return this.browserForKey(JSON.stringify(["session", params.projectId, params.sessionId]));
  }
  private browserForKey(key: string) {
    let browser = this.browsers.get(key);
    if (!browser) {
      if (this.browsers.size >= 16) {
        for (const [candidateKey, candidate] of this.browsers)
          if (candidate.reclaimable(this.now())) this.browsers.delete(candidateKey);
      }
      if (this.browsers.size >= 16)
        throw new Error(
          "Browser session capacity reached. Close a browser before opening another.",
        );
      browser = new SharedBrowser(this.pooledLoader, this.now, {
        ...this.options,
        onIdleClosed: () => {
          if (this.browsers.get(key) === browser) this.browsers.delete(key);
        },
      });
      this.browsers.set(key, browser);
    }
    return browser;
  }
  async dispatch(
    method: string,
    params: Record<string, unknown>,
    credential: string,
    options: { takeover?: boolean } = {},
  ) {
    const browser = this.browser(params, credential);
    const result = await browser.dispatch(method, params, credential, options);
    if (method === "browser.close" && params.sessionId !== undefined) {
      const key =
        params.ownerPresentationScope !== undefined
          ? JSON.stringify(["owner", fingerprint(credential), params.ownerPresentationScope])
          : JSON.stringify(["session", params.projectId, params.sessionId]);
      this.browsers.delete(key);
    }
    return result;
  }
  async dispatchForSession(method: string, params: Record<string, unknown>, credential: string) {
    if (params.ownerPresentationScope !== undefined || params.threadId !== undefined)
      throw new Error("Owner browser presentation scopes are unavailable to agents.");
    return this.browser(params, credential).dispatchForSession(method, params, credential);
  }
  async dispatchForRoom(method: string, params: Record<string, unknown>, credential: string, options: { takeover?: boolean } = {}) {
    if (!params.threadId || params.sessionId !== undefined || params.ownerPresentationScope !== undefined || method.startsWith("browser.annotation."))
      throw new Error("A real Room browser source is required; session annotations have a separate owner.");
    const browser = this.browser(params, credential);
    const result = await browser.dispatchForSession(method, params, credential, options);
    if (method === "browser.close")
      this.browsers.delete(JSON.stringify(["assistant-thread", params.environmentId, params.projectId, params.roomProjectCwd, params.threadId]));
    return result;
  }
  revoke(credential: string) {
    this.shared.revoke(credential);
    for (const browser of this.browsers.values()) browser.revoke(credential);
  }
  async close() {
    await Promise.all([
      this.shared.close(),
      ...Array.from(this.browsers.values(), (browser) => browser.close()),
    ]);
    this.browsers.clear();
    const process = this.process;
    this.process = undefined;
    if (process) await (await process).close();
  }
}
