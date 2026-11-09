import { DIAGNOSTIC_PERIODIC_INTERVAL_DAYS } from "@bycoda/account-contracts";
import { getDiagnosticsMode, subscribeDiagnosticsConsent } from "./diagnosticsConsent";
import {
  sendDiagnosticReport,
  type DiagnosticSendStatus,
  type DiagnosticsDeps,
} from "./diagnosticsReport";
import type { NativeCrash } from "./diagnosticsNative";
import { markRenderErrorReported, unreportedRenderError, type RenderError } from "./renderError";

const LAST_PERIODIC_KEY = "bycoda.diagnostics.lastPeriodic";
const LOCK_NAME = "bycoda.diagnostics.scheduler";
const PERIODIC_CHECK_MS = 3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** A crash the user has not answered yet (mode ask or never decided). */
export type PendingCrash = {
  message: string;
  occurredAt: string;
  native: NativeCrash | null;
  /** The Host process's own crash marker. */
  hostCrash: NativeCrash | null;
  renderError: RenderError | null;
};

function readLastPeriodic(): number | null {
  try {
    const at = Date.parse(localStorage.getItem(LAST_PERIODIC_KEY) ?? "");
    return Number.isNaN(at) ? null : at;
  } catch {
    return null;
  }
}

function writeLastPeriodic(at: Date): void {
  try {
    localStorage.setItem(LAST_PERIODIC_KEY, at.toISOString());
  } catch {
    // -- without storage the next check may send again; the server rate limit applies.
  }
}

/** True when automatic mode is on and no periodic report succeeded in the last interval. */
export function periodicDue(now: Date): boolean {
  const last = readLastPeriodic();
  return last === null || now.getTime() - last >= DIAGNOSTIC_PERIODIC_INTERVAL_DAYS * DAY_MS;
}

/** Runs `work` in one window only; windows without Web Locks just run it. */
async function exclusively<T>(work: () => Promise<T>): Promise<T | undefined> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) return work();
  return locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => (lock ? work() : undefined));
}

export function createDiagnosticsScheduler(deps: DiagnosticsDeps) {
  const now = deps.now ?? (() => new Date());
  let pending: PendingCrash | null = null;
  const listeners = new Set<() => void>();
  const setPending = (next: PendingCrash | null) => {
    pending = next;
    for (const listener of listeners) listener();
  };

  /** Forgets the crash everywhere: the native marker and the render-error mark. */
  async function clearCrash(
    crash: Pick<PendingCrash, "native" | "hostCrash" | "renderError">,
  ): Promise<void> {
    if (crash.renderError) markRenderErrorReported(crash.renderError);
    if (crash.native || crash.hostCrash) await deps.native.clearCrash().catch(() => undefined);
  }

  async function detectCrash(): Promise<PendingCrash | null> {
    const logs = await deps.native.collectLogs().catch(() => null);
    const native = logs?.crash ?? null;
    const hostCrash = logs?.hostCrash ?? null;
    const renderError = unreportedRenderError();
    if (!native && !hostCrash && !renderError) return null;
    return {
      message:
        native?.message ??
        (hostCrash ? `Host: ${hostCrash.message}` : null) ??
        renderError?.message ??
        "",
      occurredAt:
        native?.occurredAt ?? hostCrash?.occurredAt ?? renderError?.at ?? now().toISOString(),
      native,
      hostCrash,
      renderError,
    };
  }

  async function reportCrash(crash: PendingCrash): Promise<DiagnosticSendStatus> {
    const status = await sendDiagnosticReport(deps, {
      trigger: "crash",
      crash: crash.native,
      hostCrash: crash.hostCrash,
      summary: crash.message,
    });
    if (status === "sent" || status === "empty") await clearCrash(crash);
    return status;
  }

  async function handleStartupCrash(): Promise<void> {
    const crash = await detectCrash();
    if (!crash) return;
    const mode = getDiagnosticsMode();
    if (mode === "off") await clearCrash(crash);
    else if (mode === "auto") await reportCrash(crash); // -- a failure keeps the marker for the next start.
    else setPending(crash);
  }

  async function checkPeriodic(): Promise<void> {
    if (getDiagnosticsMode() !== "auto" || !periodicDue(now())) return;
    const status = await sendDiagnosticReport(deps, { trigger: "periodic" });
    if (status === "sent") writeLastPeriodic(now());
  }

  let started = false;
  let running = false;
  return {
    getPending: (): PendingCrash | null => pending,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** The notice's Send action. */
    async sendPending(): Promise<DiagnosticSendStatus> {
      const crash = pending;
      if (!crash) return "empty";
      const status = await reportCrash(crash);
      if (pending === crash && (status === "sent" || status === "empty")) setPending(null);
      return status;
    },
    /** The notice's Don't send action. */
    async dismissPending(): Promise<void> {
      const crash = pending;
      if (!crash) return;
      setPending(null);
      await clearCrash(crash);
    },
    /** Once per window. Does nothing outside the desktop shell. */
    start(): () => void {
      if (started || !deps.native.available) return () => undefined;
      started = true;
      const tick = () => {
        if (running) return;
        running = true;
        exclusively(checkPeriodic)
          .catch(() => undefined) // -- a failed attempt waits for the next check.
          .finally(() => {
            running = false;
          });
      };
      exclusively(handleStartupCrash)
        .catch(() => undefined) // -- the marker stays; the next start retries.
        .finally(tick);
      const timer = setInterval(tick, PERIODIC_CHECK_MS);
      const unsubscribe = subscribeDiagnosticsConsent(tick);
      return () => {
        clearInterval(timer);
        unsubscribe();
        started = false;
      };
    },
  };
}

export type DiagnosticsScheduler = ReturnType<typeof createDiagnosticsScheduler>;
