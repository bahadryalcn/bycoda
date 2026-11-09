import { createHash } from "node:crypto";
import { sharedBrowserUrl, sharedBrowserViewport } from "../browser/shared-browser";
import { RetiredRequestFence } from "../storage/request-fence";

const RECEIPT_TTL = 10 * 60 * 1000;
type PreviewReceipt = {
  signature: string;
  principalId: string;
  scopeKey: string;
  pending: boolean;
  revoked: boolean;
  settledAt?: number;
  authorize: ConversationPreviewPorts["authorize"];
  value: Promise<ConversationPreviewResult>;
};

export type ConversationPreviewInput = {
  requestId: string;
  url: string;
  width?: number;
  height?: number;
  show?: boolean;
};
export type ConversationPreviewScope = {
  projectId: string;
  /** Stable transport-derived principal; never an input field from the agent. */
  principalId: string;
} & (
  | { kind?: "session"; sessionId: string; threadId?: never }
  | { kind: "assistant-thread"; threadId: string; sessionId?: never }
);
export type PreviewBrowserState = {
  open: boolean;
  controlling: boolean;
  leaseId?: string;
  url?: string | null;
  navigationId?: string;
  viewport?: { width: number; height: number };
  data?: string;
  mimeType?: string;
  width?: number;
  height?: number;
};
export type PreviewPresentation = {
  open: boolean;
  panels: { id: string; tab: string; machine: string; mounted: boolean }[];
};
export type ConversationPreviewPorts = {
  /** Must retain existing session/Host authority and browser lease checks. */
  browser(method: string, params: Record<string, unknown>): Promise<PreviewBrowserState>;
  /** Must open the originating conversation's project-Host Browser panel. */
  present(): Promise<PreviewPresentation>;
  /** Check fresh authority before effects and disclosure, including cached results. */
  authorize(): void | Promise<void>;
};
export type ConversationPreviewResult = {
  requestId: string;
  observedAt: string;
  execution: {
    state: "succeeded" | "blocked" | "outcome-unknown";
    stage: "status" | "claim" | "open" | "resize" | "frame";
    error?: string;
  };
  presentation: {
    state: "mounted" | "not-requested" | "blocked" | "unavailable";
    panelId?: string;
    error?: string;
  };
  evidence: { browser?: PreviewBrowserState; frame?: PreviewBrowserState };
};

/** Compose existing authorities; never take over, retry a mutation or close a user's page. */
export class ConversationPreviewWorkflow {
  private requests = new Map<string, PreviewReceipt>();
  private readonly retired = new RetiredRequestFence();
  private closed = false;
  constructor(private readonly now: () => number = () => performance.now()) {}

  private expireSettled() {
    const now = this.now();
    for (const [key, entry] of this.requests) {
      if (entry.settledAt === undefined || now - entry.settledAt < RECEIPT_TTL) continue;
      this.retired.add(key);
      this.requests.delete(key);
    }
  }

  /** Call only when this transport authority is retired, never to retry a request. */
  revoke(principalId: string) {
    for (const entry of this.requests.values())
      if (entry.principalId === principalId) entry.revoked = true;
  }

  close() {
    this.closed = true;
    this.requests.clear();
  }

