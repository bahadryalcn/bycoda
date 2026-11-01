import { createHash } from "node:crypto";
import { sharedBrowserUrl, sharedBrowserViewport } from "./shared-browser";

export type ConversationPreviewInput = {
  requestId: string;
  url: string;
  width?: number;
  height?: number;
  show?: boolean;
};
export type ConversationPreviewScope = {
  projectId: string;
  sessionId: string;
  /** Stable transport-derived principal; never an input field from the agent. */
  principalId: string;
};
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
  private requests = new Map<
    string,
    {
      signature: string;
      principalId: string;
      scopeKey: string;
      pending: boolean;
      value: Promise<ConversationPreviewResult>;
    }
  >();
  private closed = false;

  /** Call only when this transport authority is retired, never to retry a request. */
  revoke(principalId: string) {
    for (const [key, entry] of this.requests)
      if (entry.principalId === principalId) this.requests.delete(key);
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
    if (!scope.projectId || !scope.sessionId || !scope.principalId)
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
    const scopeKey = JSON.stringify([scope.projectId, scope.sessionId, scope.principalId]);
    const key = JSON.stringify([scopeKey, input.requestId]);
    const signature = createHash("sha256")
      .update(JSON.stringify([url, viewport, input.show !== false]))
      .digest("hex");
    const previous = this.requests.get(key);
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
    if (!previous && (scopeEntries >= 512 || this.requests.size >= 4096))
      throw new Error(
        "Preview receipt limit reached for this authority. Inspect existing outcomes; do not retry unknown requests with new IDs.",
      );
    let request = previous;
    if (!request) {
      const current = this.execute({ ...input, url }, viewport, {
        ...ports,
        authorize: async () => {
          if (this.closed) throw new Error("Preview workflow is closed.");
          await ports.authorize();
        },
      });
      request = {
        signature,
        principalId: scope.principalId,
        scopeKey,
        pending: true,
        value: current,
      };
      this.requests.set(key, request);
      const entry = request;
      void current
        .then((result) => {
          entry.pending = false;
          const compact = structuredClone(result);
          if (compact.evidence.browser) delete compact.evidence.browser.data;
          if (compact.evidence.frame) delete compact.evidence.frame.data;
          entry.value = Promise.resolve(compact);
        })
        .catch(() => {
          entry.pending = false;
        });
    }
    const result = await request.value;
    if (this.closed) throw new Error("Preview workflow is closed.");
    await ports.authorize();
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
      presentation: { state: input.show === false ? "not-requested" : "blocked" },
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