  async run(
    input: ConversationPreviewInput,
    scope: ConversationPreviewScope,
    ports: ConversationPreviewPorts,
  ): Promise<ConversationPreviewResult> {
    if (this.closed) throw new Error("Preview workflow is closed.");
    await ports.authorize();
    if (this.closed) throw new Error("Preview workflow is closed.");
    if (
      !scope.projectId ||
      !(scope.kind === "assistant-thread" ? scope.threadId : scope.sessionId) ||
      !scope.principalId
    )
      throw new Error("Preview requires an authenticated project, conversation and principal.");
    if (typeof input.requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId))
      throw new Error(
        "Preview requires a stable requestId (1-128 letters, digits, underscores or hyphens).",
      );
    const url = sharedBrowserUrl(input.url);
    const viewport =
      input.width !== undefined || input.height !== undefined
        ? sharedBrowserViewport(input.width, input.height)
        : undefined;
    if (input.show !== undefined && typeof input.show !== "boolean")
      throw new Error("Invalid preview visibility.");
    const scopeKey = JSON.stringify([
      scope.projectId,
      scope.kind === "assistant-thread"
        ? ["assistant-thread", scope.threadId]
        : ["session", scope.sessionId],
      scope.principalId,
    ]);
    const key = JSON.stringify([scopeKey, input.requestId]);
    const signature = createHash("sha256")
      .update(JSON.stringify([url, viewport, input.show !== false]))
      .digest("hex");
    this.expireSettled();
    const previous = this.requests.get(key);
    if (previous?.revoked) throw new Error("Preview authority was revoked.");
    if (previous) {
      await previous.authorize();
      this.expireSettled();
      if (this.closed || previous.revoked || this.requests.get(key) !== previous)
        throw new Error("Preview authority was revoked or the receipt expired.");
    }
    if (previous && previous.signature !== signature)
      throw new Error(
        "Preview requestId was already used with different input. Inspect the original result.",
      );
    // Retain compact outcome fences until authority retirement. No eviction can
    // turn an uncertain request into a fresh navigation. JPEG bytes are never cached.
    const scopeEntries = [...this.requests.values()].filter(
      (entry) => entry.scopeKey === scopeKey,
    ).length;
    const running = [...this.requests.values()].filter((entry) => entry.pending);
    if (
      !previous &&
      (running.length >= 16 || running.filter((entry) => entry.scopeKey === scopeKey).length >= 4)
    )
      throw new Error(
        "Preview verification is busy. Inspect the original request before starting more work.",
      );
    if (!previous && this.retired.has(key))
      throw new Error(
        "Preview receipt expired. Inspect the original outcome before a new request.",
      );
    if (!previous && this.retired.saturated)
      throw new Error("Preview receipt protection is full for this host runtime.");
    if (!previous && (scopeEntries >= 512 || this.requests.size >= 4096))
      throw new Error(
        "Preview receipt limit reached for this authority. Inspect existing outcomes; do not retry unknown requests with new IDs.",
      );
    let request = previous;
    if (!request) {
      request = {
        signature,
        principalId: scope.principalId,
        scopeKey,
        pending: true,
        revoked: false,
        authorize: ports.authorize,
        value: undefined!,
      };
      this.requests.set(key, request);
      const entry = request;
      const current = this.execute({ ...input, url }, viewport, {
        ...ports,
        authorize: async () => {
          if (this.closed || entry.revoked) throw new Error("Preview authority was revoked.");
          await entry.authorize();
          if (this.closed || entry.revoked) throw new Error("Preview authority was revoked.");
        },
      });
      entry.value = current;
      void current
        .then((result) => {
          const compact = structuredClone(result);
          if (compact.evidence.browser) delete compact.evidence.browser.data;
          if (compact.evidence.frame) delete compact.evidence.frame.data;
          entry.value = Promise.resolve(compact);
          if (
            (result.execution.state === "succeeded" &&
              (result.presentation.state === "mounted" ||
                result.presentation.state === "not-requested")) ||
            (result.execution.state === "blocked" && result.execution.stage === "status")
          ) {
            entry.pending = false;
            entry.settledAt = this.now();
          }
        })
        .catch(() => {
          // A rejected operation can still have an effect in flight.
        });
    }
    const receiptValue = request.value;
    if (request.revoked) throw new Error("Preview authority was revoked.");
    await request.authorize();
    if (this.closed || request.revoked) throw new Error("Preview authority was revoked.");
    let result: ConversationPreviewResult;
    try {
      result = await receiptValue;
    } catch (error) {
      await request.authorize();
      if (this.closed || request.revoked) throw new Error("Preview authority was revoked.");
      throw error;
    }
    if (this.closed || request.revoked) throw new Error("Preview authority was revoked.");
    await ports.authorize();
    await request.authorize();
    this.expireSettled();
    if (this.closed || request.revoked || this.requests.get(key) !== request)
      throw new Error("Preview authority was revoked or the receipt expired.");
    // Callers cannot corrupt a cached receipt or later mutate another response.
    return structuredClone(result);
  }

  private async execute(
    input: ConversationPreviewInput,
    viewport: { width: number; height: number } | undefined,
    ports: ConversationPreviewPorts,
  ): Promise<ConversationPreviewResult> {
    const result: ConversationPreviewResult = {
      requestId: input.requestId,
      observedAt: new Date().toISOString(),
      execution: { state: "blocked", stage: "status" },
      presentation: {
        state: input.show === false ? "not-requested" : "blocked",
      },
      evidence: {},
    };
    const call = async (
      stage: ConversationPreviewResult["execution"]["stage"],
      params: Record<string, unknown> = {},
    ) => {
      result.execution.stage = stage;
      await ports.authorize();
      return ports.browser(`browser.${stage}`, params);
    };
    let browser: PreviewBrowserState;
    try {
      browser = await call("status");
      if (!browser.controlling || !browser.leaseId) browser = await call("claim");
      if (!browser.controlling || !browser.leaseId)
        throw new Error("Browser control was not granted. No preview navigation was attempted.");
      const leaseId = browser.leaseId;
      // Same-page requests keep the user's current page state and unsent form inputs.
      if (!browser.open || browser.url !== input.url)
        browser = await call("open", { url: input.url, leaseId });
      if (!browser.open) throw new Error("Browser did not confirm an open page.");
      result.evidence.browser = browser;
      if (
        viewport &&
        (browser.viewport?.width !== viewport.width || browser.viewport?.height !== viewport.height)
      ) {
        browser = await call("resize", { ...viewport, leaseId });
        if (
          browser.viewport?.width !== viewport.width ||
          browser.viewport?.height !== viewport.height
        )
          throw new Error("Browser did not confirm the requested viewport.");
        result.evidence.browser = browser;
      }
      const frame = await call("frame", { leaseId });
      if (!frame.data || !frame.mimeType || !frame.width || !frame.height)
        throw new Error(
          "Browser did not return frame evidence. Inspect its status before retrying.",
        );
      if (frame.data.length > Math.ceil((2 * 1024 * 1024 * 4) / 3) + 4)
        throw new Error("Browser frame exceeds preview receipt budget.");
      result.evidence.frame = frame;
      result.observedAt = new Date().toISOString();
      result.execution = { state: "succeeded", stage: "frame" };
    } catch (error) {
      result.execution.state =
        result.execution.stage === "open" || result.execution.stage === "resize"
          ? "outcome-unknown"
          : "blocked";
      result.execution.error =
        error instanceof Error ? error.message : "Preview could not be verified.";
      // An opened page can still be shown when its frame or resize failed.
      // Presentation must not silently inherit capture's success state.
      if (!result.evidence.browser?.open) return result;
    }
    if (input.show !== false) {
      try {
        await ports.authorize();
        const ui = await ports.present();
        const panel = ui.panels.find(
          (entry) => entry.tab === "browser" && entry.machine === "project" && entry.mounted,
        );
        result.presentation =
          ui.open && panel
            ? { state: "mounted", panelId: panel.id }
            : {
                state: "blocked",
                error: "Browser page is verified, but its project-Host panel is not mounted.",
              };
      } catch (error) {
        result.presentation = {
          state: "unavailable",
          error:
            error instanceof Error
              ? error.message
              : "Preview panel is unavailable in the originating desktop.",
        };
      }
    }
    return result;
  }
}
